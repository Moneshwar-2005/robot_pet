/**
 * Kuro Companion — User Preferences Hook (user_preferences table persistence)
 *
 * Scope: Phase 10 Milestone 2 (User Preferences & Privacy Settings Integration)
 *
 * Connects all 9 Phase 9 preference columns + baseline theme to public.user_preferences:
 * - activity_tracking_enabled (Default: false)
 * - idle_threshold_seconds (Default: 300)
 * - auto_reports_enabled (Default: false)
 * - daily_report_time (Default: '18:00:00' -> '18:00')
 * - telemetry_retention_days (Default: 30)
 * - tracking_include_window_titles (Default: false)
 * - tracking_include_process_names (Default: false)
 * - music_reaction_enabled (Default: false)
 * - auto_break_reminders (Default: true)
 *
 * Guarantees:
 * 1. Strict privacy defaults: All 5 tracking/collection features are disabled by default.
 * 2. Authenticated user scoping: Fetches and mutates only rows where user_id = auth.uid().
 * 3. Offline-first resilience: Loads from IndexedDB cache immediately and queues changes to Outbox.
 * 4. Stale overwrite protection: Newer local mutations take precedence over older remote responses.
 * 5. Full backward compatibility: Preserves theme, setTheme, and toggleTheme signatures.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import type { Theme, UserPreferences } from '../types';
import { DEFAULT_USER_PREFERENCES } from '../types';
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
  userPreferencesRowToClient,
  clientPreferencesToDbPayload,
  clientPreferencesToInsertPayload,
} from '../lib/adapters';

export interface UseUserPreferencesReturn {
  preferences: UserPreferences;
  theme: Theme;
  loading: boolean;
  saving: boolean;
  error: string | null;
  setTheme: (newTheme: Theme) => Promise<boolean>;
  toggleTheme: () => Promise<boolean>;
  updatePreferences: (updates: Partial<UserPreferences>) => Promise<boolean>;
  resetToDefaults: () => Promise<boolean>;
  retry: () => void;
}

function loadDemoPreferences(): UserPreferences {
  try {
    const raw = localStorage.getItem('kuro_user_preferences');
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        return {
          ...DEFAULT_USER_PREFERENCES,
          ...parsed,
          theme: parsed.theme === 'light' ? 'light' : 'dark',
        };
      }
    }
    // Fallback to legacy theme key if present
    const legacyTheme = localStorage.getItem('kuro_theme');
    if (legacyTheme === 'light' || legacyTheme === 'dark') {
      return {
        ...DEFAULT_USER_PREFERENCES,
        theme: legacyTheme,
      };
    }
  } catch {}
  return { ...DEFAULT_USER_PREFERENCES };
}

export function useUserPreferences(): UseUserPreferencesReturn {
  const { user } = useAuth();
  const [preferences, setPreferencesState] = useState<UserPreferences>(loadDemoPreferences);
  const [loading, setLoading] = useState<boolean>(Boolean(user));
  const [saving, setSaving] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const sequenceRef = useRef<number>(0);
  const localMutationVersionRef = useRef<number>(0);
  const lastLocalMutationTimestampRef = useRef<number>(0);

  // Sync theme with HTML data-theme attribute
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', preferences.theme);
  }, [preferences.theme]);

  // Load preferences for authenticated user or fallback
  const fetchPreferences = useCallback(async (userId: string) => {
    const currentSeq = ++sequenceRef.current;
    const fetchMutationVersion = localMutationVersionRef.current;
    setLoading(true);
    setError(null);

    // 1. Instant offline load from local IndexedDB cache
    try {
      const cached = await getOfflineCacheItem<UserPreferences>(userId, 'user_preferences');
      if (cached && currentSeq === sequenceRef.current) {
        setPreferencesState(cached);
        setLoading(false);
      }
    } catch {
      // Fallback gracefully
    }

    if (!supabase) {
      setLoading(false);
      return;
    }

    try {
      const { data, error: fetchErr } = await supabase
        .from('user_preferences')
        .select('*')
        .eq('user_id', userId)
        .maybeSingle();

      if (currentSeq !== sequenceRef.current) return;

      if (fetchErr) {
        setError(`Failed to load preferences: ${fetchErr.message}`);
        return;
      }

      // Logical mutation version check: discard stale remote fetch if a local mutation happened while in-flight
      if (localMutationVersionRef.current > fetchMutationVersion) {
        return;
      }

      // Check if there are pending Outbox operations for preference in offline storage
      try {
        const pendingOps = await getOutboxOperationsForScope(userId);
        if (pendingOps.some((op) => op.entityType === 'preference' && op.status === 'pending')) {
          return;
        }
      } catch {
        // Fallback gracefully if IDB check fails
      }

      if (data) {
        const serverPrefs = userPreferencesRowToClient(data);
        setPreferencesState(serverPrefs);
        void setOfflineCacheItem(userId, 'user_preferences', serverPrefs);
        void setOfflineCacheItem(userId, 'theme', serverPrefs.theme);
      } else {
        // Row doesn't exist yet; create initial default preference record with strict privacy defaults
        const insertPayload = clientPreferencesToInsertPayload(DEFAULT_USER_PREFERENCES, userId);
        const { data: created, error: createErr } = await supabase
          .from('user_preferences')
          .upsert(insertPayload, { onConflict: 'user_id' })
          .select('*')
          .single();

        if (createErr) {
          setError(`Failed to initialize preferences: ${createErr.message}`);
          return;
        }

        if (currentSeq === sequenceRef.current && created) {
          if (localMutationVersionRef.current > fetchMutationVersion) {
            return;
          }
          const newPrefs = userPreferencesRowToClient(created);
          setPreferencesState(newPrefs);
          void setOfflineCacheItem(userId, 'user_preferences', newPrefs);
          void setOfflineCacheItem(userId, 'theme', newPrefs.theme);
        }
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Network error while loading preferences';
      setError(msg);
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
          setPreferencesState(loadDemoPreferences());
          setLoading(false);
          setError(null);
        }
      });
    } else {
      queueMicrotask(() => {
        if (isCurrent) {
          void fetchPreferences(currentUserId);
        }
      });
    }

    return () => {
      isCurrent = false;
    };
  }, [user?.id, fetchPreferences]);

  const updatePreferences = useCallback(
    async (updates: Partial<UserPreferences>): Promise<boolean> => {
      setSaving(true);
      setError(null);

      const merged: UserPreferences = {
        ...preferences,
        ...updates,
      };

      setPreferencesState(merged);
      localMutationVersionRef.current += 1;
      lastLocalMutationTimestampRef.current = Date.now();

      if (!user) {
        try {
          localStorage.setItem('kuro_user_preferences', JSON.stringify(merged));
          localStorage.setItem('kuro_theme', merged.theme);
        } catch {}
        setSaving(false);
        return true;
      }

      // Authenticated: Cache locally and queue outbox operation
      void setOfflineCacheItem(user.id, 'user_preferences', merged);
      void setOfflineCacheItem(user.id, 'theme', merged.theme);

      const dbPayload = clientPreferencesToDbPayload(updates);

      try {
        await enqueueOutboxOperation({
          id: crypto.randomUUID(),
          scope: user.id,
          entityType: 'preference',
          entityId: user.id,
          action: 'update',
          payload: dbPayload,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          status: 'pending',
          retryCount: 0,
        });

        void processOutbox(user.id);
        setSaving(false);
        return true;
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Failed to save preferences';
        console.warn('[useUserPreferences] Failed to enqueue preference outbox op:', err);
        setError(msg);
        setSaving(false);
        return false;
      }
    },
    [user, preferences]
  );

  const setTheme = useCallback(
    async (newTheme: Theme): Promise<boolean> => {
      return updatePreferences({ theme: newTheme });
    },
    [updatePreferences]
  );

  const toggleTheme = useCallback(async (): Promise<boolean> => {
    const nextTheme: Theme = preferences.theme === 'dark' ? 'light' : 'dark';
    return updatePreferences({ theme: nextTheme });
  }, [preferences.theme, updatePreferences]);

  const resetToDefaults = useCallback(async (): Promise<boolean> => {
    return updatePreferences(DEFAULT_USER_PREFERENCES);
  }, [updatePreferences]);

  const retry = useCallback(() => {
    if (user?.id) {
      void fetchPreferences(user.id);
    }
  }, [user, fetchPreferences]);

  return {
    preferences,
    theme: preferences.theme,
    loading,
    saving,
    error,
    setTheme,
    toggleTheme,
    updatePreferences,
    resetToDefaults,
    retry,
  };
}
