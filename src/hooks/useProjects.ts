/**
 * Kuro Companion — Projects & Kanban Containers Hook
 *
 * Scope: Phase 10 Milestone 3 (Projects & Kanban Tasks Integration)
 *
 * Responsibilities:
 * 1. Manages projects, project boards, and workflow columns for authenticated users and demo mode.
 * 2. Idempotently initializes default workspace containers ("General" project, "Main Board", 5 columns).
 * 3. Provides offline-first persistence with IndexedDB caching and outbox synchronization.
 * 4. Ensures all created projects automatically receive a default board and 5 canonical columns
 *    to strictly satisfy the Phase 9 database constraint `trg_validate_task_board_hierarchy`.
 * 5. Supports project creation, updating, archiving, and active container selection.
 */

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import type { Project, ProjectBoard, BoardColumn } from '../types';
import { useAuth } from '../context/useAuth';
import { supabase } from '../lib/supabase';
import {
  getOfflineCacheItem,
  setOfflineCacheItem,
  enqueueOutboxOperation,
  getOutboxOperationsForScope,
} from '../lib/offlineDb';
import { processOutbox } from '../lib/syncEngine';
import {
  projectRowToProject,
  projectBoardRowToProjectBoard,
  boardColumnRowToBoardColumn,
  projectToInsertPayload,
  projectToUpdatePayload,
  projectBoardToInsertPayload,
  boardColumnToInsertPayload,
} from '../lib/adapters';
import {
  ensureUserWorkspaceContainers,
  DEFAULT_COLUMNS,
} from '../services/workspaceService';

export interface CreateProjectInput {
  name: string;
  description?: string;
  color?: string;
  icon?: string;
}

export interface UseProjectsReturn {
  projects: Project[];
  activeProject: Project | null;
  boards: ProjectBoard[];
  activeBoard: ProjectBoard | null;
  columns: BoardColumn[];
  loading: boolean;
  error: string | null;
  selectedProjectId: string | null;
  selectedBoardId: string | null;
  selectProject: (projectId: string) => void;
  selectBoard: (boardId: string) => void;
  createProject: (input: CreateProjectInput) => Promise<Project | null>;
  updateProject: (
    projectId: string,
    updates: Partial<Pick<Project, 'name' | 'description' | 'color' | 'icon'>>
  ) => Promise<boolean>;
  archiveProject: (projectId: string, isArchived: boolean) => Promise<boolean>;
  refresh: () => Promise<void>;
}

const DEMO_PROJECT_ID = 'demo-project-general';
const DEMO_BOARD_ID = 'demo-board-main';

function getDemoInitialContainers(): {
  projects: Project[];
  boards: ProjectBoard[];
  columns: BoardColumn[];
} {
  const now = new Date().toISOString();
  const defaultProject: Project = {
    id: DEMO_PROJECT_ID,
    userId: 'demo',
    name: 'General',
    description: 'Default demo workspace project',
    color: 'cyan',
    icon: 'folder',
    isArchived: false,
    createdAt: now,
    updatedAt: now,
  };

  const defaultBoard: ProjectBoard = {
    id: DEMO_BOARD_ID,
    userId: 'demo',
    projectId: DEMO_PROJECT_ID,
    name: 'Main Board',
    description: 'Primary workflow board',
    boardType: 'kanban',
    position: 0,
    createdAt: now,
    updatedAt: now,
  };

  const defaultColumns: BoardColumn[] = DEFAULT_COLUMNS.map((col, idx) => ({
    id: `demo-col-${col.category}`,
    userId: 'demo',
    boardId: DEMO_BOARD_ID,
    name: col.name,
    statusCategory: col.category,
    position: col.position ?? idx,
    wipLimit: 0,
    createdAt: now,
    updatedAt: now,
  }));

  try {
    const rawProj = localStorage.getItem('kuro_demo_projects');
    const rawBoards = localStorage.getItem('kuro_demo_boards');
    const rawCols = localStorage.getItem('kuro_demo_columns');

    return {
      projects: rawProj ? JSON.parse(rawProj) : [defaultProject],
      boards: rawBoards ? JSON.parse(rawBoards) : [defaultBoard],
      columns: rawCols ? JSON.parse(rawCols) : defaultColumns,
    };
  } catch {
    return {
      projects: [defaultProject],
      boards: [defaultBoard],
      columns: defaultColumns,
    };
  }
}

export function useProjects(): UseProjectsReturn {
  const { user } = useAuth();

  // Demo state
  const [demoContainers, setDemoContainers] = useState(getDemoInitialContainers);

  // Authenticated state
  const [dbProjects, setDbProjects] = useState<Project[]>([]);
  const [dbBoards, setDbBoards] = useState<ProjectBoard[]>([]);
  const [dbColumns, setDbColumns] = useState<BoardColumn[]>([]);
  const [dbUserId, setDbUserId] = useState<string | null>(null);

  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [selectedBoardId, setSelectedBoardId] = useState<string | null>(null);

  const [loading, setLoading] = useState<boolean>(Boolean(user));
  const [error, setError] = useState<string | null>(null);

  const sequenceRef = useRef<number>(0);

  // Active containers depending on auth status with strict user-switch isolation
  const projects = useMemo(() => {
    return user ? (dbUserId === user.id ? dbProjects : []) : demoContainers.projects;
  }, [user, dbUserId, dbProjects, demoContainers.projects]);

  const boards = useMemo(() => {
    return user ? (dbUserId === user.id ? dbBoards : []) : demoContainers.boards;
  }, [user, dbUserId, dbBoards, demoContainers.boards]);

  const allColumns = useMemo(() => {
    return user ? (dbUserId === user.id ? dbColumns : []) : demoContainers.columns;
  }, [user, dbUserId, dbColumns, demoContainers.columns]);

  // Derive active project - always strictly selects non-archived projects
  const activeProject = useMemo(() => {
    if (!projects || projects.length === 0) return null;
    const activeProjects = projects.filter((p) => !p.isArchived);
    if (selectedProjectId) {
      const match = activeProjects.find((p) => p.id === selectedProjectId);
      if (match) return match;
    }
    // Default to General project if present and active, or first active project
    const general = activeProjects.find((p) => p.name.toLowerCase() === 'general');
    return general || activeProjects[0] || null;
  }, [projects, selectedProjectId]);

  // Derive boards for active project
  const projectBoards = useMemo(() => {
    if (!activeProject) return [];
    return boards
      .filter((b) => b.projectId === activeProject.id)
      .sort((a, b) => a.position - b.position);
  }, [boards, activeProject]);

  // Derive active board
  const activeBoard = useMemo(() => {
    if (projectBoards.length === 0) return null;
    if (selectedBoardId) {
      const match = projectBoards.find((b) => b.id === selectedBoardId);
      if (match) return match;
    }
    return projectBoards[0];
  }, [projectBoards, selectedBoardId]);

  // Derive columns for active board
  const columns = useMemo(() => {
    if (!activeBoard) return [];
    return allColumns
      .filter((c) => c.boardId === activeBoard.id)
      .sort((a, b) => a.position - b.position);
  }, [allColumns, activeBoard]);

  // Reconcile server rows with outbox operations
  const reconcileProjects = useCallback(
    async (userId: string, serverProjects: Project[]): Promise<Project[]> => {
      const ops = await getOutboxOperationsForScope(userId);
      const projOps = ops.filter((o) => o.entityType === 'project');

      const deletedIds = new Set(
        projOps.filter((o) => o.action === 'delete').map((o) => o.entityId)
      );
      let reconciled = serverProjects.filter((p) => !deletedIds.has(p.id));

      const updateOps = new Map(
        projOps.filter((o) => o.action === 'update').map((o) => [o.entityId, o])
      );

      reconciled = reconciled.map((p) => {
        const update = updateOps.get(p.id);
        if (update && update.payload) {
          const payload = update.payload as Record<string, unknown>;
          return {
            ...p,
            name: payload.name !== undefined ? (payload.name as string) : p.name,
            description:
              payload.description !== undefined ? (payload.description as string | null) : p.description,
            color: payload.color !== undefined ? (payload.color as string) : p.color,
            icon: payload.icon !== undefined ? (payload.icon as string) : p.icon,
            isArchived:
              payload.is_archived !== undefined ? Boolean(payload.is_archived) : p.isArchived,
          };
        }
        return p;
      });

      const serverIds = new Set(reconciled.map((p) => p.id));
      const pendingCreates = projOps.filter(
        (o) => o.action === 'create' && !serverIds.has(o.entityId)
      );

      for (const op of pendingCreates) {
        if (op.payload) {
          const payload = op.payload as {
            id?: string;
            name: string;
            description?: string | null;
            color?: string;
            icon?: string;
            is_archived?: boolean;
          };
          reconciled.push({
            id: payload.id || op.entityId,
            userId,
            name: payload.name,
            description: payload.description ?? null,
            color: payload.color || 'cyan',
            icon: payload.icon || 'folder',
            isArchived: Boolean(payload.is_archived),
            createdAt: op.createdAt,
            updatedAt: op.createdAt,
          });
        }
      }

      return reconciled;
    },
    []
  );

  // Load containers for authenticated user
  const fetchContainers = useCallback(
    async (userId: string) => {
      const currentSeq = ++sequenceRef.current;
      setError(null);

      // 1. Instant local IndexedDB cache load
      try {
        const [cachedProj, cachedBoards, cachedCols] = await Promise.all([
          getOfflineCacheItem<Project[]>(userId, 'projects'),
          getOfflineCacheItem<ProjectBoard[]>(userId, 'project_boards'),
          getOfflineCacheItem<BoardColumn[]>(userId, 'board_columns'),
        ]);

        if (currentSeq === sequenceRef.current) {
          if (cachedProj && cachedProj.length > 0) setDbProjects(cachedProj);
          if (cachedBoards && cachedBoards.length > 0) setDbBoards(cachedBoards);
          if (cachedCols && cachedCols.length > 0) setDbColumns(cachedCols);
          if (cachedProj && cachedProj.length > 0) {
            setDbUserId(userId);
            setLoading(false);
          }
        }
      } catch {
        // Fallback gracefully
      }

      if (!supabase) return;

      try {
        // 2. Ensure bootstrap containers exist
        await ensureUserWorkspaceContainers(userId);

        // 3. Query all user projects, boards, and columns
        const [projRes, boardRes, colRes] = await Promise.all([
          supabase
            .from('projects')
            .select('*')
            .eq('user_id', userId)
            .order('created_at', { ascending: true }),
          supabase
            .from('project_boards')
            .select('*')
            .eq('user_id', userId)
            .order('position', { ascending: true }),
          supabase
            .from('board_columns')
            .select('*')
            .eq('user_id', userId)
            .order('position', { ascending: true }),
        ]);

        if (currentSeq !== sequenceRef.current) return;

        if (projRes.error) throw projRes.error;
        if (boardRes.error) throw boardRes.error;
        if (colRes.error) throw colRes.error;

        const serverProjects = (projRes.data || []).map(projectRowToProject);
        const serverBoards = (boardRes.data || []).map(projectBoardRowToProjectBoard);
        const serverCols = (colRes.data || []).map(boardColumnRowToBoardColumn);

        const reconciledProjects = await reconcileProjects(userId, serverProjects);

        if (currentSeq === sequenceRef.current) {
          setDbProjects(reconciledProjects);
          setDbBoards(serverBoards);
          setDbColumns(serverCols);
          setDbUserId(userId);

          void setOfflineCacheItem(userId, 'projects', reconciledProjects);
          void setOfflineCacheItem(userId, 'project_boards', serverBoards);
          void setOfflineCacheItem(userId, 'board_columns', serverCols);

          setLoading(false);
        }
      } catch (err: unknown) {
        if (currentSeq === sequenceRef.current) {
          const msg =
            err instanceof Error ? err.message : 'Failed to synchronize workspace containers';
          setError(msg);
          setLoading(false);
        }
      }
    },
    [reconcileProjects]
  );

  // Trigger on user changes
  useEffect(() => {
    let isCurrent = true;
    const currentUserId = user?.id ?? null;

    if (!currentUserId) {
      queueMicrotask(() => {
        if (isCurrent) {
          setDbUserId(null);
          setDbProjects([]);
          setDbBoards([]);
          setDbColumns([]);
          setDemoContainers(getDemoInitialContainers());
          setSelectedProjectId(DEMO_PROJECT_ID);
          setSelectedBoardId(DEMO_BOARD_ID);
          setLoading(false);
          setError(null);
        }
      });
    } else {
      queueMicrotask(() => {
        if (isCurrent) {
          setDbUserId((prev) => (prev === currentUserId ? prev : null));
          setSelectedProjectId(null);
          setSelectedBoardId(null);
          void fetchContainers(currentUserId);
        }
      });
    }

    return () => {
      isCurrent = false;
    };
  }, [user, fetchContainers]);

  const selectProject = useCallback((projectId: string) => {
    setSelectedProjectId(projectId);
    setSelectedBoardId(null); // Reset active board to auto-select the first board of this project
  }, []);

  const selectBoard = useCallback((boardId: string) => {
    setSelectedBoardId(boardId);
  }, []);

  const createProject = useCallback(
    async (input: CreateProjectInput): Promise<Project | null> => {
      const trimmedName = input.name.trim();
      if (!trimmedName) return null;

      const now = new Date().toISOString();
      const projectId = crypto.randomUUID();
      const boardId = crypto.randomUUID();

      // Demo mode
      if (!user) {
        const newProject: Project = {
          id: projectId,
          userId: 'demo',
          name: trimmedName,
          description: input.description?.trim() || null,
          color: input.color || 'cyan',
          icon: input.icon || 'folder',
          isArchived: false,
          createdAt: now,
          updatedAt: now,
        };

        const newBoard: ProjectBoard = {
          id: boardId,
          userId: 'demo',
          projectId,
          name: 'Main Board',
          description: 'Primary workflow board',
          boardType: 'kanban',
          position: 0,
          createdAt: now,
          updatedAt: now,
        };

        const newColumns: BoardColumn[] = DEFAULT_COLUMNS.map((col, idx) => ({
          id: `demo-col-${projectId}-${col.category}`,
          userId: 'demo',
          boardId,
          name: col.name,
          statusCategory: col.category,
          position: col.position ?? idx,
          wipLimit: 0,
          createdAt: now,
          updatedAt: now,
        }));

        setDemoContainers((prev) => {
          const next = {
            projects: [...prev.projects, newProject],
            boards: [...prev.boards, newBoard],
            columns: [...prev.columns, ...newColumns],
          };
          try {
            localStorage.setItem('kuro_demo_projects', JSON.stringify(next.projects));
            localStorage.setItem('kuro_demo_boards', JSON.stringify(next.boards));
            localStorage.setItem('kuro_demo_columns', JSON.stringify(next.columns));
          } catch {}
          return next;
        });

        setSelectedProjectId(projectId);
        setSelectedBoardId(boardId);
        return newProject;
      }

      // Authenticated mode: generate IDs, columns, and queue via Outbox
      const newProject: Project = {
        id: projectId,
        userId: user.id,
        name: trimmedName,
        description: input.description?.trim() || null,
        color: input.color || 'cyan',
        icon: input.icon || 'folder',
        isArchived: false,
        createdAt: now,
        updatedAt: now,
      };

      const newBoard: ProjectBoard = {
        id: boardId,
        userId: user.id,
        projectId,
        name: 'Main Board',
        description: 'Primary workflow board',
        boardType: 'kanban',
        position: 0,
        createdAt: now,
        updatedAt: now,
      };

      const newColumns: BoardColumn[] = DEFAULT_COLUMNS.map((col, idx) => ({
        id: crypto.randomUUID(),
        userId: user.id,
        boardId,
        name: col.name,
        statusCategory: col.category,
        position: col.position ?? idx,
        wipLimit: 0,
        createdAt: now,
        updatedAt: now,
      }));

      // 1. Optimistic state update
      setDbProjects((prev) => {
        const next = [...prev, newProject];
        void setOfflineCacheItem(user.id, 'projects', next);
        return next;
      });
      setDbBoards((prev) => {
        const next = [...prev, newBoard];
        void setOfflineCacheItem(user.id, 'project_boards', next);
        return next;
      });
      setDbColumns((prev) => {
        const next = [...prev, ...newColumns];
        void setOfflineCacheItem(user.id, 'board_columns', next);
        return next;
      });

      setSelectedProjectId(projectId);
      setSelectedBoardId(boardId);

      // 2. Enqueue Outbox operations FIFO with explicit sequence: Project -> Board -> 5 Columns
      const baseTime = Date.now();
      const projTime = new Date(baseTime).toISOString();
      const boardTime = new Date(baseTime + 10).toISOString();

      const projPayload = projectToInsertPayload(newProject, user.id);
      await enqueueOutboxOperation({
        id: crypto.randomUUID(),
        scope: user.id,
        entityType: 'project',
        entityId: projectId,
        action: 'create',
        payload: projPayload,
        createdAt: projTime,
        updatedAt: projTime,
        status: 'pending',
        retryCount: 0,
        sequenceNumber: 1,
      });

      const boardPayload = projectBoardToInsertPayload(newBoard, user.id);
      await enqueueOutboxOperation({
        id: crypto.randomUUID(),
        scope: user.id,
        entityType: 'project_board',
        entityId: boardId,
        action: 'create',
        payload: boardPayload,
        createdAt: boardTime,
        updatedAt: boardTime,
        status: 'pending',
        retryCount: 0,
        sequenceNumber: 2,
      });

      for (let i = 0; i < newColumns.length; i++) {
        const col = newColumns[i];
        const colTime = new Date(baseTime + 20 + i * 5).toISOString();
        const colPayload = boardColumnToInsertPayload(col, user.id);
        await enqueueOutboxOperation({
          id: crypto.randomUUID(),
          scope: user.id,
          entityType: 'board_column',
          entityId: col.id,
          action: 'create',
          payload: colPayload,
          createdAt: colTime,
          updatedAt: colTime,
          status: 'pending',
          retryCount: 0,
          sequenceNumber: 3 + i,
        });
      }

      // 3. Trigger outbox processing
      void processOutbox(user.id);
      return newProject;
    },
    [user]
  );

  const updateProject = useCallback(
    async (
      projectId: string,
      updates: Partial<Pick<Project, 'name' | 'description' | 'color' | 'icon'>>
    ): Promise<boolean> => {
      // Demo mode
      if (!user) {
        setDemoContainers((prev) => {
          const nextProjects = prev.projects.map((p) =>
            p.id === projectId ? { ...p, ...updates, updatedAt: new Date().toISOString() } : p
          );
          try {
            localStorage.setItem('kuro_demo_projects', JSON.stringify(nextProjects));
          } catch {}
          return { ...prev, projects: nextProjects };
        });
        return true;
      }

      // Authenticated mode: optimistic update + outbox
      setDbProjects((prev) => {
        const next = prev.map((p) =>
          p.id === projectId ? { ...p, ...updates, updatedAt: new Date().toISOString() } : p
        );
        void setOfflineCacheItem(user.id, 'projects', next);
        return next;
      });

      const dbPayload = projectToUpdatePayload(updates);
      await enqueueOutboxOperation({
        id: crypto.randomUUID(),
        scope: user.id,
        entityType: 'project',
        entityId: projectId,
        action: 'update',
        payload: dbPayload,
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

  const archiveProject = useCallback(
    async (projectId: string, isArchived: boolean): Promise<boolean> => {
      // Auto-fallback selection if archiving the currently active project
      if (isArchived && (selectedProjectId === projectId || activeProject?.id === projectId)) {
        const pool = user ? dbProjects : demoContainers.projects;
        const remaining = pool.filter((p) => p.id !== projectId && !p.isArchived);
        const fallback = remaining.find((p) => p.name.toLowerCase() === 'general') || remaining[0];
        setSelectedProjectId(fallback ? fallback.id : null);
        setSelectedBoardId(null);
      }

      // Demo mode
      if (!user) {
        setDemoContainers((prev) => {
          const nextProjects = prev.projects.map((p) =>
            p.id === projectId ? { ...p, isArchived, updatedAt: new Date().toISOString() } : p
          );
          try {
            localStorage.setItem('kuro_demo_projects', JSON.stringify(nextProjects));
          } catch {}
          return { ...prev, projects: nextProjects };
        });
        return true;
      }

      // Authenticated mode
      setDbProjects((prev) => {
        const next = prev.map((p) =>
          p.id === projectId ? { ...p, isArchived, updatedAt: new Date().toISOString() } : p
        );
        void setOfflineCacheItem(user.id, 'projects', next);
        return next;
      });

      const dbPayload = projectToUpdatePayload({ isArchived });
      await enqueueOutboxOperation({
        id: crypto.randomUUID(),
        scope: user.id,
        entityType: 'project',
        entityId: projectId,
        action: 'update',
        payload: dbPayload,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        status: 'pending',
        retryCount: 0,
      });

      void processOutbox(user.id);
      return true;
    },
    [user, selectedProjectId, activeProject, dbProjects, demoContainers.projects]
  );

  const refresh = useCallback(async () => {
    if (user?.id) {
      await fetchContainers(user.id);
    }
  }, [user, fetchContainers]);

  return {
    projects,
    activeProject,
    boards,
    activeBoard,
    columns,
    loading,
    error,
    selectedProjectId,
    selectedBoardId,
    selectProject,
    selectBoard,
    createProject,
    updateProject,
    archiveProject,
    refresh,
  };
}
