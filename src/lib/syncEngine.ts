/**
 * Kuro Synchronization Engine — Step 3.5
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
} from './offlineDb';
import type { OutboxOperation, SyncState } from '../types/sync';
import type { TablesInsert, TablesUpdate } from '../types/database';

type SyncListener = (state: SyncState) => void;
type EntitySyncListener = (entityType: 'task' | 'reminder', entityId: string, status: 'synced' | 'sync-error') => void;

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

function notifyEntitySynced(entityType: 'task' | 'reminder', entityId: string, status: 'synced' | 'sync-error') {
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

function isPermanentError(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  if (error.code && /^(22|23|42)/.test(error.code)) {
    return true;
  }
  if (error.message && (
    error.message.includes('JWT') ||
    error.message.includes('violates') ||
    error.message.includes('invalid input') ||
    error.message.includes('permission denied')
  )) {
    return true;
  }
  return false;
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
        const payload = op.payload as TablesInsert<'tasks'>;
        const { error } = await supabase
          .from('tasks')
          .upsert(payload, { onConflict: 'id' });

        if (error) {
          if (isPermanentError(error)) {
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
          if (isPermanentError(error)) {
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
          if (isPermanentError(error)) {
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
          if (isPermanentError(error)) {
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
          if (isPermanentError(error)) {
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
          if (isPermanentError(error)) {
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
