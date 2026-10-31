import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import type { ClientWorkSession } from '../lib/adapters';
import { workSessionRowToClient, workSessionToInsertPayload } from '../lib/adapters';
import type { WorkSummary } from '../types';
import { initialWorkSummary } from '../data/mockData';
import { useAuth } from '../context/useAuth';
import { supabase } from '../lib/supabase';
import { getOfflineCacheItem, setOfflineCacheItem, enqueueOutboxOperation, getOutboxOperationsForScope } from '../lib/offlineDb';
import { processOutbox } from '../lib/syncEngine';

export const initialWorkSessions: ClientWorkSession[] = [
  {
    id: 'mock-sess-1',
    title: 'ESP32 Hardware Pinout Review',
    sessionType: 'focus',
    durationMinutes: 50,
    startedAt: new Date(Date.now() - 4 * 3600000).toISOString(),
    completedAt: new Date(Date.now() - 3.16 * 3600000).toISOString(),
    taskId: null,
    createdAt: new Date(Date.now() - 4 * 3600000).toISOString(),
  },
  {
    id: 'mock-sess-2',
    title: 'Web UI Navigation Shell Design',
    sessionType: 'focus',
    durationMinutes: 45,
    startedAt: new Date(Date.now() - 2.5 * 3600000).toISOString(),
    completedAt: new Date(Date.now() - 1.75 * 3600000).toISOString(),
    taskId: null,
    createdAt: new Date(Date.now() - 2.5 * 3600000).toISOString(),
  },
  {
    id: 'mock-sess-3',
    title: 'CSS Theme & Visor Styling',
    sessionType: 'focus',
    durationMinutes: 35,
    startedAt: new Date(Date.now() - 1 * 3600000).toISOString(),
    completedAt: new Date(Date.now() - 0.4 * 3600000).toISOString(),
    taskId: null,
    createdAt: new Date(Date.now() - 1 * 3600000).toISOString(),
  },
];

export interface UseWorkSessionsReturn {
  sessions: ClientWorkSession[];
  workSummary: WorkSummary;
  loading: boolean;
  error: string | null;
  recordSession: (data: {
    title: string;
    sessionType?: 'focus' | 'break' | 'long_break';
    durationMinutes: number;
    startedAt: string;
    completedAt?: string | null;
    taskId?: string | null;
  }) => Promise<boolean>;
  deleteSession: (id: string) => Promise<boolean>;
  retry: () => void;
  resetDemoData: () => void;
}

function isSameCalendarDay(d1: Date, d2: Date): boolean {
  return (
    d1.getFullYear() === d2.getFullYear() &&
    d1.getMonth() === d2.getMonth() &&
    d1.getDate() === d2.getDate()
  );
}

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

function computeWorkSummary(
  isAuth: boolean,
  sessions: ClientWorkSession[],
  tasksCompletedCount: number,
  totalTasksCount: number
): WorkSummary {
  if (!isAuth) {
    return initialWorkSummary;
  }

  const today = new Date();
  const todayCompletedFocusSessions = sessions.filter(
    (s) =>
      s.sessionType === 'focus' &&
      s.completedAt &&
      isSameCalendarDay(new Date(s.startedAt), today)
  );

  const focusMinutesToday = todayCompletedFocusSessions.reduce(
    (sum, s) => sum + s.durationMinutes,
    0
  );

  const focusGoalMinutes = 240; // 4 hours
  const productivityScore =
    focusMinutesToday > 0
      ? Math.min(100, Math.round((focusMinutesToday / focusGoalMinutes) * 100))
      : 0;

  // Build weekly distribution from actual sessions in the last 7 days
  const weekDays: ('Mon' | 'Tue' | 'Wed' | 'Thu' | 'Fri' | 'Sat' | 'Sun')[] = [
    'Mon',
    'Tue',
    'Wed',
    'Thu',
    'Fri',
    'Sat',
    'Sun',
  ];
  const distributionMap: Record<string, number> = {
    Mon: 0,
    Tue: 0,
    Wed: 0,
    Thu: 0,
    Fri: 0,
    Sat: 0,
    Sun: 0,
  };

  const sevenDaysAgo = new Date(today);
  sevenDaysAgo.setDate(today.getDate() - 6);
  sevenDaysAgo.setHours(0, 0, 0, 0);

  for (const session of sessions) {
    if (!session.completedAt) continue;
    const sessDate = new Date(session.startedAt);
    if (sessDate >= sevenDaysAgo && sessDate <= today) {
      const dayName = DAY_NAMES[sessDate.getDay()];
      if (dayName in distributionMap) {
        distributionMap[dayName] += session.durationMinutes / 60;
      }
    }
  }

  const dailyDistribution = weekDays.map((day) => ({
    day,
    hours: Number(distributionMap[day].toFixed(1)),
  }));

  return {
    focusMinutesToday,
    focusGoalMinutes,
    completedTasksToday: tasksCompletedCount,
    totalTasksToday: totalTasksCount,
    streakDays: focusMinutesToday > 0 ? 1 : 0,
    productivityScore,
    dailyDistribution,
  };
}

export function useWorkSessions(tasksCompletedCount = 0, totalTasksCount = 0): UseWorkSessionsReturn {
  const { user } = useAuth();
  const [demoSessions, setDemoSessions] = useState<ClientWorkSession[]>(initialWorkSessions);
  const [dbSessions, setDbSessions] = useState<ClientWorkSession[]>([]);
  const [dbUserId, setDbUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(Boolean(user));
  const [error, setError] = useState<string | null>(null);

  const sequenceRef = useRef<number>(0);

  // Derive active sessions: if authenticated, strictly use dbSessions for active user; otherwise demoSessions
  const activeSessions = useMemo(() => {
    return user ? (dbUserId === user.id ? dbSessions : []) : demoSessions;
  }, [user, dbUserId, dbSessions, demoSessions]);
  const activeLoading = user ? (dbUserId === user.id ? loading : true) : false;

  // Reconcile server sessions with pending local outbox operations
  const reconcileSessions = useCallback(
    async (userId: string, serverSessions: ClientWorkSession[]): Promise<ClientWorkSession[]> => {
      try {
        const ops = await getOutboxOperationsForScope(userId);
        const sessionOps = ops.filter((o) => o.entityType === 'session');
        if (sessionOps.length === 0) return serverSessions;

        const sessionMap = new Map<string, ClientWorkSession>();
        for (const s of serverSessions) {
          sessionMap.set(s.id, s);
        }

        for (const op of sessionOps) {
          if (op.action === 'create' && op.payload) {
            const p = op.payload as {
              id?: string;
              title: string;
              session_type?: 'focus' | 'break' | 'long_break';
              duration_minutes: number;
              started_at: string;
              completed_at?: string;
              task_id?: string | null;
            };
            sessionMap.set(op.entityId, {
              id: op.entityId,
              title: p.title,
              sessionType: p.session_type || 'focus',
              durationMinutes: p.duration_minutes,
              startedAt: p.started_at,
              completedAt: p.completed_at || null,
              taskId: p.task_id || null,
              createdAt: op.createdAt,
            });
          } else if (op.action === 'delete') {
            sessionMap.delete(op.entityId);
          }
        }

        return Array.from(sessionMap.values()).sort(
          (a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()
        );
      } catch {
        return serverSessions;
      }
    },
    []
  );

  const fetchSessions = useCallback(
    async (userId: string) => {
      const currentSeq = ++sequenceRef.current;
      setError(null);

      // 1. Instant offline load from local IndexedDB cache
      try {
        const cached = await getOfflineCacheItem<ClientWorkSession[]>(userId, 'work_sessions');
        if (cached && currentSeq === sequenceRef.current) {
          setDbSessions(cached);
          setDbUserId(userId);
          setLoading(false);
        }
      } catch {
        // Fallback gracefully
      }

      if (!supabase) return;

      try {
        const { data, error: fetchErr } = await supabase
          .from('work_sessions')
          .select('*')
          .eq('user_id', userId)
          .order('started_at', { ascending: false });

        if (currentSeq !== sequenceRef.current) return;

        if (fetchErr) {
          setError('Offline or server unreachable. Showing cached work sessions.');
        } else {
          const clientSessions = (data || []).map(workSessionRowToClient);
          const reconciled = await reconcileSessions(userId, clientSessions);
          if (currentSeq === sequenceRef.current) {
            setDbSessions(reconciled);
            setDbUserId(userId);
            void setOfflineCacheItem(userId, 'work_sessions', reconciled);
          }
        }
      } catch {
        if (currentSeq !== sequenceRef.current) return;
        setError('Network offline. Showing cached work sessions.');
        setDbUserId(userId);
      } finally {
        if (currentSeq === sequenceRef.current) {
          setLoading(false);
        }
      }
    },
    [reconcileSessions]
  );

  // Handle user authentication transitions
  useEffect(() => {
    let isCurrent = true;
    const currentUserId = user?.id ?? null;

    if (!currentUserId) {
      queueMicrotask(() => {
        if (isCurrent) {
          setDbSessions([]);
          setDbUserId(null);
          setLoading(false);
          setError(null);
        }
      });
    } else {
      queueMicrotask(() => {
        if (isCurrent) {
          void fetchSessions(currentUserId);
        }
      });
    }

    return () => {
      isCurrent = false;
    };
  }, [user?.id, fetchSessions]);

  const recordSession = useCallback(
    async (data: {
      title: string;
      sessionType?: 'focus' | 'break' | 'long_break';
      durationMinutes: number;
      startedAt: string;
      completedAt?: string | null;
      taskId?: string | null;
    }): Promise<boolean> => {
      setError(null);

      // Local demo mode
      if (!user) {
        const newSess: ClientWorkSession = {
          id: `sess-${Date.now()}`,
          title: data.title.trim(),
          sessionType: data.sessionType || 'focus',
          durationMinutes: data.durationMinutes,
          startedAt: data.startedAt,
          completedAt: data.completedAt || null,
          taskId: data.taskId || null,
          createdAt: new Date().toISOString(),
        };
        setDemoSessions((prev) => [newSess, ...prev]);
        return true;
      }

      // Authenticated local-first persistence with outbox queue
      const sessionId = crypto.randomUUID();
      const completedAt = data.completedAt || new Date().toISOString();
      const clientSess: ClientWorkSession = {
        id: sessionId,
        title: data.title.trim(),
        sessionType: data.sessionType || 'focus',
        durationMinutes: data.durationMinutes,
        startedAt: data.startedAt,
        completedAt,
        taskId: data.taskId || null,
        createdAt: new Date().toISOString(),
      };

      setDbSessions((prev) => {
        const next = [clientSess, ...prev];
        void setOfflineCacheItem(user.id, 'work_sessions', next);
        return next;
      });

      try {
        const payload = workSessionToInsertPayload(
          { ...data, id: sessionId, completedAt },
          user.id
        );
        await enqueueOutboxOperation({
          id: crypto.randomUUID(),
          scope: user.id,
          entityType: 'session',
          entityId: sessionId,
          action: 'create',
          payload,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          status: 'pending',
          retryCount: 0,
        });

        void processOutbox(user.id);
        return true;
      } catch (err) {
        console.warn('[useWorkSessions] Failed to enqueue work session create outbox op:', err);
        setError('Failed to queue work session locally.');
        return false;
      }
    },
    [user]
  );

  const deleteSession = useCallback(
    async (id: string): Promise<boolean> => {
      setError(null);

      // Local demo mode
      if (!user) {
        setDemoSessions((prev) => prev.filter((s) => s.id !== id));
        return true;
      }

      // Optimistic delete with outbox queue
      const target = dbSessions.find((s) => s.id === id);
      if (!target) return false;
      const nextSessions = dbSessions.filter((s) => s.id !== id);
      setDbSessions(nextSessions);
      void setOfflineCacheItem(user.id, 'work_sessions', nextSessions);

      try {
        await enqueueOutboxOperation({
          id: crypto.randomUUID(),
          scope: user.id,
          entityType: 'session',
          entityId: id,
          action: 'delete',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          status: 'pending',
          retryCount: 0,
        });

        void processOutbox(user.id);
        return true;
      } catch (err) {
        console.warn('[useWorkSessions] Failed to enqueue work session delete outbox op:', err);
        setError('Failed to queue work session deletion locally.');
        return false;
      }
    },
    [user, dbSessions]
  );

  const retry = useCallback(() => {
    if (user?.id) {
      void fetchSessions(user.id);
    }
  }, [user, fetchSessions]);

  const resetDemoData = useCallback(() => {
    if (!user) {
      setDemoSessions(initialWorkSessions);
      setError(null);
    }
  }, [user]);

  const workSummary = useMemo(() => {
    return computeWorkSummary(Boolean(user), activeSessions, tasksCompletedCount, totalTasksCount);
  }, [user, activeSessions, tasksCompletedCount, totalTasksCount]);

  return {
    sessions: activeSessions,
    workSummary,
    loading: activeLoading,
    error,
    recordSession,
    deleteSession,
    retry,
    resetDemoData,
  };
}
