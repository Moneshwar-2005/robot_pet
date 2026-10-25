import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import type { ClientWorkSession } from '../lib/adapters';
import { workSessionRowToClient, workSessionToInsertPayload } from '../lib/adapters';
import type { WorkSummary } from '../types';
import { initialWorkSummary } from '../data/mockData';
import { useAuth } from '../context/useAuth';
import { supabase } from '../lib/supabase';

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

  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();

  sessions.forEach((s) => {
    if (s.sessionType === 'focus' && s.completedAt) {
      const sessDate = new Date(s.startedAt);
      const startOfSess = new Date(sessDate.getFullYear(), sessDate.getMonth(), sessDate.getDate()).getTime();
      const diffCalendarDays = Math.round((startOfToday - startOfSess) / (1000 * 60 * 60 * 24));
      if (diffCalendarDays >= 0 && diffCalendarDays < 7) {
        const dayName = DAY_NAMES[sessDate.getDay()];
        if (dayName in distributionMap) {
          distributionMap[dayName] += s.durationMinutes / 60;
        }
      }
    }
  });

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
    if (!supabase) return;
    const currentSeq = ++sequenceRef.current;
    setLoading(true);
    setError(null);

    try {
      const { data, error: fetchErr } = await supabase
        .from('work_sessions')
        .select('*')
        .eq('user_id', userId)
        .order('started_at', { ascending: false });

      if (currentSeq !== sequenceRef.current) return;

      if (fetchErr) {
        setError('Failed to load work session telemetry.');
        setDbSessions([]);
      } else {
        setDbSessions((data || []).map(workSessionRowToClient));
      }
      setDbUserId(userId);
    } catch {
      if (currentSeq !== sequenceRef.current) return;
      setError('An unexpected network error occurred while loading work sessions.');
      setDbSessions([]);
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

      // Authenticated persistence
      try {
        const payload = workSessionToInsertPayload(data, user.id);
        const { data: created, error: insertErr } = await supabase
          .from('work_sessions')
          .insert(payload)
          .select('*')
          .single();

        if (insertErr || !created) {
          setError(insertErr?.message || 'Failed to save work session.');
          return false;
        }

        const clientSess = workSessionRowToClient(created);
        setDbSessions((prev) => [clientSess, ...prev]);
        return true;
      } catch {
        setError('Network error while saving work session.');
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
      setDbSessions((prev) => prev.filter((s) => s.id !== id));

      try {
        const { error: deleteErr } = await supabase
          .from('work_sessions')
          .delete()
          .eq('id', id)
          .eq('user_id', user.id);

        if (deleteErr) {
          setDbSessions((prev) => (prev.some((s) => s.id === id) ? prev : [target, ...prev]));
          setError(deleteErr.message || 'Failed to delete work session.');
          return false;
        }

        return true;
      } catch {
        setDbSessions((prev) => (prev.some((s) => s.id === id) ? prev : [target, ...prev]));
        setError('Network error while deleting work session.');
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

  // Derive WorkSummary strictly from activeSessions for authenticated accounts, or fallback to mock summary
  const workSummary = useMemo<WorkSummary>(() => {
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
