/**
 * Kuro Companion — Normalized Timer & Work Tracking Hook
 *
 * Scope: Phase 10 Milestone 4 (Normalized Timer & Work Tracking Integration)
 *
 * Responsibilities:
 * 1. Manages time_entries, time_entry_pauses, and time_entry_idles.
 * 2. Implements Start, Pause, Resume, and Stop with exact timestamp math.
 * 3. Reconstructs timer state from persisted database/cache rows upon mount/refresh.
 * 4. Enforces single active timer per user.
 * 5. Respects privacy settings: zero background idle tracking when activity_tracking_enabled is false.
 * 6. Guarantees deterministic outbox synchronization: parent time entries before child pauses/idles.
 * 7. Isolates cache and in-memory state across user accounts.
 */

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import type { TimeEntry, TimeEntryPause, TimeEntryIdle, TimeEntryTrackingSource, TimeEntryState } from '../types';
import { useAuth } from '../context/useAuth';
import { supabase } from '../lib/supabase';
import {
  timeEntryRowToTimeEntry,
  timeEntryToInsertPayload,
  timeEntryToUpdatePayload,
  timeEntryPauseRowToPause,
  timeEntryPauseToInsertPayload,
  timeEntryPauseToUpdatePayload,
  timeEntryIdleRowToIdle,
  timeEntryIdleToInsertPayload,
} from '../lib/adapters';
import {
  calculateActiveDuration,
  calculateIdleDuration,
  isStaleTimer,
} from '../lib/timerCalculations';
import {
  getOfflineCacheItem,
  setOfflineCacheItem,
  enqueueOutboxOperation,
  getOutboxOperationsForScope,
} from '../lib/offlineDb';
import { processOutbox } from '../lib/syncEngine';

export interface UseNormalizedTimerOptions {
  activityTrackingEnabled?: boolean;
  idleThresholdSeconds?: number;
}

export interface UseNormalizedTimerReturn {
  activeEntry: TimeEntry | null;
  activePauses: TimeEntryPause[];
  activeIdles: TimeEntryIdle[];
  recentEntries: TimeEntry[];
  timerStatus: 'idle' | 'running' | 'paused';
  elapsedSeconds: number;
  loading: boolean;
  error: string | null;
  startTimer: (options?: {
    taskId?: string | null;
    projectId?: string | null;
    trackingSource?: TimeEntryTrackingSource;
  }) => Promise<boolean>;
  pauseTimer: () => Promise<boolean>;
  resumeTimer: () => Promise<boolean>;
  stopTimer: () => Promise<boolean>;
  deleteEntry: (entryId: string) => Promise<boolean>;
  refresh: () => Promise<void>;
  clearError: () => void;
  isStale: boolean;
}

const DEMO_ACTIVE_KEY = 'kuro_demo_active_timer';
const DEMO_PAUSES_KEY = 'kuro_demo_timer_pauses';
const DEMO_IDLES_KEY = 'kuro_demo_timer_idles';
const DEMO_RECENT_KEY = 'kuro_demo_recent_timers';

export function useNormalizedTimer(options: UseNormalizedTimerOptions = {}): UseNormalizedTimerReturn {
  const { user } = useAuth();
  const { activityTrackingEnabled = false, idleThresholdSeconds = 300 } = options;

  const [activeEntry, setActiveEntry] = useState<TimeEntry | null>(null);
  const [activePauses, setActivePauses] = useState<TimeEntryPause[]>([]);
  const [activeIdles, setActiveIdles] = useState<TimeEntryIdle[]>([]);
  const [recentEntries, setRecentEntries] = useState<TimeEntry[]>([]);
  const [dbUserId, setDbUserId] = useState<string | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState<number>(0);
  const [loading, setLoading] = useState<boolean>(Boolean(user));
  const [error, setError] = useState<string | null>(null);

  const sequenceRef = useRef<number>(0);
  const lastUserActivityRef = useRef<number>(0);
  const currentIdleRef = useRef<TimeEntryIdle | null>(null);

  // Derive timer status
  const timerStatus: 'idle' | 'running' | 'paused' = useMemo(() => {
    if (!activeEntry) return 'idle';
    if (activeEntry.state === 'paused') return 'paused';
    if (activeEntry.state === 'running') return 'running';
    return 'idle';
  }, [activeEntry]);

  const isStale = useMemo(() => isStaleTimer(activeEntry), [activeEntry]);

  // ---------------------------------------------------------------------------
  // 1. Live Duration Ticking
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (!activeEntry) {
      queueMicrotask(() => {
        setElapsedSeconds(0);
      });
      return;
    }

    // Immediately calculate duration on state change
    const updateElapsed = () => {
      const now = Date.now();
      const secs = calculateActiveDuration(activeEntry, activePauses, activeIdles, now);
      setElapsedSeconds(secs);
    };

    updateElapsed();

    // Only tick live interval if timer is actively running
    if (activeEntry.state !== 'running') {
      return;
    }

    const interval = setInterval(updateElapsed, 1000);
    return () => clearInterval(interval);
  }, [activeEntry, activePauses, activeIdles]);

  // ---------------------------------------------------------------------------
  // 2. Multi-User Account Isolation & Data Reinitialization
  // ---------------------------------------------------------------------------
  useEffect(() => {
    // If user signs out or changes, immediately purge user-scoped timer state
    if (!user) {
      queueMicrotask(() => {
        setDbUserId(null);
        // Load demo timer from local storage if available
        try {
          const rawActive = localStorage.getItem(DEMO_ACTIVE_KEY);
          const rawPauses = localStorage.getItem(DEMO_PAUSES_KEY);
          const rawIdles = localStorage.getItem(DEMO_IDLES_KEY);
          const rawRecent = localStorage.getItem(DEMO_RECENT_KEY);
          setActiveEntry(rawActive ? JSON.parse(rawActive) : null);
          setActivePauses(rawPauses ? JSON.parse(rawPauses) : []);
          setActiveIdles(rawIdles ? JSON.parse(rawIdles) : []);
          setRecentEntries(rawRecent ? JSON.parse(rawRecent) : []);
        } catch {
          setActiveEntry(null);
          setActivePauses([]);
          setActiveIdles([]);
          setRecentEntries([]);
        }
        setLoading(false);
      });
      return;
    }

    // Authenticated user switch: reset state before loading
    if (dbUserId !== user.id) {
      queueMicrotask(() => {
        setActiveEntry(null);
        setActivePauses([]);
        setActiveIdles([]);
        setRecentEntries([]);
        setElapsedSeconds(0);
        setLoading(true);
      });
    }
  }, [user, dbUserId]);

  // ---------------------------------------------------------------------------
  // 3. Load & Reconcile Timer Data from Local Cache & Supabase
  // ---------------------------------------------------------------------------
  const fetchTimerData = useCallback(async (userId: string) => {
    const currentSeq = ++sequenceRef.current;
    setError(null);

    // 1. Instant offline load from local IndexedDB cache
    try {
      const [cachedActive, cachedPauses, cachedIdles, cachedRecent] = await Promise.all([
        getOfflineCacheItem<TimeEntry>(userId, 'active_time_entry'),
        getOfflineCacheItem<TimeEntryPause[]>(userId, 'active_time_entry_pauses'),
        getOfflineCacheItem<TimeEntryIdle[]>(userId, 'active_time_entry_idles'),
        getOfflineCacheItem<TimeEntry[]>(userId, 'recent_time_entries'),
      ]);

      if (currentSeq === sequenceRef.current) {
        if (cachedActive) setActiveEntry(cachedActive);
        if (cachedPauses) setActivePauses(cachedPauses);
        if (cachedIdles) setActiveIdles(cachedIdles);
        if (cachedRecent) setRecentEntries(cachedRecent);
        setDbUserId(userId);
        setLoading(false);
      }
    } catch {
      // Fallback gracefully
    }

    if (!supabase) return;

    // 2. Remote fetch from Supabase
    try {
      // A. Query running or paused time entry
      const { data: activeRows, error: activeErr } = await supabase
        .from('time_entries')
        .select('*')
        .eq('user_id', userId)
        .in('state', ['running', 'paused'])
        .order('created_at', { ascending: false })
        .limit(1);

      if (activeErr) throw activeErr;

      let remoteActive: TimeEntry | null = null;
      let remotePauses: TimeEntryPause[] = [];
      let remoteIdles: TimeEntryIdle[] = [];

      if (activeRows && activeRows.length > 0) {
        remoteActive = timeEntryRowToTimeEntry(activeRows[0]);

        // Query pauses and idles for this active entry
        const [pausesRes, idlesRes] = await Promise.all([
          supabase
            .from('time_entry_pauses')
            .select('*')
            .eq('time_entry_id', remoteActive.id)
            .order('paused_at', { ascending: true }),
          supabase
            .from('time_entry_idles')
            .select('*')
            .eq('time_entry_id', remoteActive.id)
            .order('started_at', { ascending: true }),
        ]);

        if (pausesRes.data) {
          remotePauses = pausesRes.data.map(timeEntryPauseRowToPause);
        }
        if (idlesRes.data) {
          remoteIdles = idlesRes.data.map(timeEntryIdleRowToIdle);
        }
      }

      // B. Query recent completed entries (up to 50)
      const { data: recentRows, error: recentErr } = await supabase
        .from('time_entries')
        .select('*')
        .eq('user_id', userId)
        .eq('state', 'completed')
        .order('started_at', { ascending: false })
        .limit(50);

      if (recentErr) throw recentErr;

      let remoteRecent = recentRows ? recentRows.map(timeEntryRowToTimeEntry) : [];

      // C. Reconcile with pending local Outbox operations
      const ops = await getOutboxOperationsForScope(userId);
      const entryOps = ops.filter((o) => o.entityType === 'time_entry');
      const pauseOps = ops.filter((o) => o.entityType === 'time_entry_pause');
      const idleOps = ops.filter((o) => o.entityType === 'time_entry_idle');

      // Check if active entry has pending local update
      if (remoteActive) {
        const updateOp = entryOps.find((o) => o.entityId === remoteActive!.id && o.action === 'update');
        if (updateOp && updateOp.payload) {
          const payload = updateOp.payload as Partial<TimeEntry>;
          if (payload.state) remoteActive.state = payload.state as TimeEntryState;
          if (payload.endedAt) remoteActive.endedAt = payload.endedAt;
        }
      }

      // Check for pending newly created active entry in outbox
      const pendingCreate = entryOps.find(
        (o) => o.action === 'create' && (o.payload as { state?: string })?.state !== 'completed'
      );
      if (pendingCreate && pendingCreate.payload) {
        const p = pendingCreate.payload as {
          id?: string;
          user_id: string;
          task_id?: string | null;
          project_id?: string | null;
          started_at: string;
          ended_at?: string | null;
          active_duration_seconds?: number;
          idle_duration_seconds?: number;
          tracking_source?: TimeEntryTrackingSource;
          state?: TimeEntryState;
        };
        remoteActive = {
          id: p.id || pendingCreate.entityId,
          userId,
          taskId: p.task_id ?? null,
          projectId: p.project_id ?? null,
          startedAt: p.started_at,
          endedAt: p.ended_at ?? null,
          activeDurationSeconds: p.active_duration_seconds ?? 0,
          idleDurationSeconds: p.idle_duration_seconds ?? 0,
          trackingSource: p.tracking_source ?? 'manual',
          state: p.state ?? 'running',
          isRecovered: false,
          recoveryReason: null,
          createdAt: pendingCreate.createdAt,
          updatedAt: pendingCreate.createdAt,
          syncStatus: 'pending-sync',
        };
      }

      // Reconcile pending pauses
      for (const pop of pauseOps) {
        if (pop.action === 'create' && pop.payload) {
          const pp = pop.payload as { time_entry_id: string; paused_at: string; resumed_at?: string | null };
          if (remoteActive && pp.time_entry_id === remoteActive.id) {
            const exists = remotePauses.some((p) => p.id === pop.entityId);
            if (!exists) {
              remotePauses.push({
                id: pop.entityId,
                userId,
                timeEntryId: pp.time_entry_id,
                pausedAt: pp.paused_at,
                resumedAt: pp.resumed_at ?? null,
                createdAt: pop.createdAt,
                syncStatus: 'pending-sync',
              });
            }
          }
        } else if (pop.action === 'update' && pop.payload) {
          const pp = pop.payload as { resumed_at?: string | null };
          remotePauses = remotePauses.map((p) =>
            p.id === pop.entityId ? { ...p, resumedAt: pp.resumed_at ?? p.resumedAt } : p
          );
        }
      }

      // Reconcile pending idles
      for (const iop of idleOps) {
        if (iop.action === 'create' && iop.payload) {
          const ip = iop.payload as { time_entry_id: string; started_at: string; ended_at?: string | null };
          if (remoteActive && ip.time_entry_id === remoteActive.id) {
            const exists = remoteIdles.some((i) => i.id === iop.entityId);
            if (!exists) {
              remoteIdles.push({
                id: iop.entityId,
                userId,
                timeEntryId: ip.time_entry_id,
                startedAt: ip.started_at,
                endedAt: ip.ended_at ?? null,
                createdAt: iop.createdAt,
              });
            }
          }
        } else if (iop.action === 'update' && iop.payload) {
          const ip = iop.payload as { ended_at?: string | null };
          remoteIdles = remoteIdles.map((i) =>
            i.id === iop.entityId ? { ...i, endedAt: ip.ended_at ?? i.endedAt } : i
          );
        }
      }

      // Filter out deleted recent entries
      const deletedIds = new Set(entryOps.filter((o) => o.action === 'delete').map((o) => o.entityId));
      remoteRecent = remoteRecent.filter((r) => !deletedIds.has(r.id));

      if (currentSeq === sequenceRef.current) {
        setActiveEntry(remoteActive);
        setActivePauses(remotePauses);
        setActiveIdles(remoteIdles);
        setRecentEntries(remoteRecent);
        setDbUserId(userId);
        setLoading(false);

        // Update local IndexedDB caches
        void setOfflineCacheItem(userId, 'active_time_entry', remoteActive);
        void setOfflineCacheItem(userId, 'active_time_entry_pauses', remotePauses);
        void setOfflineCacheItem(userId, 'active_time_entry_idles', remoteIdles);
        void setOfflineCacheItem(userId, 'recent_time_entries', remoteRecent);
      }
    } catch (err: unknown) {
      console.warn('[Kuro useNormalizedTimer] Failed to fetch remote timer state:', err);
      if (currentSeq === sequenceRef.current) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    if (user?.id) {
      const uid = user.id;
      queueMicrotask(() => {
        void fetchTimerData(uid);
      });
    }
  }, [user?.id, fetchTimerData]);

  // ---------------------------------------------------------------------------
  // 4. Privacy-Preserving Idle Detection (Strictly Opt-In)
  // ---------------------------------------------------------------------------
  useEffect(() => {
    // If activity tracking is disabled, do NOT attach activity listeners or track idle
    if (!activityTrackingEnabled) return;
    if (!activeEntry || activeEntry.state !== 'running') return;

    if (lastUserActivityRef.current === 0) {
      lastUserActivityRef.current = Date.now();
    }

    const handleUserActivity = () => {
      lastUserActivityRef.current = Date.now();

      // If we are currently in an idle interval, close it
      if (currentIdleRef.current) {
        const idleToClose = currentIdleRef.current;
        currentIdleRef.current = null;
        const endedAt = new Date().toISOString();

        setActiveIdles((prev) =>
          prev.map((i) => (i.id === idleToClose.id ? { ...i, endedAt } : i))
        );

        if (user) {
          void enqueueOutboxOperation({
            id: crypto.randomUUID(),
            scope: user.id,
            entityType: 'time_entry_idle',
            entityId: idleToClose.id,
            action: 'update',
            payload: { ended_at: endedAt },
            createdAt: endedAt,
            updatedAt: endedAt,
            status: 'pending',
            retryCount: 0,
          });
          void processOutbox(user.id);
        }
      }
    };

    const events = ['mousemove', 'keydown', 'scroll', 'touchstart'];
    for (const ev of events) {
      window.addEventListener(ev, handleUserActivity, { passive: true });
    }

    // Periodic check for inactivity
    const interval = setInterval(() => {
      const now = Date.now();
      const inactiveSeconds = Math.floor((now - lastUserActivityRef.current) / 1000);

      if (inactiveSeconds >= idleThresholdSeconds && !currentIdleRef.current) {
        // User has exceeded idle threshold: create open idle interval
        const startedAt = new Date(lastUserActivityRef.current).toISOString();
        const idleId = crypto.randomUUID();
        const newIdle: TimeEntryIdle = {
          id: idleId,
          userId: user?.id || 'demo',
          timeEntryId: activeEntry.id,
          startedAt,
          endedAt: null,
          createdAt: startedAt,
        };

        currentIdleRef.current = newIdle;
        setActiveIdles((prev) => [...prev, newIdle]);

        if (user) {
          const insertPayload = timeEntryIdleToInsertPayload(newIdle, user.id);
          void enqueueOutboxOperation({
            id: crypto.randomUUID(),
            scope: user.id,
            entityType: 'time_entry_idle',
            entityId: idleId,
            action: 'create',
            payload: insertPayload,
            createdAt: startedAt,
            updatedAt: startedAt,
            status: 'pending',
            retryCount: 0,
          });
          void processOutbox(user.id);
        }
      }
    }, 10000);

    return () => {
      for (const ev of events) {
        window.removeEventListener(ev, handleUserActivity);
      }
      clearInterval(interval);
    };
  }, [activityTrackingEnabled, idleThresholdSeconds, activeEntry, user]);

  // ---------------------------------------------------------------------------
  // 5. Timer Operations: Start, Pause, Resume, Stop, Delete
  // ---------------------------------------------------------------------------

  const startTimer = useCallback(
    async (startOptions?: {
      taskId?: string | null;
      projectId?: string | null;
      trackingSource?: TimeEntryTrackingSource;
    }): Promise<boolean> => {
      setError(null);

      // Guard: Exactly one active timer permitted
      if (activeEntry && (activeEntry.state === 'running' || activeEntry.state === 'paused')) {
        setError('Another timer is already running or paused. Please stop it first.');
        return false;
      }

      const startedAt = new Date().toISOString();
      const entryId = crypto.randomUUID();

      const newEntry: TimeEntry = {
        id: entryId,
        userId: user?.id || 'demo',
        taskId: startOptions?.taskId ?? null,
        projectId: startOptions?.projectId ?? null,
        startedAt,
        endedAt: null,
        activeDurationSeconds: 0,
        idleDurationSeconds: 0,
        trackingSource: startOptions?.trackingSource ?? 'manual',
        state: 'running',
        isRecovered: false,
        recoveryReason: null,
        createdAt: startedAt,
        updatedAt: startedAt,
        syncStatus: user ? 'pending-sync' : 'local-only',
      };

      // Unauthenticated demo mode
      if (!user) {
        setActiveEntry(newEntry);
        setActivePauses([]);
        setActiveIdles([]);
        setElapsedSeconds(0);
        try {
          localStorage.setItem(DEMO_ACTIVE_KEY, JSON.stringify(newEntry));
          localStorage.setItem(DEMO_PAUSES_KEY, JSON.stringify([]));
          localStorage.setItem(DEMO_IDLES_KEY, JSON.stringify([]));
        } catch {}
        return true;
      }

      // Authenticated mode: optimistic update + outbox
      setActiveEntry(newEntry);
      setActivePauses([]);
      setActiveIdles([]);
      setElapsedSeconds(0);
      void setOfflineCacheItem(user.id, 'active_time_entry', newEntry);
      void setOfflineCacheItem(user.id, 'active_time_entry_pauses', []);
      void setOfflineCacheItem(user.id, 'active_time_entry_idles', []);

      const insertPayload = timeEntryToInsertPayload(newEntry, user.id);
      await enqueueOutboxOperation({
        id: crypto.randomUUID(),
        scope: user.id,
        entityType: 'time_entry',
        entityId: entryId,
        action: 'create',
        payload: insertPayload,
        createdAt: startedAt,
        updatedAt: startedAt,
        status: 'pending',
        retryCount: 0,
        sequenceNumber: 1,
      });

      void processOutbox(user.id);
      return true;
    },
    [activeEntry, user]
  );

  const pauseTimer = useCallback(async (): Promise<boolean> => {
    setError(null);
    if (!activeEntry || activeEntry.state !== 'running') {
      return false;
    }

    const pausedAt = new Date().toISOString();
    const pauseId = crypto.randomUUID();

    // 1. Check whether an idle interval is currently open
    const openIdle = currentIdleRef.current || activeIdles.find((i) => i.endedAt === null);
    let nextIdles = activeIdles;
    if (openIdle) {
      currentIdleRef.current = null;
      nextIdles = activeIdles.map((i) =>
        i.id === openIdle.id ? { ...i, endedAt: pausedAt } : i
      );
      setActiveIdles(nextIdles);
    }

    const newPause: TimeEntryPause = {
      id: pauseId,
      userId: user?.id || 'demo',
      timeEntryId: activeEntry.id,
      pausedAt,
      resumedAt: null,
      createdAt: pausedAt,
      syncStatus: user ? 'pending-sync' : 'local-only',
    };

    const nextEntry: TimeEntry = {
      ...activeEntry,
      state: 'paused',
      updatedAt: pausedAt,
      syncStatus: user ? 'pending-sync' : 'local-only',
    };
    const nextPauses = [...activePauses, newPause];

    // Demo mode
    if (!user) {
      setActiveEntry(nextEntry);
      setActivePauses(nextPauses);
      try {
        localStorage.setItem(DEMO_ACTIVE_KEY, JSON.stringify(nextEntry));
        localStorage.setItem(DEMO_PAUSES_KEY, JSON.stringify(nextPauses));
        if (openIdle) {
          localStorage.setItem(DEMO_IDLES_KEY, JSON.stringify(nextIdles));
        }
      } catch {}
      return true;
    }

    // Authenticated mode: optimistic update
    setActiveEntry(nextEntry);
    setActivePauses(nextPauses);
    void setOfflineCacheItem(user.id, 'active_time_entry', nextEntry);
    void setOfflineCacheItem(user.id, 'active_time_entry_pauses', nextPauses);
    if (openIdle) {
      void setOfflineCacheItem(user.id, 'active_time_entry_idles', nextIdles);
    }

    // Step A: Close open idle in the outbox BEFORE creating pause
    if (openIdle) {
      await enqueueOutboxOperation({
        id: crypto.randomUUID(),
        scope: user.id,
        entityType: 'time_entry_idle',
        entityId: openIdle.id,
        action: 'update',
        payload: { ended_at: pausedAt },
        createdAt: pausedAt,
        updatedAt: pausedAt,
        status: 'pending',
        retryCount: 0,
        sequenceNumber: 1,
      });
    }

    // Step B: Create and enqueue child pause create
    const pausePayload = timeEntryPauseToInsertPayload(newPause, user.id);
    await enqueueOutboxOperation({
      id: crypto.randomUUID(),
      scope: user.id,
      entityType: 'time_entry_pause',
      entityId: pauseId,
      action: 'create',
      payload: pausePayload,
      createdAt: pausedAt,
      updatedAt: pausedAt,
      status: 'pending',
      retryCount: 0,
      sequenceNumber: 2,
    });

    // Step C: Update parent entry to paused
    const entryPayload = timeEntryToUpdatePayload({ state: 'paused' });
    await enqueueOutboxOperation({
      id: crypto.randomUUID(),
      scope: user.id,
      entityType: 'time_entry',
      entityId: activeEntry.id,
      action: 'update',
      payload: entryPayload,
      createdAt: pausedAt,
      updatedAt: pausedAt,
      status: 'pending',
      retryCount: 0,
      sequenceNumber: 3,
    });

    void processOutbox(user.id);
    return true;
  }, [activeEntry, activePauses, activeIdles, user]);

  const resumeTimer = useCallback(async (): Promise<boolean> => {
    setError(null);
    if (!activeEntry || activeEntry.state !== 'paused') {
      return false;
    }

    lastUserActivityRef.current = Date.now();
    const resumedAt = new Date().toISOString();
    const openPause = activePauses.find((p) => p.resumedAt === null);

    const nextPauses = openPause
      ? activePauses.map((p) => (p.id === openPause.id ? { ...p, resumedAt } : p))
      : activePauses;

    const nextEntry: TimeEntry = {
      ...activeEntry,
      state: 'running',
      updatedAt: resumedAt,
      syncStatus: user ? 'pending-sync' : 'local-only',
    };

    // Demo mode
    if (!user) {
      setActiveEntry(nextEntry);
      setActivePauses(nextPauses);
      try {
        localStorage.setItem(DEMO_ACTIVE_KEY, JSON.stringify(nextEntry));
        localStorage.setItem(DEMO_PAUSES_KEY, JSON.stringify(nextPauses));
      } catch {}
      return true;
    }

    // Authenticated mode: optimistic update
    setActiveEntry(nextEntry);
    setActivePauses(nextPauses);
    void setOfflineCacheItem(user.id, 'active_time_entry', nextEntry);
    void setOfflineCacheItem(user.id, 'active_time_entry_pauses', nextPauses);

    if (openPause) {
      const pausePayload = timeEntryPauseToUpdatePayload({ resumedAt });
      await enqueueOutboxOperation({
        id: crypto.randomUUID(),
        scope: user.id,
        entityType: 'time_entry_pause',
        entityId: openPause.id,
        action: 'update',
        payload: pausePayload,
        createdAt: resumedAt,
        updatedAt: resumedAt,
        status: 'pending',
        retryCount: 0,
        sequenceNumber: 1,
      });
    }

    const entryPayload = timeEntryToUpdatePayload({ state: 'running' });
    await enqueueOutboxOperation({
      id: crypto.randomUUID(),
      scope: user.id,
      entityType: 'time_entry',
      entityId: activeEntry.id,
      action: 'update',
      payload: entryPayload,
      createdAt: resumedAt,
      updatedAt: resumedAt,
      status: 'pending',
      retryCount: 0,
      sequenceNumber: 2,
    });

    void processOutbox(user.id);
    return true;
  }, [activeEntry, activePauses, user]);

  const stopTimer = useCallback(async (): Promise<boolean> => {
    setError(null);
    if (!activeEntry) {
      return false;
    }

    const endedAt = new Date().toISOString();
    const endMs = new Date(endedAt).getTime();

    // 1. Close open pause if currently paused
    let finalPauses = activePauses;
    const openPause = activePauses.find((p) => p.resumedAt === null);
    if (openPause) {
      finalPauses = activePauses.map((p) =>
        p.id === openPause.id ? { ...p, resumedAt: endedAt } : p
      );
    }

    // 2. Close open idle if currently idle
    let finalIdles = activeIdles;
    const openIdle = currentIdleRef.current || activeIdles.find((i) => i.endedAt === null);
    if (currentIdleRef.current) {
      currentIdleRef.current = null;
    }
    if (openIdle) {
      finalIdles = activeIdles.map((i) =>
        i.id === openIdle.id ? { ...i, endedAt } : i
      );
    }

    // 3. Compute final active and idle durations
    const activeDurationSeconds = calculateActiveDuration(
      activeEntry,
      finalPauses,
      finalIdles,
      endMs
    );
    const idleDurationSeconds = calculateIdleDuration(finalIdles, endMs);

    const completedEntry: TimeEntry = {
      ...activeEntry,
      endedAt,
      state: 'completed',
      activeDurationSeconds,
      idleDurationSeconds,
      updatedAt: endedAt,
      syncStatus: user ? 'pending-sync' : 'local-only',
    };

    // Demo mode
    if (!user) {
      setActiveEntry(null);
      setActivePauses([]);
      setActiveIdles([]);
      setElapsedSeconds(0);
      setRecentEntries((prev) => [completedEntry, ...prev]);
      try {
        localStorage.removeItem(DEMO_ACTIVE_KEY);
        localStorage.removeItem(DEMO_PAUSES_KEY);
        localStorage.removeItem(DEMO_IDLES_KEY);
        const existingRecent = JSON.parse(localStorage.getItem(DEMO_RECENT_KEY) || '[]');
        localStorage.setItem(DEMO_RECENT_KEY, JSON.stringify([completedEntry, ...existingRecent]));
      } catch {}
      return true;
    }

    // Authenticated mode: optimistic update
    setActiveEntry(null);
    setActivePauses([]);
    setActiveIdles([]);
    setElapsedSeconds(0);
    setRecentEntries((prev) => [completedEntry, ...prev]);

    void setOfflineCacheItem(user.id, 'active_time_entry', null);
    void setOfflineCacheItem(user.id, 'active_time_entry_pauses', []);
    void setOfflineCacheItem(user.id, 'active_time_entry_idles', []);
    void setOfflineCacheItem(user.id, 'recent_time_entries', [completedEntry, ...recentEntries]);

    // Enqueue pause close operation if open pause existed
    if (openPause) {
      await enqueueOutboxOperation({
        id: crypto.randomUUID(),
        scope: user.id,
        entityType: 'time_entry_pause',
        entityId: openPause.id,
        action: 'update',
        payload: { resumed_at: endedAt },
        createdAt: endedAt,
        updatedAt: endedAt,
        status: 'pending',
        retryCount: 0,
        sequenceNumber: 1,
      });
    }

    // Enqueue idle close operation if open idle existed
    if (openIdle) {
      await enqueueOutboxOperation({
        id: crypto.randomUUID(),
        scope: user.id,
        entityType: 'time_entry_idle',
        entityId: openIdle.id,
        action: 'update',
        payload: { ended_at: endedAt },
        createdAt: endedAt,
        updatedAt: endedAt,
        status: 'pending',
        retryCount: 0,
        sequenceNumber: 1,
      });
    }

    // Enqueue completed entry update
    const updatePayload = timeEntryToUpdatePayload({
      endedAt,
      state: 'completed',
      activeDurationSeconds,
      idleDurationSeconds,
    });

    await enqueueOutboxOperation({
      id: crypto.randomUUID(),
      scope: user.id,
      entityType: 'time_entry',
      entityId: activeEntry.id,
      action: 'update',
      payload: updatePayload,
      createdAt: endedAt,
      updatedAt: endedAt,
      status: 'pending',
      retryCount: 0,
      sequenceNumber: 3,
    });

    void processOutbox(user.id);
    return true;
  }, [activeEntry, activePauses, activeIdles, recentEntries, user]);

  const deleteEntry = useCallback(
    async (entryId: string): Promise<boolean> => {
      setError(null);

      // Demo mode
      if (!user) {
        setRecentEntries((prev) => prev.filter((e) => e.id !== entryId));
        try {
          const raw = localStorage.getItem(DEMO_RECENT_KEY);
          if (raw) {
            const list = JSON.parse(raw) as TimeEntry[];
            localStorage.setItem(DEMO_RECENT_KEY, JSON.stringify(list.filter((e) => e.id !== entryId)));
          }
        } catch {}
        return true;
      }

      // Authenticated mode: optimistic update + outbox
      setRecentEntries((prev) => {
        const next = prev.filter((e) => e.id !== entryId);
        void setOfflineCacheItem(user.id, 'recent_time_entries', next);
        return next;
      });

      await enqueueOutboxOperation({
        id: crypto.randomUUID(),
        scope: user.id,
        entityType: 'time_entry',
        entityId: entryId,
        action: 'delete',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        status: 'pending',
        retryCount: 0,
      });

      void processOutbox(user.id);
      return true;
    },
    [user]
  );

  const refresh = useCallback(async () => {
    if (user?.id) {
      await fetchTimerData(user.id);
    }
  }, [user, fetchTimerData]);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  return {
    activeEntry,
    activePauses,
    activeIdles,
    recentEntries,
    timerStatus,
    elapsedSeconds,
    loading,
    error,
    startTimer,
    pauseTimer,
    resumeTimer,
    stopTimer,
    deleteEntry,
    refresh,
    clearError,
    isStale,
  };
}
