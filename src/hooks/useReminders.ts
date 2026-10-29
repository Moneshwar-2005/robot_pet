import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import type { Reminder } from '../types';
import { initialReminders } from '../data/mockData';
import { useAuth } from '../context/useAuth';
import { supabase } from '../lib/supabase';
import { reminderRowToReminder, reminderToInsertPayload } from '../lib/adapters';
import {
  setOfflineCacheItem,
  getOfflineCacheItem,
  enqueueOutboxOperation,
  getOutboxOperationsForScope,
} from '../lib/offlineDb';
import { processOutbox, subscribeEntitySync } from '../lib/syncEngine';
import { unmarkReminderNotified } from '../lib/notifications';

export interface UseRemindersReturn {
  reminders: Reminder[];
  loading: boolean;
  error: string | null;
  addReminder: (newReminderData: Omit<Reminder, 'id'>) => Promise<void>;
  toggleReminder: (reminderId: string) => Promise<void>;
  snoozeReminder: (reminderId: string, minutes?: number) => Promise<void>;
  deleteReminder: (reminderId: string) => Promise<void>;
  retry: () => void;
  resetDemoData: () => void;
}

function loadDemoReminders(): Reminder[] {
  try {
    const raw = localStorage.getItem('kuro_demo_reminders');
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch {}
  return initialReminders.map((r) => ({ ...r, syncStatus: 'local-only' }));
}

export function useReminders(): UseRemindersReturn {
  const { user } = useAuth();
  const [demoReminders, setDemoReminders] = useState<Reminder[]>(loadDemoReminders);
  const [dbReminders, setDbReminders] = useState<Reminder[]>([]);
  const [dbUserId, setDbUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(Boolean(user));
  const [error, setError] = useState<string | null>(null);

  const sequenceRef = useRef<number>(0);

  // Derive active reminders: if authenticated, strictly use dbReminders (or [] if user changed/loading). NEVER demoReminders.
  const activeReminders = useMemo(() => {
    return user ? (dbUserId === user.id ? dbReminders : []) : demoReminders;
  }, [user, dbUserId, dbReminders, demoReminders]);
  const activeLoading = user ? (dbUserId === user.id ? loading : true) : false;

  // Reconcile server reminders with pending local outbox operations
  const reconcileReminders = useCallback(
    async (userId: string, serverReminders: Reminder[]): Promise<Reminder[]> => {
      const ops = await getOutboxOperationsForScope(userId);
      const reminderOps = ops.filter((o) => o.entityType === 'reminder');

      // 1. Filter out tombstones (pending deletes)
      const pendingDeletedIds = new Set(
        reminderOps.filter((o) => o.action === 'delete').map((o) => o.entityId)
      );
      let reconciled = serverReminders.filter((r) => !pendingDeletedIds.has(r.id));

      // 2. Mark pending updates
      const pendingUpdates = new Map(
        reminderOps.filter((o) => o.action === 'update').map((o) => [o.entityId, o])
      );
      reconciled = reconciled.map((r) => {
        const updateOp = pendingUpdates.get(r.id);
        if (updateOp && updateOp.payload) {
          const payload = updateOp.payload as Partial<Reminder>;
          return {
            ...r,
            ...payload,
            syncStatus: updateOp.status === 'failed' ? 'sync-error' : 'pending-sync',
          };
        }
        return { ...r, syncStatus: 'synced' };
      });

      // 3. Append pending creates that do not yet exist on the server
      const serverIds = new Set(reconciled.map((r) => r.id));
      const pendingCreates = reminderOps.filter(
        (o) => o.action === 'create' && !serverIds.has(o.entityId)
      );

      for (const op of pendingCreates) {
        if (op.payload) {
          const payload = op.payload as {
            id: string;
            title: string;
            remind_at: string;
            reminder_type?: Reminder['type'];
            priority?: Reminder['priority'];
            done?: boolean;
          };
          reconciled.push({
            id: payload.id || op.entityId,
            title: payload.title,
            time: payload.remind_at,
            type: payload.reminder_type || 'wellness',
            priority: payload.priority || 'normal',
            done: payload.done || false,
            syncStatus: op.status === 'failed' ? 'sync-error' : 'pending-sync',
          });
        }
      }

      return reconciled;
    },
    []
  );

  // Fetch reminders for authenticated user
  const fetchReminders = useCallback(
    async (userId: string) => {
      const currentSeq = ++sequenceRef.current;
      setError(null);

      // Load durable local cache from IndexedDB first for instant access
      try {
        const cached = await getOfflineCacheItem<Reminder[]>(userId, 'reminders');
        if (cached && currentSeq === sequenceRef.current) {
          setDbReminders(cached);
          setDbUserId(userId);
          setLoading(false);
        }
      } catch {
        // Fallback gracefully
      }

      if (!supabase) return;

      try {
        const { data, error: fetchErr } = await supabase
          .from('reminders')
          .select('*')
          .eq('user_id', userId)
          .order('remind_at', { ascending: true });

        if (currentSeq !== sequenceRef.current) return;

        if (fetchErr) {
          setError('Offline or server unreachable. Showing locally saved reminders.');
        } else {
          const serverReminders = (data || []).map(reminderRowToReminder);
          const reconciled = await reconcileReminders(userId, serverReminders);
          if (currentSeq === sequenceRef.current) {
            setDbReminders(reconciled);
            setDbUserId(userId);
            void setOfflineCacheItem(userId, 'reminders', reconciled);
            setError(null);
          }
        }
      } catch {
        if (currentSeq !== sequenceRef.current) return;
        setError('Network offline. Showing locally saved reminders.');
      } finally {
        if (currentSeq === sequenceRef.current) {
          setLoading(false);
        }
      }
    },
    [reconcileReminders]
  );

  // Handle user authentication transitions
  useEffect(() => {
    let isCurrent = true;
    const currentUserId = user?.id ?? null;

    if (!currentUserId) {
      queueMicrotask(() => {
        if (isCurrent) {
          setDbReminders([]);
          setDbUserId(null);
          setLoading(false);
          setError(null);
        }
      });
    } else {
      queueMicrotask(() => {
        if (isCurrent) {
          void fetchReminders(currentUserId);
        }
      });
    }

    return () => {
      isCurrent = false;
    };
  }, [user?.id, fetchReminders]);

  // Subscribe to live entity sync events to dynamically update syncStatus in UI
  useEffect(() => {
    const unsubscribe = subscribeEntitySync((entityType, entityId, status) => {
      if (entityType === 'reminder' && user?.id) {
        setDbReminders((prev) => {
          const updated = prev.map((r) => (r.id === entityId ? { ...r, syncStatus: status } : r));
          void setOfflineCacheItem(user.id, 'reminders', updated);
          return updated;
        });
      }
    });
    return unsubscribe;
  }, [user?.id]);

  const addReminder = useCallback(
    async (newReminderData: Omit<Reminder, 'id'>) => {
      setError(null);

      // Local / unauthenticated demo mode
      if (!user) {
        const newReminder: Reminder = {
          ...newReminderData,
          id: `rem-${Date.now()}`,
          syncStatus: 'local-only',
        };
        setDemoReminders((prev) => {
          const next = [newReminder, ...prev];
          try {
            localStorage.setItem('kuro_demo_reminders', JSON.stringify(next));
          } catch {}
          return next;
        });
        return;
      }

      // Authenticated local-first persistence with outbox queue
      const reminderId = crypto.randomUUID();
      const newReminder: Reminder = {
        ...newReminderData,
        id: reminderId,
        syncStatus: 'pending-sync',
      };

      // 1. Optimistically add to state and local IndexedDB cache
      setDbReminders((prev) => {
        const next = [...prev, newReminder];
        void setOfflineCacheItem(user.id, 'reminders', next);
        return next;
      });

      // 2. Enqueue idempotent outbox create operation
      try {
        const insertPayload = reminderToInsertPayload(
          { ...newReminderData, id: reminderId },
          user.id
        );
        await enqueueOutboxOperation({
          id: crypto.randomUUID(),
          scope: user.id,
          entityType: 'reminder',
          entityId: reminderId,
          action: 'create',
          payload: insertPayload,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          status: 'pending',
          retryCount: 0,
        });

        // 3. Trigger synchronization engine in background
        void processOutbox(user.id);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Invalid reminder format';
        setError(message);
      }
    },
    [user]
  );

  const snoozeReminder = useCallback(
    async (reminderId: string, minutes = 5) => {
      setError(null);
      const snoozeMs = minutes * 60 * 1000;
      const targetTime = new Date(Date.now() + snoozeMs).toISOString();

      // Unmark from notified set so it can alert again when due
      unmarkReminderNotified(reminderId);

      // Local / unauthenticated demo mode
      if (!user) {
        setDemoReminders((prev) => {
          const next = prev.map((r) =>
            r.id === reminderId ? { ...r, time: targetTime, done: false } : r
          );
          try {
            localStorage.setItem('kuro_demo_reminders', JSON.stringify(next));
          } catch {}
          return next;
        });
        return;
      }

      // Authenticated mode: optimistic update
      setDbReminders((prev) => {
        const next = prev.map((r) =>
          r.id === reminderId
            ? { ...r, time: targetTime, done: false, syncStatus: 'pending-sync' as const }
            : r
        );
        void setOfflineCacheItem(user.id, 'reminders', next);
        return next;
      });

      // Enqueue outbox update operation
      await enqueueOutboxOperation({
        id: crypto.randomUUID(),
        scope: user.id,
        entityType: 'reminder',
        entityId: reminderId,
        action: 'update',
        payload: { remind_at: targetTime, done: false },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        status: 'pending',
        retryCount: 0,
      });

      void processOutbox(user.id);
    },
    [user]
  );

  const toggleReminder = useCallback(
    async (reminderId: string) => {
      setError(null);

      // Local / unauthenticated demo mode
      if (!user) {
        setDemoReminders((prev) => {
          const next = prev.map((r) => (r.id === reminderId ? { ...r, done: !r.done } : r));
          try {
            localStorage.setItem('kuro_demo_reminders', JSON.stringify(next));
          } catch {}
          return next;
        });
        return;
      }

      const currentReminder = dbReminders.find((r) => r.id === reminderId);
      if (!currentReminder) return;
      const nextDone = !currentReminder.done;

      // 1. Optimistic update in state with pending-sync status
      setDbReminders((prev) => {
        const next = prev.map((r) =>
          r.id === reminderId
            ? { ...r, done: nextDone, syncStatus: 'pending-sync' as const }
            : r
        );
        void setOfflineCacheItem(user.id, 'reminders', next);
        return next;
      });

      // 2. Enqueue outbox update operation
      await enqueueOutboxOperation({
        id: crypto.randomUUID(),
        scope: user.id,
        entityType: 'reminder',
        entityId: reminderId,
        action: 'update',
        payload: { done: nextDone },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        status: 'pending',
        retryCount: 0,
      });

      // 3. Trigger synchronization engine
      void processOutbox(user.id);
    },
    [user, dbReminders]
  );

  const deleteReminder = useCallback(
    async (reminderId: string) => {
      setError(null);

      // Local / unauthenticated demo mode
      if (!user) {
        setDemoReminders((prev) => {
          const next = prev.filter((r) => r.id !== reminderId);
          try {
            localStorage.setItem('kuro_demo_reminders', JSON.stringify(next));
          } catch {}
          return next;
        });
        return;
      }

      // 1. Immediate optimistic deletion from state & local cache
      setDbReminders((prev) => {
        const next = prev.filter((r) => r.id !== reminderId);
        void setOfflineCacheItem(user.id, 'reminders', next);
        return next;
      });

      // 2. Enqueue outbox delete operation
      await enqueueOutboxOperation({
        id: crypto.randomUUID(),
        scope: user.id,
        entityType: 'reminder',
        entityId: reminderId,
        action: 'delete',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        status: 'pending',
        retryCount: 0,
      });

      // 3. Trigger synchronization engine
      void processOutbox(user.id);
    },
    [user]
  );

  const retry = useCallback(() => {
    if (user?.id) {
      void fetchReminders(user.id);
      void processOutbox(user.id);
    }
  }, [user, fetchReminders]);

  const resetDemoData = useCallback(() => {
    if (!user) {
      try {
        localStorage.removeItem('kuro_demo_reminders');
      } catch {}
      setDemoReminders(initialReminders.map((r) => ({ ...r, syncStatus: 'local-only' })));
      setError(null);
    }
  }, [user]);

  return {
    reminders: activeReminders,
    loading: activeLoading,
    error,
    addReminder,
    toggleReminder,
    snoozeReminder,
    deleteReminder,
    retry,
    resetDemoData,
  };
}
