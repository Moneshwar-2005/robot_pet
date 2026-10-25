import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import type { ClientWorkSession } from '../lib/adapters';
import { workSessionRowToClient, workSessionToInsertPayload } from '../lib/adapters';
import type { WorkSummary } from '../types';
import { initialWorkSummary } from '../data/mockData';
import { useAuth } from '../context/useAuth';
import { supabase } from '../lib/supabase';
import { getOfflineCacheItem, setOfflineCacheItem } from '../lib/offlineDb';

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
    title: 'CSS Theme & OLED Styling',
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

  const fetchSessions = useCallback(async (userId: string) => {
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
        setDbSessions(clientSessions);
        setDbUserId(userId);
        void setOfflineCacheItem(userId, 'work_sessions', clientSessions);
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
  }, []);

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
      if (!user || !supabase) {
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

      // Authenticated persistence: enforce required completed_at
      const completedAt = data.completedAt || new Date().toISOString();
      const sessionPayload = { ...data, completedAt };

      try {
        const payload = workSessionToInsertPayload(sessionPayload, user.id);
        const { data: created, error: insertErr } = await supabase
          .from('work_sessions')
          .insert(payload)
          .select('*')
          .single();

        if (insertErr || !created) {
          setError(insertErr?.message || 'Failed to save work session to server.');
          return false;
        }

        const clientSess = workSessionRowToClient(created);
        setDbSessions((prev) => {
          const next = [clientSess, ...prev];
          void setOfflineCacheItem(user.id, 'work_sessions', next);
          return next;
        });
        return true;
      } catch {
        setError('Network offline. Work session could not be saved to server.');
        return false;
      }
    },
    [user]
  );

  const deleteSession = useCallback(
    async (id: string): Promise<boolean> => {
      setError(null);

      // Local demo mode
      if (!user || !supabase) {
        setDemoSessions((prev) => prev.filter((s) => s.id !== id));
        return true;
      }

      // Optimistic delete with targeted rollback
      const target = dbSessions.find((s) => s.id === id);
      if (!target) return false;
      const nextSessions = dbSessions.filter((s) => s.id !== id);
      setDbSessions(nextSessions);
      void setOfflineCacheItem(user.id, 'work_sessions', nextSessions);

      try {
        const { error: deleteErr } = await supabase
          .from('work_sessions')
          .delete()
          .eq('id', id)
          .eq('user_id', user.id);

        if (deleteErr) {
          setDbSessions((prev) => (prev.some((s) => s.id === id) ? prev : [target, ...prev]));
          void setOfflineCacheItem(user.id, 'work_sessions', dbSessions);
          setError(deleteErr.message || 'Failed to delete work session from server.');
          return false;
        }

        return true;
      } catch {
        setDbSessions((prev) => (prev.some((s) => s.id === id) ? prev : [target, ...prev]));
        void setOfflineCacheItem(user.id, 'work_sessions', dbSessions);
        setError('Network offline. Work session deletion could not be saved to server.');
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
