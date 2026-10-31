import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import type { ClientMemory } from '../lib/adapters';
import { memoryRowToClient, memoryToInsertPayload } from '../lib/adapters';
import { sampleMemoryItems } from '../data/mockData';
import { useAuth } from '../context/useAuth';
import { supabase } from '../lib/supabase';
import { getOfflineCacheItem, setOfflineCacheItem, enqueueOutboxOperation, getOutboxOperationsForScope } from '../lib/offlineDb';
import { processOutbox } from '../lib/syncEngine';

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

  // Reconcile server memories with pending local outbox operations
  const reconcileMemories = useCallback(
    async (userId: string, serverMemories: ClientMemory[]): Promise<ClientMemory[]> => {
      try {
        const ops = await getOutboxOperationsForScope(userId);
        const memoryOps = ops.filter((o) => o.entityType === 'memory');
        if (memoryOps.length === 0) return serverMemories;

        const memoryMap = new Map<string, ClientMemory>();
        for (const m of serverMemories) {
          memoryMap.set(m.id, m);
        }

        for (const op of memoryOps) {
          if (op.action === 'create' && op.payload) {
            const p = op.payload as {
              id?: string;
              category: string;
              fact: string;
              confidence?: number;
              source?: string;
            };
            memoryMap.set(op.entityId, {
              id: op.entityId,
              category: p.category,
              fact: p.fact,
              confidence: p.confidence ?? 1.0,
              source: p.source || 'User Manual Entry',
              createdAt: op.createdAt,
              updatedAt: op.updatedAt,
            });
          } else if (op.action === 'update' && op.payload) {
            const existing = memoryMap.get(op.entityId);
            if (existing) {
              const p = op.payload as { category?: string; fact?: string; confidence?: number };
              memoryMap.set(op.entityId, {
                ...existing,
                ...(p.category ? { category: p.category } : {}),
                ...(p.fact ? { fact: p.fact } : {}),
                ...(p.confidence !== undefined ? { confidence: p.confidence } : {}),
                updatedAt: op.updatedAt,
              });
            }
          } else if (op.action === 'delete') {
            memoryMap.delete(op.entityId);
          }
        }

        return Array.from(memoryMap.values()).sort(
          (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        );
      } catch {
        return serverMemories;
      }
    },
    []
  );

  const fetchMemories = useCallback(
    async (userId: string) => {
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
          const reconciled = await reconcileMemories(userId, clientMemories);
          if (currentSeq === sequenceRef.current) {
            setDbMemories(reconciled);
            setDbUserId(userId);
            void setOfflineCacheItem(userId, 'memories', reconciled);
          }
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
    },
    [reconcileMemories]
  );

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
      if (!user) {
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

      // Authenticated local-first persistence with outbox queue
      const memoryId = crypto.randomUUID();
      const newMem: ClientMemory = {
        id: memoryId,
        category: data.category.trim(),
        fact: data.fact.trim(),
        confidence: data.confidence !== undefined ? data.confidence : 1.0,
        source: data.source?.trim() || 'User Manual Entry',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      setDbMemories((prev) => {
        const next = [newMem, ...prev];
        void setOfflineCacheItem(user.id, 'memories', next);
        return next;
      });

      try {
        const payload = memoryToInsertPayload({ ...data, id: memoryId }, user.id);
        await enqueueOutboxOperation({
          id: crypto.randomUUID(),
          scope: user.id,
          entityType: 'memory',
          entityId: memoryId,
          action: 'create',
          payload,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          status: 'pending',
          retryCount: 0,
        });

        void processOutbox(user.id);
        return true;
      } catch (err) {
        console.warn('[useMemories] Failed to enqueue memory create outbox op:', err);
        setError('Failed to queue memory locally.');
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
      if (!user) {
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

      // Authenticated local-first persistence with outbox queue
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

        await enqueueOutboxOperation({
          id: crypto.randomUUID(),
          scope: user.id,
          entityType: 'memory',
          entityId: id,
          action: 'update',
          payload,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          status: 'pending',
          retryCount: 0,
        });

        void processOutbox(user.id);
        return true;
      } catch (err) {
        console.warn('[useMemories] Failed to enqueue memory update outbox op:', err);
        setError('Failed to queue memory update locally.');
        return false;
      }
    },
    [user, dbMemories]
  );

  const deleteMemory = useCallback(
    async (id: string): Promise<boolean> => {
      setError(null);

      // Local demo mode
      if (!user) {
        setDemoMemories((prev) => prev.filter((m) => m.id !== id));
        return true;
      }

      // Optimistic delete with outbox queue
      const target = dbMemories.find((m) => m.id === id);
      if (!target) return false;
      const nextMemories = dbMemories.filter((m) => m.id !== id);
      setDbMemories(nextMemories);
      void setOfflineCacheItem(user.id, 'memories', nextMemories);

      try {
        await enqueueOutboxOperation({
          id: crypto.randomUUID(),
          scope: user.id,
          entityType: 'memory',
          entityId: id,
          action: 'delete',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          status: 'pending',
          retryCount: 0,
        });

        void processOutbox(user.id);
        return true;
      } catch (err) {
        console.warn('[useMemories] Failed to enqueue memory delete outbox op:', err);
        setError('Failed to queue memory deletion locally.');
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
