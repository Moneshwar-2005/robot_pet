/**
 * Kuro Synchronization Engine — Step 3.5 & Phase 10 Extension
 *
 * Coordinates durable offline operations with Supabase.
 * - Idempotent writes via client-generated UUIDs and upsert
 * - Strictly scoped to authenticated user ID
 * - Ordered FIFO processing
 * - Distinguishes network failures from permanent validation errors
 * - Automatically triggers on online events and user actions
 */

import { supabase } from './supabase';
import {
  getOutboxOperationsForScope,
  deleteOutboxOperation,
  updateOutboxOperation,
  getPendingOutboxCount,
  resetFailedOutboxOperationsForScope,
} from './offlineDb';
import type { OutboxOperation, SyncState, OutboxEntityType } from '../types/sync';
import type { TablesInsert, TablesUpdate } from '../types/database';
import { ensureUserWorkspaceContainers } from '../services/workspaceService';

type SyncListener = (state: SyncState) => void;
type EntitySyncListener = (entityType: OutboxEntityType, entityId: string, status: 'synced' | 'sync-error') => void;

let activeUserId: string | null = null;
let isSyncing = false;
let lastSyncedAt: string | null = null;
let lastError: string | null = null;

const syncListeners = new Set<SyncListener>();
const entitySyncListeners = new Set<EntitySyncListener>();

function notifyListeners(pendingCount = 0) {
  const state: SyncState = {
    isSyncing,
    pendingCount,
    lastSyncedAt,
    lastError,
  };
  for (const listener of syncListeners) {
    try {
      listener(state);
    } catch (err) {
      console.warn('[Kuro SyncEngine] Listener error:', err);
    }
  }
}

function notifyEntitySynced(entityType: OutboxEntityType, entityId: string, status: 'synced' | 'sync-error') {
  for (const listener of entitySyncListeners) {
    try {
      listener(entityType, entityId, status);
    } catch (err) {
      console.warn('[Kuro SyncEngine] Entity listener error:', err);
    }
  }
}

export function subscribeSyncState(listener: SyncListener): () => void {
  syncListeners.add(listener);
  if (activeUserId) {
    void getPendingOutboxCount(activeUserId).then((count) => {
      listener({ isSyncing, pendingCount: count, lastSyncedAt, lastError });
    });
  } else {
    listener({ isSyncing: false, pendingCount: 0, lastSyncedAt, lastError });
  }
  return () => {
    syncListeners.delete(listener);
  };
}

export function subscribeEntitySync(listener: EntitySyncListener): () => void {
  entitySyncListeners.add(listener);
  return () => {
    entitySyncListeners.delete(listener);
  };
}

export function setActiveSyncUser(userId: string | null) {
  if (activeUserId !== userId) {
    activeUserId = userId;
    isSyncing = false;
    lastError = null;
    if (userId) {
      void processOutbox(userId);
    } else {
      notifyListeners(0);
    }
  }
}

export function isPermanentError(
  error: { code?: string; message?: string } | null | undefined,
  retryCount = 0
): boolean {
  if (!error) return false;

  const isForeignKeyViolation =
    error.code === '23503' ||
    Boolean(
      error.message &&
        (error.message.includes('foreign key constraint') ||
          error.message.includes('fk_boards_project') ||
          error.message.includes('fk_columns_board') ||
          error.message.includes('fk_pause_time_entry') ||
          error.message.includes('fk_idle_time_entry') ||
          error.message.includes('fk_time_entry_task') ||
          error.message.includes('fk_time_entry_project'))
    );

  // Foreign key violations may be transient if a parent resource is still synchronizing.
  // Allow bounded retries (up to 5 attempts) before treating as genuinely unresolvable.
  if (isForeignKeyViolation) {
    return retryCount >= 5;
  }

  // Cross-device running timer collision is recoverable (can retry as paused)
  if (
    error.code === '23505' &&
    Boolean(
      error.message?.includes('idx_unique_running_timer_per_user') ||
        error.message?.includes('running')
    )
  ) {
    return false;
  }

  // PostgreSQL SQLSTATE 22 (data exception), 23 (integrity constraint violations other than 23503), 42 (syntax/access rule)
  if (error.code && /^(22|23|42)/.test(error.code)) {
    return true;
  }

  if (
    error.message &&
    (error.message.includes('JWT') ||
      error.message.includes('invalid input') ||
      error.message.includes('permission denied') ||
      (error.message.includes('violates') && !error.message.includes('foreign key')))
  ) {
    return true;
  }

  return false;
}

/**
 * Resets any failed outbox operations for this user and triggers synchronization.
 * Provides a clear recovery path when parent resources have been restored.
 */
export async function retryFailedOutboxOperations(userId: string): Promise<number> {
  if (!userId) return 0;
  const count = await resetFailedOutboxOperationsForScope(userId);
  if (count > 0) {
    void processOutbox(userId);
  }
  return count;
}

/**
 * Executes a single outbox operation against Supabase.
 * Returns true if successful or idempotently satisfied; false if recoverable network error.
 */
async function executeOperation(op: OutboxOperation): Promise<{ success: boolean; permanentError?: string; aborted?: boolean }> {
  if (!supabase) {
    return { success: false, permanentError: 'Supabase client not configured' };
  }

  // Double check that active authenticated user still matches the operation owner
  if (activeUserId !== op.scope) {
    return { success: false, aborted: true };
  }

  try {
    if (op.entityType === 'task') {
      if (op.action === 'create') {
        let payload = op.payload as TablesInsert<'tasks'>;
        if (!payload.project_id || !payload.board_id || !payload.column_id) {
          try {
            const containers = await ensureUserWorkspaceContainers(op.scope);
            payload = {
              ...payload,
              project_id: payload.project_id || containers.project.id,
              board_id: payload.board_id || containers.board.id,
              column_id:
                payload.column_id ||
                (payload.completed ? containers.columns.done.id : containers.columns.todo.id),
              status: payload.status || (payload.completed ? 'done' : 'todo'),
            };
          } catch (err) {
            console.warn('[Kuro SyncEngine] Container auto-enrichment warning:', err);
          }
        }
        const { error } = await supabase
          .from('tasks')
          .upsert(payload, { onConflict: 'id' });

        if (error) {
          if (isPermanentError(error, op.retryCount)) {
            return { success: false, permanentError: error.message };
          }
          return { success: false };
        }
        return { success: true };
      } else if (op.action === 'update') {
        const payload = op.payload as TablesUpdate<'tasks'>;
        const { error } = await supabase
          .from('tasks')
          .update(payload)
          .eq('id', op.entityId)
          .eq('user_id', op.scope);

        if (error) {
          if (isPermanentError(error, op.retryCount)) {
            return { success: false, permanentError: error.message };
          }
          return { success: false };
        }
        return { success: true };
      } else if (op.action === 'delete') {
        const { error } = await supabase
          .from('tasks')
          .delete()
          .eq('id', op.entityId)
          .eq('user_id', op.scope);

        if (error) {
          if (isPermanentError(error, op.retryCount)) {
            return { success: false, permanentError: error.message };
          }
          return { success: false };
        }
        return { success: true };
      }
    } else if (op.entityType === 'reminder') {
      if (op.action === 'create') {
        const payload = op.payload as TablesInsert<'reminders'>;
        const { error } = await supabase
          .from('reminders')
          .upsert(payload, { onConflict: 'id' });

        if (error) {
          if (isPermanentError(error, op.retryCount)) {
            return { success: false, permanentError: error.message };
          }
          return { success: false };
        }
        return { success: true };
      } else if (op.action === 'update') {
        const payload = op.payload as TablesUpdate<'reminders'>;
        const { error } = await supabase
          .from('reminders')
          .update(payload)
          .eq('id', op.entityId)
          .eq('user_id', op.scope);

        if (error) {
          if (isPermanentError(error, op.retryCount)) {
            return { success: false, permanentError: error.message };
          }
          return { success: false };
        }
        return { success: true };
      } else if (op.action === 'delete') {
        const { error } = await supabase
          .from('reminders')
          .delete()
          .eq('id', op.entityId)
          .eq('user_id', op.scope);

        if (error) {
          if (isPermanentError(error, op.retryCount)) {
            return { success: false, permanentError: error.message };
          }
          return { success: false };
        }
        return { success: true };
      }
    } else if (op.entityType === 'memory') {
      if (op.action === 'create') {
        const payload = op.payload as TablesInsert<'user_memories'>;
        const { error } = await supabase
          .from('user_memories')
          .upsert(payload, { onConflict: 'id' });

        if (error) {
          if (isPermanentError(error, op.retryCount)) {
            return { success: false, permanentError: error.message };
          }
          return { success: false };
        }
        return { success: true };
      } else if (op.action === 'update') {
        const payload = op.payload as TablesUpdate<'user_memories'>;
        const { error } = await supabase
          .from('user_memories')
          .update(payload)
          .eq('id', op.entityId)
          .eq('user_id', op.scope);

        if (error) {
          if (isPermanentError(error, op.retryCount)) {
            return { success: false, permanentError: error.message };
          }
          return { success: false };
        }
        return { success: true };
      } else if (op.action === 'delete') {
        const { error } = await supabase
          .from('user_memories')
          .delete()
          .eq('id', op.entityId)
          .eq('user_id', op.scope);

        if (error) {
          if (isPermanentError(error, op.retryCount)) {
            return { success: false, permanentError: error.message };
          }
          return { success: false };
        }
        return { success: true };
      }
    } else if (op.entityType === 'session') {
      if (op.action === 'create') {
        const payload = op.payload as TablesInsert<'work_sessions'>;
        const { error } = await supabase
          .from('work_sessions')
          .upsert(payload, { onConflict: 'id' });

        if (error) {
          if (isPermanentError(error, op.retryCount)) {
            return { success: false, permanentError: error.message };
          }
          return { success: false };
        }
        return { success: true };
      } else if (op.action === 'update') {
        const payload = op.payload as TablesUpdate<'work_sessions'>;
        const { error } = await supabase
          .from('work_sessions')
          .update(payload)
          .eq('id', op.entityId)
          .eq('user_id', op.scope);

        if (error) {
          if (isPermanentError(error, op.retryCount)) {
            return { success: false, permanentError: error.message };
          }
          return { success: false };
        }
        return { success: true };
      } else if (op.action === 'delete') {
        const { error } = await supabase
          .from('work_sessions')
          .delete()
          .eq('id', op.entityId)
          .eq('user_id', op.scope);

        if (error) {
          if (isPermanentError(error, op.retryCount)) {
            return { success: false, permanentError: error.message };
          }
          return { success: false };
        }
        return { success: true };
      }
    } else if (op.entityType === 'pet_setting') {
      const payload = op.payload as TablesUpdate<'pet_settings'>;
      const { data: updated, error: updateErr } = await supabase
        .from('pet_settings')
        .update(payload)
        .eq('user_id', op.scope)
        .select('id');

      if (updateErr) {
        if (isPermanentError(updateErr, op.retryCount)) {
          return { success: false, permanentError: updateErr.message };
        }
        return { success: false };
      }

      if (updated && updated.length > 0) {
        return { success: true };
      }

      const upsertPayload = { user_id: op.scope, ...payload } as TablesInsert<'pet_settings'>;
      const { error: upsertErr } = await supabase
        .from('pet_settings')
        .upsert(upsertPayload, { onConflict: 'user_id' });

      if (upsertErr) {
        if (isPermanentError(upsertErr, op.retryCount)) {
          return { success: false, permanentError: upsertErr.message };
        }
        return { success: false };
      }
      return { success: true };
    } else if (op.entityType === 'preference') {
      const payload = op.payload as TablesUpdate<'user_preferences'>;
      const { data: updated, error: updateErr } = await supabase
        .from('user_preferences')
        .update(payload)
        .eq('user_id', op.scope)
        .select('id');

      if (updateErr) {
        if (isPermanentError(updateErr, op.retryCount)) {
          return { success: false, permanentError: updateErr.message };
        }
        return { success: false };
      }

      if (updated && updated.length > 0) {
        return { success: true };
      }

      const upsertPayload = { user_id: op.scope, ...payload } as TablesInsert<'user_preferences'>;
      const { error: upsertErr } = await supabase
        .from('user_preferences')
        .upsert(upsertPayload, { onConflict: 'user_id' });

      if (upsertErr) {
        if (isPermanentError(upsertErr, op.retryCount)) {
          return { success: false, permanentError: upsertErr.message };
        }
        return { success: false };
      }
      return { success: true };
    } else if (op.entityType === 'routine') {
      if (op.action === 'create') {
        const payload = op.payload as TablesInsert<'routines'>;
        const { error } = await supabase
          .from('routines')
          .upsert(payload, { onConflict: 'id' });

        if (error) {
          if (isPermanentError(error, op.retryCount)) {
            return { success: false, permanentError: error.message };
          }
          return { success: false };
        }
        return { success: true };
      } else if (op.action === 'update') {
        const payload = op.payload as TablesUpdate<'routines'>;
        const { error } = await supabase
          .from('routines')
          .update(payload)
          .eq('id', op.entityId)
          .eq('user_id', op.scope);

        if (error) {
          if (isPermanentError(error, op.retryCount)) {
            return { success: false, permanentError: error.message };
          }
          return { success: false };
        }
        return { success: true };
      } else if (op.action === 'delete') {
        const { error } = await supabase
          .from('routines')
          .delete()
          .eq('id', op.entityId)
          .eq('user_id', op.scope);

        if (error) {
          if (isPermanentError(error, op.retryCount)) {
            return { success: false, permanentError: error.message };
          }
          return { success: false };
        }
        return { success: true };
      }
    } else if (op.entityType === 'project') {
      if (op.action === 'create') {
        const payload = op.payload as TablesInsert<'projects'>;
        const { error } = await supabase
          .from('projects')
          .upsert(payload, { onConflict: 'id' });

        if (error) {
          if (isPermanentError(error, op.retryCount)) {
            return { success: false, permanentError: error.message };
          }
          return { success: false };
        }
        return { success: true };
      } else if (op.action === 'update') {
        const payload = op.payload as TablesUpdate<'projects'>;
        const { error } = await supabase
          .from('projects')
          .update(payload)
          .eq('id', op.entityId)
          .eq('user_id', op.scope);

        if (error) {
          if (isPermanentError(error, op.retryCount)) {
            return { success: false, permanentError: error.message };
          }
          return { success: false };
        }
        return { success: true };
      } else if (op.action === 'delete') {
        const { error } = await supabase
          .from('projects')
          .delete()
          .eq('id', op.entityId)
          .eq('user_id', op.scope);

        if (error) {
          if (isPermanentError(error, op.retryCount)) {
            return { success: false, permanentError: error.message };
          }
          return { success: false };
        }
        return { success: true };
      }
    } else if (op.entityType === 'project_board') {
      if (op.action === 'create') {
        const payload = op.payload as TablesInsert<'project_boards'>;
        const { error } = await supabase
          .from('project_boards')
          .upsert(payload, { onConflict: 'id' });

        if (error) {
          if (isPermanentError(error, op.retryCount)) {
            return { success: false, permanentError: error.message };
          }
          return { success: false };
        }
        return { success: true };
      } else if (op.action === 'update') {
        const payload = op.payload as TablesUpdate<'project_boards'>;
        const { error } = await supabase
          .from('project_boards')
          .update(payload)
          .eq('id', op.entityId)
          .eq('user_id', op.scope);

        if (error) {
          if (isPermanentError(error, op.retryCount)) {
            return { success: false, permanentError: error.message };
          }
          return { success: false };
        }
        return { success: true };
      } else if (op.action === 'delete') {
        const { error } = await supabase
          .from('project_boards')
          .delete()
          .eq('id', op.entityId)
          .eq('user_id', op.scope);

        if (error) {
          if (isPermanentError(error, op.retryCount)) {
            return { success: false, permanentError: error.message };
          }
          return { success: false };
        }
        return { success: true };
      }
    } else if (op.entityType === 'board_column') {
      if (op.action === 'create') {
        const payload = op.payload as TablesInsert<'board_columns'>;
        const { error } = await supabase
          .from('board_columns')
          .upsert(payload, { onConflict: 'id' });

        if (error) {
          if (isPermanentError(error, op.retryCount)) {
            return { success: false, permanentError: error.message };
          }
          return { success: false };
        }
        return { success: true };
      } else if (op.action === 'update') {
        const payload = op.payload as TablesUpdate<'board_columns'>;
        const { error } = await supabase
          .from('board_columns')
          .update(payload)
          .eq('id', op.entityId)
          .eq('user_id', op.scope);

        if (error) {
          if (isPermanentError(error, op.retryCount)) {
            return { success: false, permanentError: error.message };
          }
          return { success: false };
        }
        return { success: true };
      } else if (op.action === 'delete') {
        const { error } = await supabase
          .from('board_columns')
          .delete()
          .eq('id', op.entityId)
          .eq('user_id', op.scope);

        if (error) {
          if (isPermanentError(error, op.retryCount)) {
            return { success: false, permanentError: error.message };
          }
          return { success: false };
        }
        return { success: true };
      }
    } else if (op.entityType === 'time_entry') {
      if (op.action === 'create') {
        const payload = op.payload as TablesInsert<'time_entries'>;
        const { error } = await supabase
          .from('time_entries')
          .upsert(payload, { onConflict: 'id' });

        if (error) {
          // Check for cross-device running timer conflict (23505 on idx_unique_running_timer_per_user)
          const isRunningTimerConflict =
            error.code === '23505' &&
            Boolean(
              error.message?.includes('idx_unique_running_timer_per_user') ||
                error.message?.includes('running')
            );

          if (isRunningTimerConflict && payload.state === 'running') {
            // Another device started a running timer while this device was offline.
            // Safely recover by inserting in 'paused' state so work is preserved without losing data.
            const fallbackPayload: TablesInsert<'time_entries'> = {
              ...payload,
              state: 'paused',
            };
            const { error: fallbackErr } = await supabase
              .from('time_entries')
              .upsert(fallbackPayload, { onConflict: 'id' });

            if (!fallbackErr) {
              return { success: true };
            }
          }

          // Check for active interval temporal conflict
          const isTemporalConflict =
            Boolean(error.message?.includes('Active work interval conflicts')) ||
            Boolean(error.message?.includes('active work interval'));

          if (isTemporalConflict) {
            // Quarantine conflicted record to preserve user's work forensically
            const quarantinedPayload: TablesInsert<'time_entries'> = {
              ...payload,
              state: 'quarantined',
              is_recovered: true,
              recovery_reason: 'Resolved cross-device active interval collision during offline sync',
            };
            const { error: qErr } = await supabase
              .from('time_entries')
              .upsert(quarantinedPayload, { onConflict: 'id' });

            if (!qErr) {
              return { success: true };
            }
          }

          if (isPermanentError(error, op.retryCount)) {
            return { success: false, permanentError: error.message };
          }
          return { success: false };
        }
        return { success: true };
      } else if (op.action === 'update') {
        const payload = op.payload as TablesUpdate<'time_entries'>;
        const { error } = await supabase
          .from('time_entries')
          .update(payload)
          .eq('id', op.entityId)
          .eq('user_id', op.scope);

        if (error) {
          // Check for active interval temporal conflict on update
          const isTemporalConflict =
            Boolean(error.message?.includes('Active work interval conflicts')) ||
            Boolean(error.message?.includes('active work interval'));

          if (isTemporalConflict) {
            const quarantinedPayload: TablesUpdate<'time_entries'> = {
              ...payload,
              state: 'quarantined',
              is_recovered: true,
              recovery_reason: 'Resolved cross-device active interval collision during offline sync',
            };
            const { error: qErr } = await supabase
              .from('time_entries')
              .update(quarantinedPayload)
              .eq('id', op.entityId)
              .eq('user_id', op.scope);

            if (!qErr) {
              return { success: true };
            }
          }

          if (isPermanentError(error, op.retryCount)) {
            return { success: false, permanentError: error.message };
          }
          return { success: false };
        }
        return { success: true };
      } else if (op.action === 'delete') {
        const { error } = await supabase
          .from('time_entries')
          .delete()
          .eq('id', op.entityId)
          .eq('user_id', op.scope);

        if (error) {
          if (isPermanentError(error, op.retryCount)) {
            return { success: false, permanentError: error.message };
          }
          return { success: false };
        }
        return { success: true };
      }
    } else if (op.entityType === 'time_entry_pause') {
      if (op.action === 'create') {
        const payload = op.payload as TablesInsert<'time_entry_pauses'>;
        const { error } = await supabase
          .from('time_entry_pauses')
          .upsert(payload, { onConflict: 'id' });

        if (error) {
          if (isPermanentError(error, op.retryCount)) {
            return { success: false, permanentError: error.message };
          }
          return { success: false };
        }
        return { success: true };
      } else if (op.action === 'update') {
        const payload = op.payload as TablesUpdate<'time_entry_pauses'>;
        const { error } = await supabase
          .from('time_entry_pauses')
          .update(payload)
          .eq('id', op.entityId)
          .eq('user_id', op.scope);

        if (error) {
          if (isPermanentError(error, op.retryCount)) {
            return { success: false, permanentError: error.message };
          }
          return { success: false };
        }
        return { success: true };
      } else if (op.action === 'delete') {
        const { error } = await supabase
          .from('time_entry_pauses')
          .delete()
          .eq('id', op.entityId)
          .eq('user_id', op.scope);

        if (error) {
          if (isPermanentError(error, op.retryCount)) {
            return { success: false, permanentError: error.message };
          }
          return { success: false };
        }
        return { success: true };
      }
    } else if (op.entityType === 'time_entry_idle') {
      if (op.action === 'create') {
        const payload = op.payload as TablesInsert<'time_entry_idles'>;
        const { error } = await supabase
          .from('time_entry_idles')
          .upsert(payload, { onConflict: 'id' });

        if (error) {
          if (isPermanentError(error, op.retryCount)) {
            return { success: false, permanentError: error.message };
          }
          return { success: false };
        }
        return { success: true };
      } else if (op.action === 'update') {
        const payload = op.payload as TablesUpdate<'time_entry_idles'>;
        const { error } = await supabase
          .from('time_entry_idles')
          .update(payload)
          .eq('id', op.entityId)
          .eq('user_id', op.scope);

        if (error) {
          if (isPermanentError(error, op.retryCount)) {
            return { success: false, permanentError: error.message };
          }
          return { success: false };
        }
        return { success: true };
      } else if (op.action === 'delete') {
        const { error } = await supabase
          .from('time_entry_idles')
          .delete()
          .eq('id', op.entityId)
          .eq('user_id', op.scope);

        if (error) {
          if (isPermanentError(error, op.retryCount)) {
            return { success: false, permanentError: error.message };
          }
          return { success: false };
        }
        return { success: true };
      }
    } else if (op.entityType === 'daily_report') {
      if (op.action === 'create') {
        const payload = op.payload as TablesInsert<'daily_reports'>;
        const { error } = await supabase
          .from('daily_reports')
          .upsert(payload, { onConflict: 'user_id,report_date' });

        if (error) {
          if (isPermanentError(error, op.retryCount)) {
            return { success: false, permanentError: error.message };
          }
          return { success: false };
        }
        return { success: true };
      } else if (op.action === 'update') {
        const payload = op.payload as TablesUpdate<'daily_reports'>;
        const { error } = await supabase
          .from('daily_reports')
          .update(payload)
          .eq('id', op.entityId)
          .eq('user_id', op.scope);

        if (error) {
          if (isPermanentError(error, op.retryCount)) {
            return { success: false, permanentError: error.message };
          }
          return { success: false };
        }
        return { success: true };
      } else if (op.action === 'delete') {
        const { error } = await supabase
          .from('daily_reports')
          .delete()
          .eq('id', op.entityId)
          .eq('user_id', op.scope);

        if (error) {
          if (isPermanentError(error, op.retryCount)) {
            return { success: false, permanentError: error.message };
          }
          return { success: false };
        }
        return { success: true };
      }
    }

    return { success: true };
  } catch (err) {
    console.warn('[Kuro SyncEngine] Network or server exception during sync:', err);
    return { success: false };
  }
}

/**
 * Processes pending outbox operations sequentially for the given user.
 */
export async function processOutbox(userId: string): Promise<void> {
  if (!userId || isSyncing) return;
  if (!supabase) return;

  // Synchronize activeUserId if needed
  if (!activeUserId && userId) {
    activeUserId = userId;
  }

  isSyncing = true;
  lastError = null;
  let currentCount = await getPendingOutboxCount(userId);
  notifyListeners(currentCount);

  try {
    const ops = await getOutboxOperationsForScope(userId);
    const pendingOps = ops.filter((o) => o.status === 'pending');

    for (const op of pendingOps) {
      // Abort immediately if user switched or logged out
      if (activeUserId !== userId || activeUserId !== op.scope) {
        break;
      }

      const result = await executeOperation(op);

      if (result.aborted) {
        break;
      }

      if (result.success) {
        await deleteOutboxOperation(op.id);
        notifyEntitySynced(op.entityType, op.entityId, 'synced');
        lastSyncedAt = new Date().toISOString();
      } else {
        if (result.permanentError) {
          // Permanent failure; mark as failed so it does not loop infinitely
          await updateOutboxOperation({
            ...op,
            status: 'failed',
            lastError: result.permanentError,
            retryCount: op.retryCount + 1,
          });
          notifyEntitySynced(op.entityType, op.entityId, 'sync-error');
          lastError = result.permanentError;
        } else {
          // Recoverable network failure; keep as pending, increment retryCount, and pause queue
          await updateOutboxOperation({
            ...op,
            retryCount: op.retryCount + 1,
            lastError: 'Network unreachable. Saved locally, waiting to synchronize.',
          });
          lastError = 'Saved locally on this device. Waiting for connection to synchronize.';
          break; // Stop loop; wait for next reconnect/trigger
        }
      }
    }
  } catch (err) {
    console.warn('[Kuro SyncEngine] Outbox processing encountered exception:', err);
    lastError = 'Unexpected error during sync processing.';
  } finally {
    isSyncing = false;
    currentCount = await getPendingOutboxCount(userId);
    notifyListeners(currentCount);
  }
}

// Global window event listener to trigger synchronization whenever connectivity returns
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    if (activeUserId) {
      void processOutbox(activeUserId);
    }
  });
}
