/**
 * Kuro Synchronization Status Hook — Step 3.5
 *
 * Exposes observable sync state and triggerSync action to UI components.
 */

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../context/useAuth';
import {
  subscribeSyncState,
  processOutbox,
  setActiveSyncUser,
} from '../lib/syncEngine';
import type { SyncState } from '../types/sync';

export function useSyncStatus(): SyncState & { triggerSync: () => Promise<void> } {
  const { user } = useAuth();
  const [syncState, setSyncState] = useState<SyncState>({
    isSyncing: false,
    pendingCount: 0,
    lastSyncedAt: null,
    lastError: null,
  });

  useEffect(() => {
    setActiveSyncUser(user?.id ?? null);
  }, [user?.id]);

  useEffect(() => {
    const unsubscribe = subscribeSyncState((nextState) => {
      setSyncState(nextState);
    });
    return unsubscribe;
  }, []);

  const userId = user?.id;
  const triggerSync = useCallback(async () => {
    if (userId) {
      await processOutbox(userId);
    }
  }, [userId]);

  return {
    ...syncState,
    triggerSync,
  };
}
