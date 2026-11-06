import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import type { Task, TaskStatusCategory } from '../types';
import { initialTasks } from '../data/mockData';
import { useAuth } from '../context/useAuth';
import { supabase } from '../lib/supabase';
import { taskRowToTask, taskToInsertPayload } from '../lib/adapters';
import { ensureUserWorkspaceContainers } from '../services/workspaceService';
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
  editTask: (taskId: string, updates: Partial<Omit<Task, 'id'>>) => Promise<void>;
  moveTask: (
    taskId: string,
    targetColumnId: string,
    newStatus: TaskStatusCategory,
    newPosition?: number
  ) => Promise<void>;
  toggleTask: (taskId: string) => Promise<void>;
  deleteTask: (taskId: string) => Promise<void>;
  retry: () => void;
  resetDemoData: () => void;
}

function loadDemoTasks(): Task[] {
  try {
    const raw = localStorage.getItem('kuro_demo_tasks');
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch {}
  return initialTasks.map((t) => ({ ...t, syncStatus: 'local-only' }));
}

export function useTasks(): UseTasksReturn {
  const { user } = useAuth();
  const [demoTasks, setDemoTasks] = useState<Task[]>(loadDemoTasks);
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
        const payload = updateOp.payload as Record<string, unknown>;
        return {
          ...t,
          title: payload.title !== undefined ? (payload.title as string) : t.title,
          category: payload.category !== undefined ? (payload.category as Task['category']) : t.category,
          priority: payload.priority !== undefined ? (payload.priority as Task['priority']) : t.priority,
          dueDate: payload.due_date !== undefined ? (payload.due_date as string | null) : t.dueDate,
          dueTime: payload.due_time !== undefined ? (payload.due_time as string | null) : t.dueTime,
          estimatedMinutes:
            payload.estimated_minutes !== undefined
              ? (payload.estimated_minutes as number)
              : t.estimatedMinutes,
          completed: payload.completed !== undefined ? Boolean(payload.completed) : t.completed,
          tags: payload.tags !== undefined ? (payload.tags as string[]) : t.tags,
          description:
            payload.description !== undefined ? (payload.description as string | undefined) : t.description,
          projectId: payload.project_id !== undefined ? (payload.project_id as string | null) : t.projectId,
          boardId: payload.board_id !== undefined ? (payload.board_id as string | null) : t.boardId,
          columnId: payload.column_id !== undefined ? (payload.column_id as string | null) : t.columnId,
          status: payload.status !== undefined ? (payload.status as TaskStatusCategory) : t.status,
          position: payload.position !== undefined ? (payload.position as number) : t.position,
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
          project_id?: string | null;
          board_id?: string | null;
          column_id?: string | null;
          status?: TaskStatusCategory;
          position?: number;
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
          projectId: payload.project_id ?? null,
          boardId: payload.board_id ?? null,
          columnId: payload.column_id ?? null,
          status: payload.status ?? (payload.completed ? 'done' : 'todo'),
          position: payload.position ?? 0,
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
        setDemoTasks((prev) => {
          const next = [newTask, ...prev];
          try {
            localStorage.setItem('kuro_demo_tasks', JSON.stringify(next));
          } catch {}
          return next;
        });
        return;
      }

      // Authenticated local-first persistence with outbox queue
      let resolvedProjectId = newTaskData.projectId ?? null;
      let resolvedBoardId = newTaskData.boardId ?? null;
      let resolvedColumnId = newTaskData.columnId ?? null;

      if (!resolvedProjectId || !resolvedBoardId || !resolvedColumnId) {
        try {
          const containers = await ensureUserWorkspaceContainers(user.id);
          resolvedProjectId = resolvedProjectId || containers.project.id;
          resolvedBoardId = resolvedBoardId || containers.board.id;
          resolvedColumnId =
            resolvedColumnId ||
            (newTaskData.completed ? containers.columns.done.id : containers.columns.todo.id);
        } catch (err) {
          console.warn('[Kuro useTasks] Container resolution warning:', err);
        }
      }

      const taskId = crypto.randomUUID();
      const nowIso = new Date().toISOString();
      const enrichedTaskData = {
        ...newTaskData,
        projectId: resolvedProjectId,
        boardId: resolvedBoardId,
        columnId: resolvedColumnId,
        status: newTaskData.status || (newTaskData.completed ? 'done' : 'todo'),
        createdAt: newTaskData.createdAt || nowIso,
        completedAt: newTaskData.completed ? (newTaskData.completedAt || nowIso) : null,
      };

      const newTask: Task = {
        ...enrichedTaskData,
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
      const insertPayload = taskToInsertPayload({ ...enrichedTaskData, id: taskId }, user.id);
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

  const editTask = useCallback(
    async (taskId: string, updates: Partial<Omit<Task, 'id'>>) => {
      setError(null);

      // Local / unauthenticated demo mode
      if (!user) {
        setDemoTasks((prev) => {
          const next = prev.map((t) => (t.id === taskId ? { ...t, ...updates } : t));
          try {
            localStorage.setItem('kuro_demo_tasks', JSON.stringify(next));
          } catch {}
          return next;
        });
        return;
      }

      const currentTask = dbTasks.find((t) => t.id === taskId);
      let resolvedProjectId = updates.projectId ?? currentTask?.projectId ?? null;
      let resolvedBoardId = updates.boardId ?? currentTask?.boardId ?? null;

      const touchesHierarchy =
        updates.columnId !== undefined ||
        updates.boardId !== undefined ||
        updates.projectId !== undefined;

      if (touchesHierarchy && (!resolvedProjectId || !resolvedBoardId)) {
        try {
          const containers = await ensureUserWorkspaceContainers(user.id);
          resolvedProjectId = resolvedProjectId || containers.project.id;
          resolvedBoardId = resolvedBoardId || containers.board.id;
        } catch (err) {
          console.warn('[Kuro useTasks] Container resolution warning on editTask:', err);
        }
      }

      // Authenticated mode: optimistic update
      setDbTasks((prev) => {
        const next = prev.map((t) =>
          t.id === taskId
            ? {
                ...t,
                ...updates,
                projectId: resolvedProjectId || t.projectId,
                boardId: resolvedBoardId || t.boardId,
                syncStatus: 'pending-sync' as const,
              }
            : t
        );
        void setOfflineCacheItem(user.id, 'tasks', next);
        return next;
      });

      // Prepare payload for database update
      const dbPayload: Record<string, unknown> = {};
      if (updates.title !== undefined) dbPayload.title = updates.title;
      if (updates.category !== undefined) dbPayload.category = updates.category;
      if (updates.priority !== undefined) dbPayload.priority = updates.priority;
      if (updates.dueDate !== undefined) dbPayload.due_date = updates.dueDate;
      if (updates.dueTime !== undefined) dbPayload.due_time = updates.dueTime;
      if (updates.estimatedMinutes !== undefined) dbPayload.estimated_minutes = updates.estimatedMinutes;
      if (updates.completed !== undefined) {
        dbPayload.completed = updates.completed;
        const compAt = updates.completed ? (updates.completedAt || new Date().toISOString()) : null;
        dbPayload.completed_at = compAt;
        updates.completedAt = compAt;
      } else if (updates.completedAt !== undefined) {
        dbPayload.completed_at = updates.completedAt;
      }
      if (updates.tags !== undefined) dbPayload.tags = updates.tags;
      if (updates.description !== undefined) dbPayload.description = updates.description;
      if (updates.projectId !== undefined || (touchesHierarchy && resolvedProjectId)) {
        dbPayload.project_id = updates.projectId ?? resolvedProjectId;
      }
      if (updates.boardId !== undefined || (touchesHierarchy && resolvedBoardId)) {
        dbPayload.board_id = updates.boardId ?? resolvedBoardId;
      }
      if (updates.columnId !== undefined) dbPayload.column_id = updates.columnId;
      if (updates.status !== undefined) {
        dbPayload.status = updates.status;
        if (updates.completed === undefined) {
          dbPayload.completed = updates.status === 'done';
        }
      }
      if (updates.position !== undefined) dbPayload.position = updates.position;

      await enqueueOutboxOperation({
        id: crypto.randomUUID(),
        scope: user.id,
        entityType: 'task',
        entityId: taskId,
        action: 'update',
        payload: dbPayload,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        status: 'pending',
        retryCount: 0,
      });

      void processOutbox(user.id);
    },
    [user, dbTasks]
  );

  const moveTask = useCallback(
    async (
      taskId: string,
      targetColumnId: string,
      newStatus: TaskStatusCategory,
      newPosition?: number
    ) => {
      setError(null);
      const isDone = newStatus === 'done';
      const nowIso = new Date().toISOString();
      const compAt = isDone ? nowIso : null;

      // Demo mode
      if (!user) {
        setDemoTasks((prev) => {
          const next = prev.map((t) =>
            t.id === taskId
              ? {
                  ...t,
                  columnId: targetColumnId,
                  status: newStatus,
                  completed: isDone,
                  completedAt: compAt,
                  ...(newPosition !== undefined ? { position: newPosition } : {}),
                }
              : t
          );
          try {
            localStorage.setItem('kuro_demo_tasks', JSON.stringify(next));
          } catch {}
          return next;
        });
        return;
      }

      const currentTask = dbTasks.find((t) => t.id === taskId);
      let resolvedProjectId = currentTask?.projectId ?? null;
      let resolvedBoardId = currentTask?.boardId ?? null;

      if (!resolvedProjectId || !resolvedBoardId) {
        try {
          const containers = await ensureUserWorkspaceContainers(user.id);
          resolvedProjectId = resolvedProjectId || containers.project.id;
          resolvedBoardId = resolvedBoardId || containers.board.id;
        } catch (err) {
          console.warn('[Kuro useTasks] Container resolution warning on moveTask:', err);
        }
      }

      // Authenticated mode: optimistic update
      setDbTasks((prev) => {
        const next = prev.map((t) =>
          t.id === taskId
            ? {
                ...t,
                columnId: targetColumnId,
                status: newStatus,
                completed: isDone,
                completedAt: compAt,
                projectId: resolvedProjectId || t.projectId,
                boardId: resolvedBoardId || t.boardId,
                ...(newPosition !== undefined ? { position: newPosition } : {}),
                syncStatus: 'pending-sync' as const,
              }
            : t
        );
        void setOfflineCacheItem(user.id, 'tasks', next);
        return next;
      });

      const dbPayload: Record<string, unknown> = {
        column_id: targetColumnId,
        status: newStatus,
        completed: isDone,
        completed_at: compAt,
      };
      if (resolvedProjectId) {
        dbPayload.project_id = resolvedProjectId;
      }
      if (resolvedBoardId) {
        dbPayload.board_id = resolvedBoardId;
      }
      if (newPosition !== undefined) {
        dbPayload.position = newPosition;
      }

      await enqueueOutboxOperation({
        id: crypto.randomUUID(),
        scope: user.id,
        entityType: 'task',
        entityId: taskId,
        action: 'update',
        payload: dbPayload,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        status: 'pending',
        retryCount: 0,
      });

      void processOutbox(user.id);
    },
    [user, dbTasks]
  );

  const toggleTask = useCallback(
    async (taskId: string) => {
      setError(null);

      // Local / unauthenticated demo mode
      if (!user) {
        setDemoTasks((prev) => {
          const next = prev.map((t) => {
            if (t.id !== taskId) return t;
            const nextCompleted = !t.completed;
            const nextStatus: TaskStatusCategory = nextCompleted ? 'done' : 'todo';
            return {
              ...t,
              completed: nextCompleted,
              status: nextStatus,
              columnId: nextCompleted ? 'demo-col-done' : 'demo-col-todo',
            };
          });
          try {
            localStorage.setItem('kuro_demo_tasks', JSON.stringify(next));
          } catch {}
          return next;
        });
        return;
      }

      const currentTask = dbTasks.find((t) => t.id === taskId);
      if (!currentTask) return;
      const nextCompleted = !currentTask.completed;
      const nextStatus: TaskStatusCategory = nextCompleted ? 'done' : 'todo';
      const nowIso = new Date().toISOString();
      const compAt = nextCompleted ? nowIso : null;

      let resolvedColumnId = currentTask.columnId;
      let resolvedProjectId = currentTask.projectId ?? null;
      let resolvedBoardId = currentTask.boardId ?? null;
      try {
        const containers = await ensureUserWorkspaceContainers(user.id);
        if (!resolvedProjectId) resolvedProjectId = containers.project.id;
        if (!resolvedBoardId) resolvedBoardId = containers.board.id;
        if (nextCompleted) {
          resolvedColumnId = containers.columns.done.id;
        } else if (currentTask.status === 'done') {
          resolvedColumnId = containers.columns.todo.id;
        }
      } catch {}

      // 1. Optimistic update in state with pending-sync status
      setDbTasks((prev) => {
        const next = prev.map((t) =>
          t.id === taskId
            ? {
                ...t,
                completed: nextCompleted,
                completedAt: compAt,
                status: nextStatus,
                columnId: resolvedColumnId,
                projectId: resolvedProjectId || t.projectId,
                boardId: resolvedBoardId || t.boardId,
                syncStatus: 'pending-sync' as const,
              }
            : t
        );
        void setOfflineCacheItem(user.id, 'tasks', next);
        return next;
      });

      // 2. Enqueue outbox update operation with completed + status + column_id + project_id + board_id
      const dbPayload: Record<string, unknown> = {
        completed: nextCompleted,
        completed_at: compAt,
        status: nextStatus,
      };
      if (resolvedColumnId) {
        dbPayload.column_id = resolvedColumnId;
      }
      if (resolvedProjectId) {
        dbPayload.project_id = resolvedProjectId;
      }
      if (resolvedBoardId) {
        dbPayload.board_id = resolvedBoardId;
      }

      await enqueueOutboxOperation({
        id: crypto.randomUUID(),
        scope: user.id,
        entityType: 'task',
        entityId: taskId,
        action: 'update',
        payload: dbPayload,
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
        setDemoTasks((prev) => {
          const next = prev.filter((t) => t.id !== taskId);
          try {
            localStorage.setItem('kuro_demo_tasks', JSON.stringify(next));
          } catch {}
          return next;
        });
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
      try {
        localStorage.removeItem('kuro_demo_tasks');
      } catch {}
      setDemoTasks(initialTasks.map((t) => ({ ...t, syncStatus: 'local-only' })));
      setError(null);
    }
  }, [user]);

  return {
    tasks: activeTasks,
    loading: activeLoading,
    error,
    addTask,
    editTask,
    moveTask,
    toggleTask,
    deleteTask,
    retry,
    resetDemoData,
  };
}
