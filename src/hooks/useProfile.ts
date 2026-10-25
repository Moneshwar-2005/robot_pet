import { useState, useEffect, useCallback, useRef } from 'react';
import type { UserProfile } from '../lib/adapters';
import { userProfileRowToClient } from '../lib/adapters';
import { useAuth } from '../context/useAuth';
import { supabase } from '../lib/supabase';

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
    if (!supabase) return;
    const currentSeq = ++sequenceRef.current;
    setLoading(true);
    setError(null);

    try {
      const { data, error: fetchErr } = await supabase
        .from('users')
        .select('id, email, full_name, avatar_url, created_at, updated_at')
        .eq('id', userId)
        .maybeSingle();

      if (currentSeq !== sequenceRef.current) return;

      if (fetchErr) {
        setError('Failed to load user profile from server.');
        setProfile(null);
      } else if (data) {
        setProfile(userProfileRowToClient(data));
      } else {
        // Profile row does not exist in public.users yet; gracefully provide in-memory view
        setProfile({
          id: userId,
          email: userEmail ?? null,
          fullName: null,
          avatarUrl: null,
        });
      }
      setProfileUserId(userId);
    } catch {
      if (currentSeq !== sequenceRef.current) return;
      setError('An unexpected network error occurred while loading profile.');
      setProfile(null);
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
      if (!user || !supabase) {
        setError('Cannot update profile: not authenticated.');
        return false;
      }

      setError(null);
      setSaving(true);
      const previous = profile;
      const trimmed = newFullName.trim();

      // Safe optimistic update
      setProfile((prev) =>
        prev
          ? { ...prev, fullName: trimmed || null }
          : {
              id: user.id,
              email: user.email ?? null,
              fullName: trimmed || null,
              avatarUrl: null,
            }
      );

      try {
        const { error: updateErr } = await supabase
          .from('users')
          .update({ full_name: trimmed || null })
          .eq('id', user.id);

        if (updateErr) {
          setProfile(previous);
          setError(updateErr.message || 'Failed to update profile name on server.');
          return false;
        }

        return true;
      } catch {
        setProfile(previous);
        setError('Network error while updating profile name.');
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
