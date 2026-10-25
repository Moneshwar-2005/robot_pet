import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import type { Reminder } from '../types';
import { initialReminders } from '../data/mockData';
import { useAuth } from '../context/useAuth';
import { supabase } from '../lib/supabase';
import { reminderRowToReminder, reminderToInsertPayload } from '../lib/adapters';

export interface UseRemindersReturn {
  reminders: Reminder[];
  loading: boolean;
  error: string | null;
  addReminder: (newReminderData: Omit<Reminder, 'id'>) => Promise<void>;
  toggleReminder: (reminderId: string) => Promise<void>;
  deleteReminder: (reminderId: string) => Promise<void>;
  retry: () => void;
  resetDemoData: () => void;
}

export function useReminders(): UseRemindersReturn {
  const { user } = useAuth();
  const [demoReminders, setDemoReminders] = useState<Reminder[]>(initialReminders);
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

  // Fetch reminders for authenticated user
  const fetchReminders = useCallback(async (userId: string) => {
    if (!supabase) return;
    const currentSeq = ++sequenceRef.current;
    setLoading(true);
    setError(null);

    try {
      const { data, error: fetchErr } = await supabase
        .from('reminders')
        .select('*')
        .eq('user_id', userId)
        .order('remind_at', { ascending: true });

      if (currentSeq !== sequenceRef.current) return;

      if (fetchErr) {
        setError('Failed to load reminders from server.');
        setDbReminders([]);
      } else {
        setDbReminders((data || []).map(reminderRowToReminder));
      }
      setDbUserId(userId);
    } catch {
      if (currentSeq !== sequenceRef.current) return;
      setError('An unexpected network error occurred while loading reminders.');
      setDbReminders([]);
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

  const addReminder = useCallback(
    async (newReminderData: Omit<Reminder, 'id'>) => {
      setError(null);

      // Local / unauthenticated demo mode
      if (!user || !supabase) {
        const newReminder: Reminder = {
          ...newReminderData,
          id: `rem-${Date.now()}`,
        };
        setDemoReminders((prev) => [newReminder, ...prev]);
        return;
      }

      // Authenticated Supabase persistence
      try {
        const payload = reminderToInsertPayload(newReminderData, user.id);
        const { data, error: insertErr } = await supabase
          .from('reminders')
          .insert(payload)
          .select('*')
          .single();

        if (insertErr || !data) {
          setError(insertErr?.message || 'Failed to create reminder on server.');
          return;
        }

        const createdReminder = reminderRowToReminder(data);
        setDbReminders((prev) => [...prev, createdReminder]);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Network error while saving reminder.';
        setError(message);
      }
    },
    [user]
  );

  const toggleReminder = useCallback(
    async (reminderId: string) => {
      setError(null);

      // Local / unauthenticated demo mode
      if (!user || !supabase) {
        setDemoReminders((prev) =>
          prev.map((r) => (r.id === reminderId ? { ...r, done: !r.done } : r))
        );
        return;
      }

      const currentReminder = dbReminders.find((r) => r.id === reminderId);
      if (!currentReminder) return;
      const nextDone = !currentReminder.done;

      // Safe optimistic update
      setDbReminders((prev) =>
        prev.map((r) => (r.id === reminderId ? { ...r, done: nextDone } : r))
      );

      try {
        const { error: updateErr } = await supabase
          .from('reminders')
          .update({ done: nextDone })
          .eq('id', reminderId)
          .eq('user_id', user.id);

        if (updateErr) {
          // Rollback on failure
          setDbReminders((prev) =>
            prev.map((r) => (r.id === reminderId ? { ...r, done: !nextDone } : r))
          );
          setError('Failed to update reminder status on server.');
        }
      } catch {
        // Rollback on network exception
        setDbReminders((prev) =>
          prev.map((r) => (r.id === reminderId ? { ...r, done: !nextDone } : r))
        );
        setError('Network error while updating reminder.');
      }
    },
    [user, dbReminders]
  );

  const deleteReminder = useCallback(
    async (reminderId: string) => {
      setError(null);

      // Local / unauthenticated demo mode
      if (!user || !supabase) {
        setDemoReminders((prev) => prev.filter((r) => r.id !== reminderId));
        return;
      }

      // Optimistic delete with targeted rollback
      const target = dbReminders.find((r) => r.id === reminderId);
      if (!target) return;
      setDbReminders((prev) => prev.filter((r) => r.id !== reminderId));

      try {
        const { error: deleteErr } = await supabase
          .from('reminders')
          .delete()
          .eq('id', reminderId)
          .eq('user_id', user.id);

        if (deleteErr) {
          setDbReminders((prev) => (prev.some((r) => r.id === reminderId) ? prev : [target, ...prev]));
          setError('Failed to delete reminder from server.');
        }
      } catch {
        setDbReminders((prev) => (prev.some((r) => r.id === reminderId) ? prev : [target, ...prev]));
        setError('Network error while deleting reminder.');
      }
    },
    [user, dbReminders]
  );

  const retry = useCallback(() => {
    if (user?.id) {
      void fetchReminders(user.id);
    }
  }, [user, fetchReminders]);

  const resetDemoData = useCallback(() => {
    if (!user) {
      setDemoReminders(initialReminders);
      setError(null);
    }
  }, [user]);

  return {
    reminders: activeReminders,
    loading: activeLoading,
    error,
    addReminder,
    toggleReminder,
    deleteReminder,
    retry,
    resetDemoData,
  };
}
