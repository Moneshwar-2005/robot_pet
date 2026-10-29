import { useState, useEffect, useCallback, useRef } from 'react';
import type { ClientPetSettings } from '../lib/adapters';
import { petSettingsRowToClient, petSettingsToUpdatePayload } from '../lib/adapters';
import { useAuth } from '../context/useAuth';
import { supabase } from '../lib/supabase';
import { getOfflineCacheItem, setOfflineCacheItem } from '../lib/offlineDb';
import { DEFAULT_DOCUMENTED_PET_SETTINGS } from '../lib/pet/faceLifecycle';

export const defaultPetSettings: ClientPetSettings = DEFAULT_DOCUMENTED_PET_SETTINGS;

function loadDemoPetSettings(): ClientPetSettings {
  try {
    const raw = localStorage.getItem('kuro_demo_pet_settings');
    if (raw) {
      return JSON.parse(raw);
    }
  } catch {}
  return defaultPetSettings;
}

export interface UsePetSettingsReturn {
  petSettings: ClientPetSettings;
  loading: boolean;
  saving: boolean;
  error: string | null;
  updatePetSettings: (newSettings: Partial<ClientPetSettings>) => Promise<boolean>;
  retry: () => void;
  resetDemoData: () => void;
}

export function usePetSettings(): UsePetSettingsReturn {
  const { user } = useAuth();
  const [demoSettings, setDemoSettings] = useState<ClientPetSettings>(loadDemoPetSettings);
  const [dbSettings, setDbSettings] = useState<ClientPetSettings>(defaultPetSettings);
  const [dbUserId, setDbUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(Boolean(user));
  const [saving, setSaving] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const sequenceRef = useRef<number>(0);

  // Derive active settings: if authenticated, use dbSettings for active user; otherwise demoSettings
  const activeSettings = user ? (dbUserId === user.id ? dbSettings : defaultPetSettings) : demoSettings;
  const activeLoading = user ? (dbUserId === user.id ? loading : true) : false;

  const fetchPetSettings = useCallback(async (userId: string) => {
    const currentSeq = ++sequenceRef.current;
    setError(null);

    // 1. Instant offline load from local IndexedDB cache
    try {
      const cached = await getOfflineCacheItem<ClientPetSettings>(userId, 'pet_settings');
      if (cached && currentSeq === sequenceRef.current) {
        setDbSettings(cached);
        setDbUserId(userId);
        setLoading(false);
      }
    } catch {
      // Fallback gracefully
    }

    if (!supabase) return;

    try {
      const { data, error: fetchErr } = await supabase
        .from('pet_settings')
        .select('*')
        .eq('user_id', userId)
        .maybeSingle();

      if (currentSeq !== sequenceRef.current) return;

      if (fetchErr) {
        setError('Offline or server unreachable. Showing cached companion settings.');
        return;
      }

      if (data) {
        const clientSettings = petSettingsRowToClient(data);
        setDbSettings(clientSettings);
        setDbUserId(userId);
        void setOfflineCacheItem(userId, 'pet_settings', clientSettings);
      } else {
        // If no settings row exists yet for this user, insert default row
        const insertPayload = {
          user_id: userId,
          ...petSettingsToUpdatePayload(defaultPetSettings),
        };
        const { data: created, error: createErr } = await supabase
          .from('pet_settings')
          .insert(insertPayload)
          .select('*')
          .single();

        if (currentSeq !== sequenceRef.current) return;

        if (!createErr && created) {
          const clientSettings = petSettingsRowToClient(created);
          setDbSettings(clientSettings);
          setDbUserId(userId);
          void setOfflineCacheItem(userId, 'pet_settings', clientSettings);
        } else {
          setDbSettings(defaultPetSettings);
        }
      }
      setDbUserId(userId);
    } catch {
      if (currentSeq !== sequenceRef.current) return;
      setError('Network offline. Showing cached companion settings.');
      setDbUserId(userId);
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
          setDbSettings(defaultPetSettings);
          setDbUserId(null);
          setLoading(false);
          setSaving(false);
          setError(null);
        }
      });
    } else {
      queueMicrotask(() => {
        if (isCurrent) {
          void fetchPetSettings(currentUserId);
        }
      });
    }

    return () => {
      isCurrent = false;
    };
  }, [user?.id, fetchPetSettings]);

  const updatePetSettings = useCallback(
    async (partial: Partial<ClientPetSettings>): Promise<boolean> => {
      setError(null);

      // Local demo mode
      if (!user || !supabase) {
        setDemoSettings((prev) => {
          const next = { ...prev, ...partial };
          try {
            localStorage.setItem('kuro_demo_pet_settings', JSON.stringify(next));
          } catch {}
          return next;
        });
        return true;
      }

      // Authenticated persistence with optimistic update & rollback
      const previous = dbSettings;
      const updated = { ...dbSettings, ...partial };
      setDbSettings(updated);
      void setOfflineCacheItem(user.id, 'pet_settings', updated);
      setSaving(true);

      try {
        const payload = petSettingsToUpdatePayload(partial);
        const { error: updateErr } = await supabase
          .from('pet_settings')
          .update(payload)
          .eq('user_id', user.id);

        if (updateErr) {
          setDbSettings(previous);
          void setOfflineCacheItem(user.id, 'pet_settings', previous);
          setError(updateErr.message || 'Failed to save companion settings.');
          return false;
        }

        return true;
      } catch {
        setDbSettings(previous);
        void setOfflineCacheItem(user.id, 'pet_settings', previous);
        setError('Network offline. Companion settings could not be saved to server.');
        return false;
      } finally {
        setSaving(false);
      }
    },
    [user, dbSettings]
  );

  const retry = useCallback(() => {
    if (user?.id) {
      void fetchPetSettings(user.id);
    }
  }, [user, fetchPetSettings]);

  const resetDemoData = useCallback(() => {
    if (!user) {
      try {
        localStorage.removeItem('kuro_demo_pet_settings');
      } catch {}
      setDemoSettings(defaultPetSettings);
      setError(null);
    }
  }, [user]);

  return {
    petSettings: activeSettings,
    loading: activeLoading,
    saving,
    error,
    updatePetSettings,
    retry,
    resetDemoData,
  };
}
