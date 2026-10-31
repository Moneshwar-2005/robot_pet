/**
 * Kuro Offline Persistence Foundation — Typed IndexedDB Wrapper
 *
 * Scope: Step 3.5 Offline Data & Supabase Synchronization
 *
 * SAFETY & ARCHITECTURAL RULES:
 * 1. Strictly scope records by user ID or 'demo' to maintain account isolation.
 * 2. Never store credentials, passwords, access tokens, or refresh tokens.
 * 3. Store local durable cache entries and pending synchronization outbox operations.
 * 4. Support version upgrade migrations safely.
 */

import type { OutboxOperation, OutboxEntityType } from '../types/sync';

const DB_NAME = 'kuro_offline_db';
const DB_VERSION = 2;

export const STORES = {
  OFFLINE_CACHE: 'offline_cache',
  OUTBOX_META: 'outbox_meta', // Legacy store from v1
  SYNC_OUTBOX: 'sync_outbox', // Dedicated outbox store in v2
} as const;

export interface OfflineCacheEntry<T = unknown> {
  id: string; // Composite key: `${scope}:${key}`
  scope: string; // 'demo' or user.id
  key: string;
  data: T;
  updatedAt: string;
}

export interface OutboxMetaEntry {
  id: string;
  scope: string;
  entityType: OutboxEntityType;
  action: 'create' | 'update' | 'delete';
  createdAt: string;
  status: 'pending' | 'failed';
  retryCount: number;
}

let dbInstancePromise: Promise<IDBDatabase | null> | null = null;

function isIndexedDBAvailable(): boolean {
  try {
    return typeof window !== 'undefined' && 'indexedDB' in window && indexedDB !== null;
  } catch {
    return false;
  }
}

/**
 * Opens or initializes the Kuro IndexedDB database safely.
 * Returns null if IndexedDB is blocked or unsupported (e.g., restricted private window).
 */
export async function getOfflineDb(): Promise<IDBDatabase | null> {
  if (!isIndexedDBAvailable()) {
    return null;
  }

  if (dbInstancePromise) {
    return dbInstancePromise;
  }

  dbInstancePromise = new Promise((resolve) => {
    try {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;

        // Store 1: Offline application cache
        if (!db.objectStoreNames.contains(STORES.OFFLINE_CACHE)) {
          const cacheStore = db.createObjectStore(STORES.OFFLINE_CACHE, { keyPath: 'id' });
          cacheStore.createIndex('by_scope', 'scope', { unique: false });
          cacheStore.createIndex('by_updatedAt', 'updatedAt', { unique: false });
        }

        // Store 2: Legacy outbox metadata
        if (!db.objectStoreNames.contains(STORES.OUTBOX_META)) {
          const outboxMetaStore = db.createObjectStore(STORES.OUTBOX_META, { keyPath: 'id' });
          outboxMetaStore.createIndex('by_scope', 'scope', { unique: false });
          outboxMetaStore.createIndex('by_status', 'status', { unique: false });
        }

        // Store 3 (v2 upgrade): Synchronization outbox with full payloads & status
        if (!db.objectStoreNames.contains(STORES.SYNC_OUTBOX)) {
          const syncStore = db.createObjectStore(STORES.SYNC_OUTBOX, { keyPath: 'id' });
          syncStore.createIndex('by_scope', 'scope', { unique: false });
          syncStore.createIndex('by_status', 'status', { unique: false });
          syncStore.createIndex('by_createdAt', 'createdAt', { unique: false });
        }
      };

      request.onsuccess = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        resolve(db);
      };

      request.onerror = (event) => {
        console.warn('[Kuro OfflineDB] Failed to open IndexedDB:', (event.target as IDBOpenDBRequest).error);
        resolve(null);
      };

      request.onblocked = () => {
        console.warn('[Kuro OfflineDB] IndexedDB open request blocked.');
        resolve(null);
      };
    } catch (err) {
      console.warn('[Kuro OfflineDB] IndexedDB initialization exception:', err);
      resolve(null);
    }
  });

  return dbInstancePromise;
}

/**
 * Saves a non-sensitive cached item into IndexedDB under a given scope.
 */
export async function setOfflineCacheItem<T>(
  scope: string,
  key: string,
  data: T
): Promise<void> {
  const db = await getOfflineDb();
  if (!db) return;

  const id = `${scope}:${key}`;
  const entry: OfflineCacheEntry<T> = {
    id,
    scope,
    key,
    data,
    updatedAt: new Date().toISOString(),
  };

  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORES.OFFLINE_CACHE, 'readwrite');
      const store = tx.objectStore(STORES.OFFLINE_CACHE);
      store.put(entry);

      tx.oncomplete = () => resolve();
      tx.onerror = (event) => {
        console.warn('[Kuro OfflineDB] Error saving cache entry:', (event.target as IDBRequest).error);
        resolve();
      };
    } catch (err) {
      console.warn('[Kuro OfflineDB] Cache put transaction failed:', err);
      resolve();
    }
  });
}

/**
 * Retrieves a cached item from IndexedDB by scope and key.
 */
export async function getOfflineCacheItem<T>(
  scope: string,
  key: string
): Promise<T | null> {
  const db = await getOfflineDb();
  if (!db) return null;

  const id = `${scope}:${key}`;

  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORES.OFFLINE_CACHE, 'readonly');
      const store = tx.objectStore(STORES.OFFLINE_CACHE);
      const request = store.get(id);

      request.onsuccess = () => {
        const result = request.result as OfflineCacheEntry<T> | undefined;
        resolve(result ? result.data : null);
      };

      request.onerror = () => {
        resolve(null);
      };
    } catch (err) {
      console.warn('[Kuro OfflineDB] Cache get transaction failed:', err);
      resolve(null);
    }
  });
}

/**
 * Deletes a specific cache item from IndexedDB.
 */
export async function deleteOfflineCacheItem(
  scope: string,
  key: string
): Promise<void> {
  const db = await getOfflineDb();
  if (!db) return;

  const id = `${scope}:${key}`;

  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORES.OFFLINE_CACHE, 'readwrite');
      const store = tx.objectStore(STORES.OFFLINE_CACHE);
      store.delete(id);

      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

/**
 * Clears all cache records belonging to a specific scope (e.g., when a user signs out).
 * Also purges matching user-scoped localStorage keys to prevent private data exposure.
 */
export async function clearScopeCache(scope: string): Promise<void> {
  // 1. Purge matching localStorage keys for this user scope to prevent local data exposure
  if (typeof window !== 'undefined' && window.localStorage && scope) {
    try {
      const suffix = `_${scope}`;
      const keysToRemove: string[] = [];
      for (let i = 0; i < window.localStorage.length; i++) {
        const key = window.localStorage.key(i);
        if (key && (key.endsWith(suffix) || key.includes(suffix))) {
          keysToRemove.push(key);
        }
      }
      for (const k of keysToRemove) {
        window.localStorage.removeItem(k);
      }
    } catch (e) {
      console.warn('[Kuro OfflineDB] Failed to clear localStorage for scope:', e);
    }
  }

  // 2. Purge IndexedDB OFFLINE_CACHE
  const db = await getOfflineDb();
  if (!db) return;

  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORES.OFFLINE_CACHE, 'readwrite');
      const store = tx.objectStore(STORES.OFFLINE_CACHE);
      const index = store.index('by_scope');
      const request = index.openCursor(IDBKeyRange.only(scope));

      request.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result;
        if (cursor) {
          cursor.delete();
          cursor.continue();
        } else {
          resolve();
        }
      };

      request.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

/* ========================================================================= */
/* OUTBOX SYNCHRONIZATION OPERATIONS                                         */
/* ========================================================================= */

/**
 * Enqueues a synchronization operation into the outbox.
 * Idempotently merges operations on the same entity when appropriate:
 * - If user created then deleted before syncing: removes both ops.
 * - If user updated multiple times before syncing: replaces with newest update.
 */
export async function enqueueOutboxOperation(op: OutboxOperation): Promise<void> {
  const db = await getOfflineDb();
  if (!db) return;

  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORES.SYNC_OUTBOX, 'readwrite');
      const store = tx.objectStore(STORES.SYNC_OUTBOX);
      const index = store.index('by_scope');
      const request = index.openCursor(IDBKeyRange.only(op.scope));

      const existingOps: OutboxOperation[] = [];

      request.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result;
        if (cursor) {
          const item = cursor.value as OutboxOperation;
          if (item.entityType === op.entityType && item.entityId === op.entityId) {
            existingOps.push(item);
          }
          cursor.continue();
        } else {
          // Reconcile with existing ops on same entity
          if (op.action === 'delete') {
            const hasPendingCreate = existingOps.some((e) => e.action === 'create');
            if (hasPendingCreate) {
              // Entity was created locally and deleted before reaching server. Delete all ops for it.
              for (const e of existingOps) {
                store.delete(e.id);
              }
              return;
            }
            // Otherwise, remove any pending updates and insert delete op
            for (const e of existingOps) {
              store.delete(e.id);
            }
            store.put(op);
          } else if (op.action === 'update') {
            const pendingCreate = existingOps.find((e) => e.action === 'create');
            if (pendingCreate) {
              // Merge update payload into the pending create
              const mergedPayload = {
                ...(pendingCreate.payload as Record<string, unknown>),
                ...(op.payload as Record<string, unknown>),
              };
              store.put({
                ...pendingCreate,
                payload: mergedPayload,
                updatedAt: new Date().toISOString(),
              });
              return;
            }
            // Remove previous pending update ops and put new one
            for (const e of existingOps) {
              if (e.action === 'update') {
                store.delete(e.id);
              }
            }
            store.put(op);
          } else {
            // Create action
            store.put(op);
          }
        }
      };

      tx.oncomplete = () => resolve();
      tx.onerror = (err) => {
        console.warn('[Kuro OfflineDB] Failed to enqueue outbox op:', err);
        resolve();
      };
    } catch (err) {
      console.warn('[Kuro OfflineDB] Outbox enqueue transaction error:', err);
      resolve();
    }
  });
}

/**
 * Retrieves all outbox operations for a specific scope (userId).
 * Returns operations sorted by createdAt ascending (FIFO).
 */
export async function getOutboxOperationsForScope(scope: string): Promise<OutboxOperation[]> {
  const db = await getOfflineDb();
  if (!db) return [];

  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORES.SYNC_OUTBOX, 'readonly');
      const store = tx.objectStore(STORES.SYNC_OUTBOX);
      const index = store.index('by_scope');
      const request = index.getAll(IDBKeyRange.only(scope));

      request.onsuccess = () => {
        const results = (request.result || []) as OutboxOperation[];
        results.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
        resolve(results);
      };

      request.onerror = () => resolve([]);
    } catch {
      resolve([]);
    }
  });
}

/**
 * Updates an existing outbox operation (e.g., status, retry count, last error).
 */
export async function updateOutboxOperation(op: OutboxOperation): Promise<void> {
  const db = await getOfflineDb();
  if (!db) return;

  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORES.SYNC_OUTBOX, 'readwrite');
      const store = tx.objectStore(STORES.SYNC_OUTBOX);
      store.put({ ...op, updatedAt: new Date().toISOString() });

      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

/**
 * Deletes an outbox operation once it has successfully synchronized.
 */
export async function deleteOutboxOperation(id: string): Promise<void> {
  const db = await getOfflineDb();
  if (!db) return;

  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORES.SYNC_OUTBOX, 'readwrite');
      const store = tx.objectStore(STORES.SYNC_OUTBOX);
      store.delete(id);

      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

/**
 * Gets the count of pending outbox operations for a given scope.
 */
export async function getPendingOutboxCount(scope: string): Promise<number> {
  const db = await getOfflineDb();
  if (!db) return 0;

  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORES.SYNC_OUTBOX, 'readonly');
      const store = tx.objectStore(STORES.SYNC_OUTBOX);
      const index = store.index('by_scope');
      const request = index.count(IDBKeyRange.only(scope));

      request.onsuccess = () => resolve(request.result || 0);
      request.onerror = () => resolve(0);
    } catch {
      resolve(0);
    }
  });
}

/**
 * Clears all outbox operations for a specific scope (e.g. account wipe).
 */
export async function clearScopeOutbox(scope: string): Promise<void> {
  const db = await getOfflineDb();
  if (!db) return;

  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORES.SYNC_OUTBOX, 'readwrite');
      const store = tx.objectStore(STORES.SYNC_OUTBOX);
      const index = store.index('by_scope');
      const request = index.openCursor(IDBKeyRange.only(scope));

      request.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result;
        if (cursor) {
          cursor.delete();
          cursor.continue();
        } else {
          resolve();
        }
      };

      request.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}
