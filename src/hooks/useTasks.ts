import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import type { Task } from '../types';
import { initialTasks } from '../data/mockData';
import { useAuth } from '../context/useAuth';
import { supabase } from '../lib/supabase';
import { taskRowToTask, taskToInsertPayload } from '../lib/adapters';

export interface UseTasksReturn {
  tasks: Task[];
  loading: boolean;
  error: string | null;
  addTask: (newTaskData: Omit<Task, 'id'>) => Promise<void>;
  toggleTask: (taskId: string) => Promise<void>;
  deleteTask: (taskId: string) => Promise<void>;
  retry: () => void;
  resetDemoData: () => void;
}

export function useTasks(): UseTasksReturn {
  const { user } = useAuth();
  const [demoTasks, setDemoTasks] = useState<Task[]>(initialTasks);
  const [dbTasks, setDbTasks] = useState<Task[]>([]);
  const [dbUserId, setDbUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(Boolean(user));
  const [error, setError] = useState<string | null>(null);

  const sequenceRef = useRef<number>(0);

  // Derive active tasks: if authenticated, strictly use dbTasks (or [] if user changed/loading). NEVER demoTasks.
  const activeTasks = useMemo(() => {
    return user ? (dbUserId === user.id ? dbTasks : []) : demoTasks;
  }, [user, dbUserId, dbTasks, demoTasks]);
  const activeLoading = user ? (dbUserId === user.id ? loading : true) : false;

  // Fetch tasks for authenticated user
  const fetchTasks = useCallback(async (userId: string) => {
    if (!supabase) return;
    const currentSeq = ++sequenceRef.current;
    setLoading(true);
    setError(null);

    try {
      const { data, error: fetchErr } = await supabase
        .from('tasks')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false });

      if (currentSeq !== sequenceRef.current) return;

      if (fetchErr) {
        setError('Failed to load tasks from server.');
        setDbTasks([]);
      } else {
        setDbTasks((data || []).map(taskRowToTask));
      }
      setDbUserId(userId);
    } catch {
      if (currentSeq !== sequenceRef.current) return;
      setError('An unexpected network error occurred while loading tasks.');
      setDbTasks([]);
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
          setDbTasks([]);
          setDbUserId(null);
          setLoading(false);
          setError(null);
        }
      });
    } else {
      queueMicrotask(() => {
        if (isCurrent) {
          void fetchTasks(currentUserId);
        }
      });
    }

    return () => {
      isCurrent = false;
    };
  }, [user?.id, fetchTasks]);

  const addTask = useCallback(
    async (newTaskData: Omit<Task, 'id'>) => {
      setError(null);

      // Local / unauthenticated demo mode
      if (!user || !supabase) {
        const newTask: Task = {
          ...newTaskData,
          id: `task-${Date.now()}`,
        };
        setDemoTasks((prev) => [newTask, ...prev]);
        return;
      }

      // Authenticated Supabase persistence
      try {
        const payload = taskToInsertPayload(newTaskData, user.id);
        const { data, error: insertErr } = await supabase
          .from('tasks')
          .insert(payload)
          .select('*')
          .single();

        if (insertErr || !data) {
          setError(insertErr?.message || 'Failed to create task on server.');
          return;
        }

        const createdTask = taskRowToTask(data);
        setDbTasks((prev) => [createdTask, ...prev]);
      } catch {
        setError('Network error while saving task.');
      }
    },
    [user]
  );

  const toggleTask = useCallback(
    async (taskId: string) => {
      setError(null);

      // Local / unauthenticated demo mode
      if (!user || !supabase) {
        setDemoTasks((prev) =>
          prev.map((t) => (t.id === taskId ? { ...t, completed: !t.completed } : t))
        );
        return;
      }

      // Find current task state for rollback if server request fails
      const currentTask = dbTasks.find((t) => t.id === taskId);
      if (!currentTask) return;
      const nextCompleted = !currentTask.completed;

      // Safe optimistic update
      setDbTasks((prev) =>
        prev.map((t) => (t.id === taskId ? { ...t, completed: nextCompleted } : t))
      );

      try {
        const { error: updateErr } = await supabase
          .from('tasks')
          .update({ completed: nextCompleted })
          .eq('id', taskId)
          .eq('user_id', user.id);

        if (updateErr) {
          // Rollback on failure
          setDbTasks((prev) =>
            prev.map((t) => (t.id === taskId ? { ...t, completed: !nextCompleted } : t))
          );
          setError('Failed to update task status on server.');
        }
      } catch {
        // Rollback on network exception
        setDbTasks((prev) =>
          prev.map((t) => (t.id === taskId ? { ...t, completed: !nextCompleted } : t))
        );
        setError('Network error while updating task.');
      }
    },
    [user, dbTasks]
  );

  const deleteTask = useCallback(
    async (taskId: string) => {
      setError(null);

      // Local / unauthenticated demo mode
      if (!user || !supabase) {
        setDemoTasks((prev) => prev.filter((t) => t.id !== taskId));
        return;
      }

      // Optimistic delete with targeted rollback
      const target = dbTasks.find((t) => t.id === taskId);
      if (!target) return;
      setDbTasks((prev) => prev.filter((t) => t.id !== taskId));

      try {
        const { error: deleteErr } = await supabase
          .from('tasks')
          .delete()
          .eq('id', taskId)
          .eq('user_id', user.id);

        if (deleteErr) {
          setDbTasks((prev) => (prev.some((t) => t.id === taskId) ? prev : [target, ...prev]));
          setError('Failed to delete task from server.');
        }
      } catch {
        setDbTasks((prev) => (prev.some((t) => t.id === taskId) ? prev : [target, ...prev]));
        setError('Network error while deleting task.');
      }
    },
    [user, dbTasks]
  );

  const retry = useCallback(() => {
    if (user?.id) {
      void fetchTasks(user.id);
    }
  }, [user, fetchTasks]);

  const resetDemoData = useCallback(() => {
    if (!user) {
      setDemoTasks(initialTasks);
      setError(null);
    }
  }, [user]);

  return {
    tasks: activeTasks,
    loading: activeLoading,
    error,
    addTask,
    toggleTask,
    deleteTask,
    retry,
    resetDemoData,
  };
}
