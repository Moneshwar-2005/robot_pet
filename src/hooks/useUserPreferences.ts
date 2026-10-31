/**
 * Kuro Companion — User Preferences Hook (user_preferences table persistence)
 *
 * Scope: Phase 8.5 Database Persistence & Preferences
 *
 * Manages theme and user-level preferences.
 * - Authenticated: Persists to Supabase `user_preferences` table and IndexedDB cache with offline outbox support.
 * - Unauthenticated / Demo: Persists locally to localStorage.
 * - Applies theme to HTML documentElement immediately.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import type { Theme } from '../types';
import { useAuth } from '../context/useAuth';
import { supabase } from '../lib/supabase';
import { getOfflineCacheItem, setOfflineCacheItem, enqueueOutboxOperation } from '../lib/offlineDb';
import { processOutbox } from '../lib/syncEngine';

export interface UseUserPreferencesReturn {
  theme: Theme;
  loading: boolean;
  setTheme: (newTheme: Theme) => Promise<boolean>;
  toggleTheme: () => Promise<boolean>;
}

function loadDemoTheme(): Theme {
  try {
    const saved = localStorage.getItem('kuro_theme');
    if (saved === 'light' || saved === 'dark') {
      return saved;
    }
  } catch {}
  return 'dark';
}

export function useUserPreferences(): UseUserPreferencesReturn {
  const { user } = useAuth();
  const [theme, setThemeState] = useState<Theme>(loadDemoTheme);
  const [loading, setLoading] = useState<boolean>(Boolean(user));
  const sequenceRef = useRef<number>(0);

  // Sync theme with HTML data-theme attribute
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  // Load preferences for authenticated user or fallback
  const fetchPreferences = useCallback(async (userId: string) => {
    const currentSeq = ++sequenceRef.current;

    // 1. Instant offline load from local IndexedDB cache
    try {
      const cached = await getOfflineCacheItem<Theme>(userId, 'theme');
      if (cached && currentSeq === sequenceRef.current) {
        setThemeState(cached);
        setLoading(false);
      }
    } catch {
      // Fallback gracefully
    }

    if (!supabase) return;

    try {
      const { data, error: fetchErr } = await supabase
        .from('user_preferences')
        .select('*')
        .eq('user_id', userId)
        .maybeSingle();

      if (currentSeq !== sequenceRef.current) return;

      if (!fetchErr && data) {
        const serverTheme = data.theme;
        setThemeState(serverTheme);
        void setOfflineCacheItem(userId, 'theme', serverTheme);
      } else if (!fetchErr && !data) {
        // Row doesn't exist yet; create initial default preference
        const insertPayload = {
          user_id: userId,
          theme: 'dark' as const,
        };
        const { data: created } = await supabase
          .from('user_preferences')
          .upsert(insertPayload, { onConflict: 'user_id' })
          .select('*')
          .single();

        if (currentSeq === sequenceRef.current && created) {
          setThemeState(created.theme);
          void setOfflineCacheItem(userId, 'theme', created.theme);
        }
      }
    } catch {
      // Offline fallback: keep cached theme
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
          setThemeState(loadDemoTheme());
          setLoading(false);
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

  const setTheme = useCallback(
    async (newTheme: Theme): Promise<boolean> => {
      setThemeState(newTheme);

      if (!user) {
        try {
          localStorage.setItem('kuro_theme', newTheme);
        } catch {}
        return true;
      }

      // Authenticated: Cache locally and queue outbox operation
      void setOfflineCacheItem(user.id, 'theme', newTheme);

      try {
        await enqueueOutboxOperation({
          id: crypto.randomUUID(),
          scope: user.id,
          entityType: 'preference',
          entityId: user.id,
          action: 'update',
          payload: { theme: newTheme },
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          status: 'pending',
          retryCount: 0,
        });

        void processOutbox(user.id);
        return true;
      } catch (err) {
        console.warn('[useUserPreferences] Failed to enqueue preference outbox op:', err);
        return false;
      }
    },
    [user]
  );

  const toggleTheme = useCallback(async (): Promise<boolean> => {
    const nextTheme: Theme = theme === 'dark' ? 'light' : 'dark';
    return setTheme(nextTheme);
  }, [theme, setTheme]);

  return {
    theme,
    loading,
    setTheme,
    toggleTheme,
  };
}

