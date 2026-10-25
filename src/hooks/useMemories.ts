import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import type { ClientMemory } from '../lib/adapters';
import { memoryRowToClient, memoryToInsertPayload } from '../lib/adapters';
import { sampleMemoryItems } from '../data/mockData';
import { useAuth } from '../context/useAuth';
import { supabase } from '../lib/supabase';
import { getOfflineCacheItem, setOfflineCacheItem } from '../lib/offlineDb';

export const initialMemories: ClientMemory[] = sampleMemoryItems.map((m, idx) => ({
  id: m.id,
  category: m.category,
  fact: m.fact,
  confidence: parseFloat(m.confidence) / 100 || 1.0,
  source: m.source,
  createdAt: new Date(Date.now() - idx * 86400000).toISOString(),
  updatedAt: new Date(Date.now() - idx * 86400000).toISOString(),
}));

export interface UseMemoriesReturn {
  memories: ClientMemory[];
  loading: boolean;
  error: string | null;
  addMemory: (data: { category: string; fact: string; confidence?: number; source?: string }) => Promise<boolean>;
  editMemory: (id: string, updates: { category?: string; fact?: string; confidence?: number }) => Promise<boolean>;
  deleteMemory: (id: string) => Promise<boolean>;
  retry: () => void;
  resetDemoData: () => void;
}

export function useMemories(): UseMemoriesReturn {
  const { user } = useAuth();
  const [demoMemories, setDemoMemories] = useState<ClientMemory[]>(initialMemories);
  const [dbMemories, setDbMemories] = useState<ClientMemory[]>([]);
  const [dbUserId, setDbUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(Boolean(user));
  const [error, setError] = useState<string | null>(null);

  const sequenceRef = useRef<number>(0);

  // Derive active memories: if authenticated, strictly use dbMemories for active user; otherwise demoMemories
  const activeMemories = useMemo(() => {
    return user ? (dbUserId === user.id ? dbMemories : []) : demoMemories;
  }, [user, dbUserId, dbMemories, demoMemories]);
  const activeLoading = user ? (dbUserId === user.id ? loading : true) : false;

  const fetchMemories = useCallback(async (userId: string) => {
    const currentSeq = ++sequenceRef.current;
    setError(null);

    // 1. Instant offline load from local IndexedDB cache
    try {
      const cached = await getOfflineCacheItem<ClientMemory[]>(userId, 'memories');
      if (cached && currentSeq === sequenceRef.current) {
        setDbMemories(cached);
        setDbUserId(userId);
        setLoading(false);
      }
    } catch {
      // Fallback gracefully
    }

    if (!supabase) return;

    try {
      const { data, error: fetchErr } = await supabase
        .from('user_memories')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false });

      if (currentSeq !== sequenceRef.current) return;

      if (fetchErr) {
        setError('Offline or server unreachable. Showing cached memories.');
      } else {
        const clientMemories = (data || []).map(memoryRowToClient);
        setDbMemories(clientMemories);
        setDbUserId(userId);
        void setOfflineCacheItem(userId, 'memories', clientMemories);
      }
    } catch {
      if (currentSeq !== sequenceRef.current) return;
      setError('Network offline. Showing cached memories.');
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
          setDbMemories([]);
          setDbUserId(null);
          setLoading(false);
          setError(null);
        }
      });
    } else {
      queueMicrotask(() => {
        if (isCurrent) {
          void fetchMemories(currentUserId);
        }
      });
    }

    return () => {
      isCurrent = false;
    };
  }, [user?.id, fetchMemories]);

  const addMemory = useCallback(
    async (data: { category: string; fact: string; confidence?: number; source?: string }): Promise<boolean> => {
      setError(null);

      // Local demo mode
      if (!user || !supabase) {
        const newMem: ClientMemory = {
          id: `mem-${Date.now()}`,
          category: data.category.trim(),
          fact: data.fact.trim(),
          confidence: data.confidence !== undefined ? data.confidence : 1.0,
          source: data.source?.trim() || 'User Manual Entry',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        setDemoMemories((prev) => [newMem, ...prev]);
        return true;
      }

      // Authenticated persistence
      try {
        const payload = memoryToInsertPayload(data, user.id);
        const { data: created, error: insertErr } = await supabase
          .from('user_memories')
          .insert(payload)
          .select('*')
          .single();

        if (insertErr || !created) {
          setError(insertErr?.message || 'Failed to save memory to server.');
          return false;
        }

        const clientMem = memoryRowToClient(created);
        setDbMemories((prev) => {
          const next = [clientMem, ...prev];
          void setOfflineCacheItem(user.id, 'memories', next);
          return next;
        });
        return true;
      } catch {
        setError('Network offline. Memory could not be saved to server.');
        return false;
      }
    },
    [user]
  );

  const editMemory = useCallback(
    async (
      id: string,
      updates: { category?: string; fact?: string; confidence?: number }
    ): Promise<boolean> => {
      setError(null);

      // Local demo mode
      if (!user || !supabase) {
        setDemoMemories((prev) =>
          prev.map((m) =>
            m.id === id
              ? {
                  ...m,
                  ...(updates.category !== undefined ? { category: updates.category.trim() } : {}),
                  ...(updates.fact !== undefined ? { fact: updates.fact.trim() } : {}),
                  ...(updates.confidence !== undefined ? { confidence: updates.confidence } : {}),
                  updatedAt: new Date().toISOString(),
                }
              : m
          )
        );
        return true;
      }

      // Authenticated persistence with optimistic update and rollback
      const previousMemories = [...dbMemories];
      const target = dbMemories.find((m) => m.id === id);
      if (!target) return false;

      const nextMemories = dbMemories.map((m) =>
        m.id === id
          ? {
              ...m,
              ...(updates.category !== undefined ? { category: updates.category.trim() } : {}),
              ...(updates.fact !== undefined ? { fact: updates.fact.trim() } : {}),
              ...(updates.confidence !== undefined ? { confidence: updates.confidence } : {}),
              updatedAt: new Date().toISOString(),
            }
          : m
      );
      setDbMemories(nextMemories);
      void setOfflineCacheItem(user.id, 'memories', nextMemories);

      try {
        const payload: { category?: string; fact?: string; confidence?: number } = {};
        if (updates.category !== undefined) payload.category = updates.category.trim();
        if (updates.fact !== undefined) payload.fact = updates.fact.trim();
        if (updates.confidence !== undefined) payload.confidence = updates.confidence;

        const { error: updateErr } = await supabase
          .from('user_memories')
          .update(payload)
          .eq('id', id)
          .eq('user_id', user.id);

        if (updateErr) {
          setDbMemories(previousMemories);
          void setOfflineCacheItem(user.id, 'memories', previousMemories);
          setError(updateErr.message || 'Failed to update memory on server.');
          return false;
        }

        return true;
      } catch {
        setDbMemories(previousMemories);
        void setOfflineCacheItem(user.id, 'memories', previousMemories);
        setError('Network offline. Memory update could not be saved to server.');
        return false;
      }
    },
    [user, dbMemories]
  );

  const deleteMemory = useCallback(
    async (id: string): Promise<boolean> => {
      setError(null);

      // Local demo mode
      if (!user || !supabase) {
        setDemoMemories((prev) => prev.filter((m) => m.id !== id));
        return true;
      }

      // Optimistic delete with targeted rollback
      const target = dbMemories.find((m) => m.id === id);
      if (!target) return false;
      const nextMemories = dbMemories.filter((m) => m.id !== id);
      setDbMemories(nextMemories);
      void setOfflineCacheItem(user.id, 'memories', nextMemories);

      try {
        const { error: deleteErr } = await supabase
          .from('user_memories')
          .delete()
          .eq('id', id)
          .eq('user_id', user.id);

        if (deleteErr) {
          setDbMemories((prev) => (prev.some((m) => m.id === id) ? prev : [target, ...prev]));
          void setOfflineCacheItem(user.id, 'memories', dbMemories);
          setError(deleteErr.message || 'Failed to delete memory from server.');
          return false;
        }

        return true;
      } catch {
        setDbMemories((prev) => (prev.some((m) => m.id === id) ? prev : [target, ...prev]));
        void setOfflineCacheItem(user.id, 'memories', dbMemories);
        setError('Network offline. Memory deletion could not be saved to server.');
        return false;
      }
    },
    [user, dbMemories]
  );

  const retry = useCallback(() => {
    if (user?.id) {
      void fetchMemories(user.id);
    }
  }, [user, fetchMemories]);

  const resetDemoData = useCallback(() => {
    if (!user) {
      setDemoMemories(initialMemories);
      setError(null);
    }
  }, [user]);

  return {
    memories: activeMemories,
    loading: activeLoading,
    error,
    addMemory,
    editMemory,
    deleteMemory,
    retry,
    resetDemoData,
  };
}
