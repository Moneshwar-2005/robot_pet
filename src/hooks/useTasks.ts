import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import type { Task } from '../types';
import { initialTasks } from '../data/mockData';
import { useAuth } from '../context/useAuth';
import { supabase } from '../lib/supabase';
import { taskRowToTask, taskToInsertPayload } from '../lib/adapters';
import {
  setOfflineCacheItem,
  getOfflineCacheItem,
  enqueueOutboxOperation,
  getOutboxOperationsForScope,
} from '../lib/offlineDb';
import { processOutbox, subscribeEntitySync } from '../lib/syncEngine';

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
  const [demoTasks, setDemoTasks] = useState<Task[]>(() =>
    initialTasks.map((t) => ({ ...t, syncStatus: 'local-only' }))
  );
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

  // Reconcile server task rows with pending local outbox operations
  const reconcileTasks = useCallback(async (userId: string, serverTasks: Task[]): Promise<Task[]> => {
    const ops = await getOutboxOperationsForScope(userId);
    const taskOps = ops.filter((o) => o.entityType === 'task');

    // 1. Filter out tombstones (pending deletes)
    const pendingDeletedIds = new Set(taskOps.filter((o) => o.action === 'delete').map((o) => o.entityId));
    let reconciled = serverTasks.filter((t) => !pendingDeletedIds.has(t.id));

    // 2. Mark pending updates
    const pendingUpdates = new Map(
      taskOps.filter((o) => o.action === 'update').map((o) => [o.entityId, o])
    );
    reconciled = reconciled.map((t) => {
      const updateOp = pendingUpdates.get(t.id);
      if (updateOp && updateOp.payload) {
        const payload = updateOp.payload as Partial<Task>;
        return {
          ...t,
          ...payload,
          syncStatus: updateOp.status === 'failed' ? 'sync-error' : 'pending-sync',
        };
      }
      return { ...t, syncStatus: 'synced' };
    });

    // 3. Append pending creates that do not yet exist on the server
    const serverIds = new Set(reconciled.map((t) => t.id));
    const pendingCreates = taskOps.filter((o) => o.action === 'create' && !serverIds.has(o.entityId));

    for (const op of pendingCreates) {
      if (op.payload) {
        const payload = op.payload as {
          id: string;
          title: string;
          category: Task['category'];
          priority: Task['priority'];
          due_date?: string | null;
          due_time?: string | null;
          estimated_minutes: number;
          completed: boolean;
          tags?: string[];
          description?: string | null;
        };
        reconciled.unshift({
          id: payload.id || op.entityId,
          title: payload.title,
          category: payload.category,
          priority: payload.priority,
          dueDate: payload.due_date ?? null,
          dueTime: payload.due_time ?? null,
          estimatedMinutes: payload.estimated_minutes,
          completed: payload.completed ?? false,
          tags: payload.tags ?? [],
          description: payload.description ?? undefined,
          syncStatus: op.status === 'failed' ? 'sync-error' : 'pending-sync',
        });
      }
    }

    return reconciled;
  }, []);

  // Fetch tasks for authenticated user
  const fetchTasks = useCallback(
    async (userId: string) => {
      const currentSeq = ++sequenceRef.current;
      setError(null);

      // Load durable local cache from IndexedDB first for instant access
      try {
        const cached = await getOfflineCacheItem<Task[]>(userId, 'tasks');
        if (cached && currentSeq === sequenceRef.current) {
          setDbTasks(cached);
          setDbUserId(userId);
          setLoading(false);
        }
      } catch {
        // Fallback gracefully
      }

      if (!supabase) return;

      try {
        const { data, error: fetchErr } = await supabase
          .from('tasks')
          .select('*')
          .eq('user_id', userId)
          .order('created_at', { ascending: false });

        if (currentSeq !== sequenceRef.current) return;

        if (fetchErr) {
          setError('Offline or server unreachable. Showing locally saved tasks.');
        } else {
          const serverTasks = (data || []).map(taskRowToTask);
          const reconciled = await reconcileTasks(userId, serverTasks);
          if (currentSeq === sequenceRef.current) {
            setDbTasks(reconciled);
            setDbUserId(userId);
            void setOfflineCacheItem(userId, 'tasks', reconciled);
            setError(null);
          }
        }
      } catch {
        if (currentSeq !== sequenceRef.current) return;
        setError('Network offline. Showing locally saved tasks.');
      } finally {
        if (currentSeq === sequenceRef.current) {
          setLoading(false);
        }
      }
    },
    [reconcileTasks]
  );

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

  // Subscribe to live entity sync events to dynamically update syncStatus in UI
  useEffect(() => {
    const unsubscribe = subscribeEntitySync((entityType, entityId, status) => {
      if (entityType === 'task' && user?.id) {
        setDbTasks((prev) => {
          const updated = prev.map((t) => (t.id === entityId ? { ...t, syncStatus: status } : t));
          void setOfflineCacheItem(user.id, 'tasks', updated);
          return updated;
        });
      }
    });
    return unsubscribe;
  }, [user?.id]);

  const addTask = useCallback(
    async (newTaskData: Omit<Task, 'id'>) => {
      setError(null);

      // Local / unauthenticated demo mode
      if (!user) {
        const newTask: Task = {
          ...newTaskData,
          id: `task-${Date.now()}`,
          syncStatus: 'local-only',
        };
        setDemoTasks((prev) => [newTask, ...prev]);
        return;
      }

      // Authenticated local-first persistence with outbox queue
      const taskId = crypto.randomUUID();
      const newTask: Task = {
        ...newTaskData,
        id: taskId,
        syncStatus: 'pending-sync',
      };

      // 1. Optimistically add to state and local IndexedDB cache
      setDbTasks((prev) => {
        const next = [newTask, ...prev];
        void setOfflineCacheItem(user.id, 'tasks', next);
        return next;
      });

      // 2. Enqueue idempotent outbox create operation
      const insertPayload = taskToInsertPayload({ ...newTaskData, id: taskId }, user.id);
      await enqueueOutboxOperation({
        id: crypto.randomUUID(),
        scope: user.id,
        entityType: 'task',
        entityId: taskId,
        action: 'create',
        payload: insertPayload,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        status: 'pending',
        retryCount: 0,
      });

      // 3. Trigger synchronization engine in background
      void processOutbox(user.id);
    },
    [user]
  );

  const toggleTask = useCallback(
    async (taskId: string) => {
      setError(null);

      // Local / unauthenticated demo mode
      if (!user) {
        setDemoTasks((prev) =>
          prev.map((t) => (t.id === taskId ? { ...t, completed: !t.completed } : t))
        );
        return;
      }

      const currentTask = dbTasks.find((t) => t.id === taskId);
      if (!currentTask) return;
      const nextCompleted = !currentTask.completed;

      // 1. Optimistic update in state with pending-sync status
      setDbTasks((prev) => {
        const next = prev.map((t) =>
          t.id === taskId ? { ...t, completed: nextCompleted, syncStatus: 'pending-sync' as const } : t
        );
        void setOfflineCacheItem(user.id, 'tasks', next);
        return next;
      });

      // 2. Enqueue outbox update operation
      await enqueueOutboxOperation({
        id: crypto.randomUUID(),
        scope: user.id,
        entityType: 'task',
        entityId: taskId,
        action: 'update',
        payload: { completed: nextCompleted },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        status: 'pending',
        retryCount: 0,
      });

      // 3. Trigger synchronization engine
      void processOutbox(user.id);
    },
    [user, dbTasks]
  );

  const deleteTask = useCallback(
    async (taskId: string) => {
      setError(null);

      // Local / unauthenticated demo mode
      if (!user) {
        setDemoTasks((prev) => prev.filter((t) => t.id !== taskId));
        return;
      }

      // 1. Immediate optimistic deletion from state & local cache
      setDbTasks((prev) => {
        const next = prev.filter((t) => t.id !== taskId);
        void setOfflineCacheItem(user.id, 'tasks', next);
        return next;
      });

      // 2. Enqueue outbox delete operation
      await enqueueOutboxOperation({
        id: crypto.randomUUID(),
        scope: user.id,
        entityType: 'task',
        entityId: taskId,
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
      void fetchTasks(user.id);
      void processOutbox(user.id);
    }
  }, [user, fetchTasks]);

  const resetDemoData = useCallback(() => {
    if (!user) {
      setDemoTasks(initialTasks.map((t) => ({ ...t, syncStatus: 'local-only' })));
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
