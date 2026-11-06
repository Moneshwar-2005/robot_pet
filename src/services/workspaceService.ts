/**
 * Kuro Companion — Workspace Container Bootstrap Service
 *
 * Scope: Phase 10 Milestone 1 (Foundation, Types & Container Bootstrap)
 *
 * Responsibilities:
 * 1. Idempotently ensures default workspace containers (Project -> Board -> 5 Columns) exist for each user.
 * 2. Reuses existing valid containers without duplicating or overwriting user customizations.
 * 3. Handles simultaneous bootstrap requests safely via in-flight promise deduplication.
 * 4. Recovers from partial failures and supports durable offline fallback via IndexedDB cache.
 * 5. Guarantees required container IDs are available before creating tasks subject to hierarchy triggers.
 */

import { supabase } from '../lib/supabase';
import { getOfflineCacheItem, setOfflineCacheItem } from '../lib/offlineDb';
import { generateDefaultProjectId, generateDefaultBoardId, isDuplicateKeyError } from '../lib/uuidv5';
import type { ProjectRow, ProjectBoardRow, BoardColumnRow } from '../types/database';

export type CanonicalStatusCategory = 'backlog' | 'todo' | 'in_progress' | 'done' | 'cancelled';
export { isDuplicateKeyError };

export interface WorkspaceColumnInfo {
  id: string;
  name: string;
  statusCategory: CanonicalStatusCategory;
  position: number;
  wipLimit: number;
}

export interface WorkspaceContainers {
  project: {
    id: string;
    userId: string;
    name: string;
    color: string;
    icon: string;
    isArchived: boolean;
  };
  board: {
    id: string;
    userId: string;
    projectId: string;
    name: string;
    boardType: 'kanban' | 'scrum';
    position: number;
  };
  columns: {
    backlog: WorkspaceColumnInfo;
    todo: WorkspaceColumnInfo;
    in_progress: WorkspaceColumnInfo;
    done: WorkspaceColumnInfo;
    cancelled: WorkspaceColumnInfo;
  };
  columnList: WorkspaceColumnInfo[];
}

export const DEFAULT_COLUMNS: ReadonlyArray<{
  category: CanonicalStatusCategory;
  name: string;
  position: number;
}> = [
  { category: 'backlog', name: 'Backlog', position: 0 },
  { category: 'todo', name: 'To Do', position: 1 },
  { category: 'in_progress', name: 'In Progress', position: 2 },
  { category: 'done', name: 'Done', position: 3 },
  { category: 'cancelled', name: 'Cancelled', position: 4 },
];

// In-flight promise map to deduplicate simultaneous bootstrap calls per user
const inFlightBootstrapPromises = new Map<string, Promise<WorkspaceContainers>>();

// In-memory cache for fast, synchronous access within the session
const memoryContainersCache = new Map<string, WorkspaceContainers>();

/**
 * Clears the in-memory containers cache (e.g. on user sign-out or testing).
 */
export function clearWorkspaceContainersCache(userId?: string): void {
  if (userId) {
    memoryContainersCache.delete(userId);
    inFlightBootstrapPromises.delete(userId);
  } else {
    memoryContainersCache.clear();
    inFlightBootstrapPromises.clear();
  }
}

/**
 * Retrieves cached workspace containers synchronously from memory if available,
 * or asynchronously from durable IndexedDB offline storage.
 */
export async function getCachedWorkspaceContainers(
  userId: string
): Promise<WorkspaceContainers | null> {
  const inMemory = memoryContainersCache.get(userId);
  if (inMemory) return inMemory;

  try {
    const cached = await getOfflineCacheItem<WorkspaceContainers>(
      userId,
      'workspace_containers'
    );
    if (cached) {
      memoryContainersCache.set(userId, cached);
      return cached;
    }
  } catch {
    // Graceful offline fallback
  }

  return null;
}

/**
 * Ensures that the authenticated user possesses a default project ("General"),
 * a default board ("Main Board"), and all 5 canonical workflow columns.
 *
 * Guarantees idempotency, thread-safety, and preservation of user customizations.
 */
export async function ensureUserWorkspaceContainers(
  userId: string
): Promise<WorkspaceContainers> {
  if (!userId || typeof userId !== 'string') {
    throw new Error('Valid userId is required to ensure workspace containers.');
  }

  // 1. Return in-flight promise if a bootstrap request for this user is already active
  const existingInFlight = inFlightBootstrapPromises.get(userId);
  if (existingInFlight) {
    return existingInFlight;
  }

  // 2. Wrap execution and register in inFlightBootstrapPromises
  const bootstrapPromise = (async (): Promise<WorkspaceContainers> => {
    // If Supabase client is not configured (e.g. demo mode or unit test environment without credentials),
    // provide durable cached or synthesized demo containers.
    if (!supabase) {
      const cached = await getCachedWorkspaceContainers(userId);
      if (cached) return cached;

      const demoProjectId = generateDefaultProjectId(userId);
      const demoBoardId = generateDefaultBoardId(userId, demoProjectId);

      const demoContainers: WorkspaceContainers = {
        project: {
          id: demoProjectId,
          userId,
          name: 'General',
          color: 'cyan',
          icon: 'folder',
          isArchived: false,
        },
        board: {
          id: demoBoardId,
          userId,
          projectId: demoProjectId,
          name: 'Main Board',
          boardType: 'kanban',
          position: 0,
        },
        columns: {
          backlog: { id: `demo-col-backlog-${userId}`, name: 'Backlog', statusCategory: 'backlog', position: 0, wipLimit: 0 },
          todo: { id: `demo-col-todo-${userId}`, name: 'To Do', statusCategory: 'todo', position: 1, wipLimit: 0 },
          in_progress: { id: `demo-col-in_progress-${userId}`, name: 'In Progress', statusCategory: 'in_progress', position: 2, wipLimit: 0 },
          done: { id: `demo-col-done-${userId}`, name: 'Done', statusCategory: 'done', position: 3, wipLimit: 0 },
          cancelled: { id: `demo-col-cancelled-${userId}`, name: 'Cancelled', statusCategory: 'cancelled', position: 4, wipLimit: 0 },
        },
        columnList: [
          { id: `demo-col-backlog-${userId}`, name: 'Backlog', statusCategory: 'backlog', position: 0, wipLimit: 0 },
          { id: `demo-col-todo-${userId}`, name: 'To Do', statusCategory: 'todo', position: 1, wipLimit: 0 },
          { id: `demo-col-in_progress-${userId}`, name: 'In Progress', statusCategory: 'in_progress', position: 2, wipLimit: 0 },
          { id: `demo-col-done-${userId}`, name: 'Done', statusCategory: 'done', position: 3, wipLimit: 0 },
          { id: `demo-col-cancelled-${userId}`, name: 'Cancelled', statusCategory: 'cancelled', position: 4, wipLimit: 0 },
        ],
      };

      memoryContainersCache.set(userId, demoContainers);
      void setOfflineCacheItem(userId, 'workspace_containers', demoContainers);
      return demoContainers;
    }

    try {
      // ------------------------------------------------------------------------
      // Step 1: Ensure Default Project
      // ------------------------------------------------------------------------
      const { data: existingProjects, error: projErr } = await supabase
        .from('projects')
        .select('*')
        .eq('user_id', userId)
        .eq('is_archived', false)
        .order('created_at', { ascending: true });

      if (projErr) {
        throw new Error(`Failed to query user projects: ${projErr.message}`);
      }

      let activeProject: ProjectRow;

      if (existingProjects && existingProjects.length > 0) {
        // Reuse project named 'General' (case-insensitive) if present, else first active project
        const generalProj = existingProjects.find(
          (p) => p.name.trim().toLowerCase() === 'general'
        );
        activeProject = generalProj || existingProjects[0];
      } else {
        // Derive deterministic project ID using UUID v5 (SHA-1 namespace hashing with userId)
        const deterministicProjectId = generateDefaultProjectId(userId);

        const { data: createdProj, error: createProjErr } = await supabase
          .from('projects')
          .insert({
            id: deterministicProjectId,
            user_id: userId,
            name: 'General',
            description: 'Default workspace project for unassigned tasks',
            color: 'cyan',
            icon: 'folder',
            is_archived: false,
          })
          .select('*')
          .single();

        if (createProjErr) {
          // If concurrent insert occurred, catch only expected duplicate-key violation (SQLSTATE 23505)
          if (isDuplicateKeyError(createProjErr)) {
            const { data: existingProj, error: fetchProjErr } = await supabase
              .from('projects')
              .select('*')
              .eq('id', deterministicProjectId)
              .eq('user_id', userId)
              .maybeSingle();

            if (fetchProjErr) {
              throw new Error(`Failed to fetch project after unique conflict: ${fetchProjErr.message}`);
            }

            if (existingProj && existingProj.user_id === userId) {
              activeProject = existingProj;
            } else {
              throw new Error(
                `Duplicate project collision detected but record could not be verified for user ${userId}`
              );
            }
          } else {
            throw new Error(`Failed to create default project: ${createProjErr.message}`);
          }
        } else {
          activeProject = createdProj;
        }
      }

      // ------------------------------------------------------------------------
      // Step 2: Ensure Default Board for Active Project
      // ------------------------------------------------------------------------
      const { data: existingBoards, error: boardErr } = await supabase
        .from('project_boards')
        .select('*')
        .eq('user_id', userId)
        .eq('project_id', activeProject.id)
        .order('position', { ascending: true })
        .order('created_at', { ascending: true });

      if (boardErr) {
        throw new Error(`Failed to query project boards: ${boardErr.message}`);
      }

      let activeBoard: ProjectBoardRow;

      if (existingBoards && existingBoards.length > 0) {
        // Reuse board named 'Main Board' (case-insensitive) if present, else first board
        const mainBoard = existingBoards.find(
          (b) => b.name.trim().toLowerCase() === 'main board'
        );
        activeBoard = mainBoard || existingBoards[0];
      } else {
        // Derive deterministic board ID using UUID v5 from user UUID and active project ID
        const deterministicBoardId = generateDefaultBoardId(userId, activeProject.id);

        const { data: createdBoard, error: createBoardErr } = await supabase
          .from('project_boards')
          .insert({
            id: deterministicBoardId,
            user_id: userId,
            project_id: activeProject.id,
            name: 'Main Board',
            board_type: 'kanban',
            position: 0,
          })
          .select('*')
          .single();

        if (createBoardErr) {
          // If concurrent insert occurred, catch only expected duplicate-key violation (SQLSTATE 23505)
          if (isDuplicateKeyError(createBoardErr)) {
            const { data: existingBoard, error: fetchBoardErr } = await supabase
              .from('project_boards')
              .select('*')
              .eq('id', deterministicBoardId)
              .eq('user_id', userId)
              .eq('project_id', activeProject.id)
              .maybeSingle();

            if (fetchBoardErr) {
              throw new Error(`Failed to fetch board after unique conflict: ${fetchBoardErr.message}`);
            }

            if (existingBoard && existingBoard.user_id === userId) {
              activeBoard = existingBoard;
            } else {
              throw new Error(
                `Duplicate board collision detected but record could not be verified for user ${userId}`
              );
            }
          } else {
            throw new Error(`Failed to create default board: ${createBoardErr.message}`);
          }
        } else {
          activeBoard = createdBoard;
        }
      }

      // ------------------------------------------------------------------------
      // Step 3: Ensure All 5 Canonical Workflow Columns
      // ------------------------------------------------------------------------
      const { data: existingColumns, error: colErr } = await supabase
        .from('board_columns')
        .select('*')
        .eq('user_id', userId)
        .eq('board_id', activeBoard.id)
        .order('position', { ascending: true });

      if (colErr) {
        throw new Error(`Failed to query board columns: ${colErr.message}`);
      }

      const columnsByCategory = new Map<CanonicalStatusCategory, BoardColumnRow>();
      for (const col of existingColumns || []) {
        columnsByCategory.set(col.status_category as CanonicalStatusCategory, col);
      }

      // Identify missing categories from the 5 canonical columns
      const missingColumns = DEFAULT_COLUMNS.filter(
        (def) => !columnsByCategory.has(def.category)
      );

      if (missingColumns.length > 0) {
        for (const missing of missingColumns) {
          const { data: createdCol, error: createColErr } = await supabase
            .from('board_columns')
            .insert({
              user_id: userId,
              board_id: activeBoard.id,
              name: missing.name,
              status_category: missing.category,
              position: missing.position,
              wip_limit: 0,
            })
            .select('*')
            .single();

          if (createColErr) {
            // Catch ONLY the expected unique-constraint conflict (uq_board_status_category)
            if (isDuplicateKeyError(createColErr)) {
              const { data: retryCol, error: fetchColErr } = await supabase
                .from('board_columns')
                .select('*')
                .eq('user_id', userId)
                .eq('board_id', activeBoard.id)
                .eq('status_category', missing.category)
                .maybeSingle();

              if (fetchColErr) {
                throw new Error(
                  `Failed to resolve column '${missing.name}' (${missing.category}) after unique conflict: ${fetchColErr.message}`
                );
              }

              if (retryCol && retryCol.user_id === userId) {
                columnsByCategory.set(missing.category, retryCol);
              } else {
                throw new Error(
                  `Column '${missing.name}' (${missing.category}) could not be resolved or ownership mismatch after duplicate conflict.`
                );
              }
            } else {
              // Propagate unexpected database errors
              throw new Error(
                `Failed to create column '${missing.name}' (${missing.category}): ${createColErr.message}`
              );
            }
          } else {
            columnsByCategory.set(missing.category, createdCol);
          }
        }
      }

      // Verify all 5 categories are resolved
      const backlogCol = columnsByCategory.get('backlog');
      const todoCol = columnsByCategory.get('todo');
      const inProgressCol = columnsByCategory.get('in_progress');
      const doneCol = columnsByCategory.get('done');
      const cancelledCol = columnsByCategory.get('cancelled');

      if (!backlogCol || !todoCol || !inProgressCol || !doneCol || !cancelledCol) {
        throw new Error('Workspace container bootstrap incomplete: not all 5 columns could be resolved.');
      }

      const columnList: WorkspaceColumnInfo[] = Array.from(columnsByCategory.values())
        .map((c) => ({
          id: c.id,
          name: c.name,
          statusCategory: c.status_category as CanonicalStatusCategory,
          position: c.position,
          wipLimit: c.wip_limit,
        }))
        .sort((a, b) => a.position - b.position);

      const containers: WorkspaceContainers = {
        project: {
          id: activeProject.id,
          userId: activeProject.user_id,
          name: activeProject.name,
          color: activeProject.color,
          icon: activeProject.icon,
          isArchived: activeProject.is_archived,
        },
        board: {
          id: activeBoard.id,
          userId: activeBoard.user_id,
          projectId: activeBoard.project_id,
          name: activeBoard.name,
          boardType: activeBoard.board_type,
          position: activeBoard.position,
        },
        columns: {
          backlog: {
            id: backlogCol.id,
            name: backlogCol.name,
            statusCategory: 'backlog',
            position: backlogCol.position,
            wipLimit: backlogCol.wip_limit,
          },
          todo: {
            id: todoCol.id,
            name: todoCol.name,
            statusCategory: 'todo',
            position: todoCol.position,
            wipLimit: todoCol.wip_limit,
          },
          in_progress: {
            id: inProgressCol.id,
            name: inProgressCol.name,
            statusCategory: 'in_progress',
            position: inProgressCol.position,
            wipLimit: inProgressCol.wip_limit,
          },
          done: {
            id: doneCol.id,
            name: doneCol.name,
            statusCategory: 'done',
            position: doneCol.position,
            wipLimit: doneCol.wip_limit,
          },
          cancelled: {
            id: cancelledCol.id,
            name: cancelledCol.name,
            statusCategory: 'cancelled',
            position: cancelledCol.position,
            wipLimit: cancelledCol.wip_limit,
          },
        },
        columnList,
      };

      // Update in-memory cache and local durable IndexedDB cache
      memoryContainersCache.set(userId, containers);
      void setOfflineCacheItem(userId, 'workspace_containers', containers);

      return containers;
    } catch (networkOrDbError) {
      // Offline fallback: try reading durable IndexedDB cache if remote calls fail
      const cached = await getCachedWorkspaceContainers(userId);
      if (cached) {
        return cached;
      }
      throw networkOrDbError;
    }
  })();

  inFlightBootstrapPromises.set(userId, bootstrapPromise);

  try {
    return await bootstrapPromise;
  } finally {
    inFlightBootstrapPromises.delete(userId);
  }
}
