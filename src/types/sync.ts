/**
 * Kuro Synchronization Types — Step 3.5
 *
 * Defines explicit persistence and synchronization states for local-first operations.
 */

export type SyncStatus = 'local-only' | 'pending-sync' | 'synced' | 'sync-error';

export type OutboxAction = 'create' | 'update' | 'delete';

export type OutboxEntityType =
  | 'task'
  | 'reminder'
  | 'memory'
  | 'session'
  | 'pet_setting'
  | 'preference'
  | 'routine';

export type OutboxStatus = 'pending' | 'processing' | 'failed';

export interface OutboxOperation<T = unknown> {
  id: string; // Unique client-generated operation UUID
  scope: string; // Authenticated user ID (never 'demo')
  entityType: OutboxEntityType;
  entityId: string; // Target entity ID (UUID matching database row)
  action: OutboxAction;
  payload?: T; // Insert or update payload
  createdAt: string; // ISO-8601 timestamp
  updatedAt: string; // ISO-8601 timestamp
  status: OutboxStatus;
  retryCount: number;
  lastError?: string | null;
}

export interface SyncState {
  isSyncing: boolean;
  pendingCount: number;
  lastSyncedAt: string | null;
  lastError: string | null;
}
