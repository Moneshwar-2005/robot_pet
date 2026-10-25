import { useState, useEffect, useCallback, useRef } from 'react';
import type { UserProfile } from '../lib/adapters';
import { userProfileRowToClient } from '../lib/adapters';
import { useAuth } from '../context/useAuth';
import { supabase } from '../lib/supabase';
import { getOfflineCacheItem, setOfflineCacheItem } from '../lib/offlineDb';

export interface UseProfileReturn {
  profile: UserProfile | null;
  loading: boolean;
  saving: boolean;
  error: string | null;
  updateFullName: (newFullName: string) => Promise<boolean>;
  retry: () => void;
}

export function useProfile(): UseProfileReturn {
  const { user } = useAuth();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [profileUserId, setProfileUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(Boolean(user));
  const [saving, setSaving] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const sequenceRef = useRef<number>(0);

  // Active profile strictly scoped to the active user; immediately null if user logged out or switched
  const activeProfile = user ? (profileUserId === user.id ? profile : null) : null;
  const activeLoading = user ? (profileUserId === user.id ? loading : true) : false;

  const fetchProfile = useCallback(async (userId: string, userEmail?: string | null) => {
    const currentSeq = ++sequenceRef.current;
    setError(null);

    // 1. Instant offline load from local IndexedDB cache
    try {
      const cached = await getOfflineCacheItem<UserProfile>(userId, 'profile');
      if (cached && currentSeq === sequenceRef.current) {
        setProfile(cached);
        setProfileUserId(userId);
        setLoading(false);
      }
    } catch {
      // Fallback gracefully
    }

    if (!supabase) return;

    try {
      const { data, error: fetchErr } = await supabase
        .from('users')
        .select('id, email, full_name, avatar_url, created_at, updated_at')
        .eq('id', userId)
        .maybeSingle();

      if (currentSeq !== sequenceRef.current) return;

      if (fetchErr) {
        setError('Offline or server unreachable. Showing cached profile.');
      } else if (data) {
        const clientProfile = userProfileRowToClient(data);
        setProfile(clientProfile);
        setProfileUserId(userId);
        void setOfflineCacheItem(userId, 'profile', clientProfile);
      } else {
        // Profile row does not exist in public.users yet; gracefully provide fallback
        const fallbackProfile: UserProfile = {
          id: userId,
          email: userEmail ?? null,
          fullName: null,
          avatarUrl: null,
        };
        setProfile(fallbackProfile);
        setProfileUserId(userId);
        void setOfflineCacheItem(userId, 'profile', fallbackProfile);
      }
    } catch {
      if (currentSeq !== sequenceRef.current) return;
      setError('Network offline. Showing cached profile.');
      setProfileUserId(userId);
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
    const currentUserEmail = user?.email ?? null;

    if (!currentUserId) {
      queueMicrotask(() => {
        if (isCurrent) {
          setProfile(null);
          setProfileUserId(null);
          setLoading(false);
          setSaving(false);
          setError(null);
        }
      });
    } else {
      queueMicrotask(() => {
        if (isCurrent) {
          void fetchProfile(currentUserId, currentUserEmail);
        }
      });
    }

    return () => {
      isCurrent = false;
    };
  }, [user?.id, user?.email, fetchProfile]);

  const updateFullName = useCallback(
    async (newFullName: string): Promise<boolean> => {
      if (!user || !supabase) return false;

      const trimmedName = newFullName.trim();
      const previous = profile;
      setError(null);
      setSaving(true);

      const optimistic: UserProfile = {
        id: user.id,
        email: user.email ?? profile?.email ?? null,
        fullName: trimmedName,
        avatarUrl: profile?.avatarUrl ?? null,
      };

      // Optimistic update
      setProfile(optimistic);
      void setOfflineCacheItem(user.id, 'profile', optimistic);

      try {
        const { error: updateErr } = await supabase
          .from('users')
          .update({ full_name: trimmedName, updated_at: new Date().toISOString() })
          .eq('id', user.id);

        if (updateErr) {
          // If row didn't exist, attempt insert
          const { error: insertErr } = await supabase.from('users').insert({
            id: user.id,
            email: user.email ?? null,
            full_name: trimmedName,
          });

          if (insertErr) {
            setProfile(previous);
            if (previous) {
              void setOfflineCacheItem(user.id, 'profile', previous);
            }
            setError(insertErr.message || 'Failed to update profile name on server.');
            return false;
          }
        }

        return true;
      } catch {
        setProfile(previous);
        if (previous) {
          void setOfflineCacheItem(user.id, 'profile', previous);
        }
        setError('Network offline. Profile name could not be saved to server.');
        return false;
      } finally {
        setSaving(false);
      }
    },
    [user, profile]
  );

  const retry = useCallback(() => {
    if (user?.id) {
      void fetchProfile(user.id, user.email);
    }
  }, [user, fetchProfile]);

  return {
    profile: activeProfile,
    loading: activeLoading,
    saving,
    error,
    updateFullName,
    retry,
  };
}
