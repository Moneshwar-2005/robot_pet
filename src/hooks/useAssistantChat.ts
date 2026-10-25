/**
 * Provider-Independent Assistant Chat Orchestration Hook for Kuro.
 *
 * Separates conversation state, UI streaming updates, safe action parsing,
 * and persistence from the underlying AI runtime (Ollama, Mobile, Cloud).
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { useAuth } from '../context/useAuth';
import {
  getAllProviders,
  getProvider,
  getSavedProviderId,
  saveProviderId,
  type AIProviderId,
  type AIModelInfo,
  type AIConnectionState,
  type AIChatMessage,
  type AIInitProgress,
  type WebLLMLifecycleState,
  AIProviderError,
} from '../lib/ai';
import { probeStorage, type StorageProbeResult } from '../lib/ai/compatibilityProbe';
import { webllmMobileProvider } from '../lib/ai/webllmProvider';

import {
  parseActionProposal,
  type ActionProposal,
} from '../lib/assistantActions';
import { formatLocalDateString } from '../lib/formatters';
import { getActiveOllamaBaseUrl } from '../lib/ollama';

export interface UIChatMessage {
  id: string;
  sender: 'user' | 'assistant';
  text: string;
  timestamp: string;
  status?: 'sending' | 'sent' | 'error';
  errorMsg?: string;
  recoveryGuidance?: string;
  modelUsed?: string;
  proposal?: ActionProposal | null;
}

export interface Conversation {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: UIChatMessage[];
}

function buildSystemPrompt(): string {
  const localDateStr = formatLocalDateString();
  const dayName = new Date().toLocaleDateString(undefined, { weekday: 'long' });

  return `You are Kuro, a helpful, polite, and concise desktop personal assistant and companion.
You assist the user with focus, productivity, scheduling ideas, task planning, and answering questions.
Be concise, clear, and direct.
Today is ${dayName}, ${localDateStr}.
Admit uncertainty when you do not know something or cannot perform a physical action.
Never claim to have inspected files or computer activity unless provided in the chat.

ACTION PROPOSAL RULES:
When the user explicitly asks you to create, add, or schedule a task or reminder, provide a brief conversational response AND include an action proposal block formatted exactly as:
\`\`\`action
{
  "action": "create_task",
  "title": "Task title",
  "category": "work",
  "priority": "medium",
  "dueDate": "YYYY-MM-DD",
  "dueTime": "HH:MM",
  "estimatedMinutes": 25,
  "description": "Optional notes"
}
\`\`\`
OR for a reminder:
\`\`\`action
{
  "action": "create_reminder",
  "title": "Reminder title",
  "time": "YYYY-MM-DDTHH:mm:ss",
  "reminderType": "wellness",
  "priority": "normal"
}
\`\`\`
- Valid task categories: "work", "personal", "robot", "learning".
- Valid task priorities: "low", "medium", "high", "urgent".
- Valid reminder types: "wellness", "task", "meeting", "pet-routine".
- Valid reminder priorities: "normal", "important".
- Never invent actions or execute them yourself; the user must confirm them first. Only propose an action when the user explicitly requests one.`;
}

function createDefaultWelcomeMessage(): UIChatMessage {
  return {
    id: `welcome-${Date.now()}`,
    sender: 'assistant',
    text: 'Hello! I am Kuro, your personal desktop assistant. I am connected directly to your local AI model. How can I assist your productivity today?',
    timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    status: 'sent',
  };
}

function createNewConversation(title = 'New Conversation'): Conversation {
  const now = new Date().toISOString();
  return {
    id: `conv-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    title,
    createdAt: now,
    updatedAt: now,
    messages: [createDefaultWelcomeMessage()],
  };
}

function getStorageKeys(userId?: string | null) {
  const scope = userId || 'demo';
  return {
    conversationsKey: `kuro_conversations_${scope}`,
    activeIdKey: `kuro_active_conversation_id_${scope}`,
    legacyKey: `kuro_chat_history_${scope}`,
  };
}

function loadConversationsFromStorage(userId?: string | null): {
  conversations: Conversation[];
  activeId: string;
} {
  const { conversationsKey, activeIdKey, legacyKey } = getStorageKeys(userId);

  try {
    const raw = localStorage.getItem(conversationsKey);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        const savedActiveId = localStorage.getItem(activeIdKey);
        const activeId = parsed.some((c: Conversation) => c.id === savedActiveId)
          ? (savedActiveId as string)
          : parsed[0].id;
        return { conversations: parsed, activeId };
      }
    }

    // Check for legacy single-thread history to migrate
    const legacyRaw = localStorage.getItem(legacyKey);
    if (legacyRaw) {
      const legacyParsed = JSON.parse(legacyRaw);
      if (Array.isArray(legacyParsed) && legacyParsed.length > 0) {
        const migratedConv: Conversation = {
          id: `conv-legacy-${Date.now()}`,
          title: 'Previous Conversation',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          messages: legacyParsed,
        };
        return { conversations: [migratedConv], activeId: migratedConv.id };
      }
    }
  } catch {
    // Malformed storage fallback
  }

  const defaultConv = createNewConversation();
  return { conversations: [defaultConv], activeId: defaultConv.id };
}

function saveConversationsToStorage(
  conversations: Conversation[],
  activeId: string,
  userId?: string | null
): void {
  const { conversationsKey, activeIdKey } = getStorageKeys(userId);

  try {
    // Prune to maximum 20 conversations, each up to 50 messages
    const pruned = conversations.slice(0, 20).map((c) => ({
      ...c,
      messages: c.messages.slice(-50),
    }));

    localStorage.setItem(conversationsKey, JSON.stringify(pruned));
    localStorage.setItem(activeIdKey, activeId);
  } catch {
    // Storage quota or private browsing restriction
  }
}

export function useAssistantChat() {
  const { user } = useAuth();
  const userId = user?.id || null;

  // Provider architecture state
  const providers = getAllProviders();
  const [activeProviderId, setActiveProviderId] = useState<AIProviderId>(getSavedProviderId);
  const activeProvider = getProvider(activeProviderId);

  const [connectionState, setConnectionState] = useState<AIConnectionState>('checking');
  const [models, setModels] = useState<AIModelInfo[]>([]);
  const [selectedModel, setSelectedModel] = useState<string>('');
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [connectionGuidance, setConnectionGuidance] = useState<string | null>(null);

  // On-device WebLLM state
  const [initProgress, setInitProgress] = useState<AIInitProgress | null>(null);
  const [isInitializing, setIsInitializing] = useState<boolean>(false);
  const [benchmarkTimingMs, setBenchmarkTimingMs] = useState<number | null>(null);
  const [lifecycleState, setLifecycleState] = useState<WebLLMLifecycleState>(
    webllmMobileProvider.lifecycleState || 'not_initialized'
  );
  const [isModelCached, setIsModelCached] = useState<boolean>(false);
  const [storageEstimate, setStorageEstimate] = useState<StorageProbeResult | null>(null);

  // Synchronize on-device WebLLM lifecycle and progress listeners
  useEffect(() => {
    const unsubLifecycle = webllmMobileProvider.addLifecycleListener((state) => {
      setLifecycleState(state);
    });
    const unsubProgress = webllmMobileProvider.addProgressListener((p) => {
      setInitProgress(p);
    });
    return () => {
      unsubLifecycle();
      unsubProgress();
    };
  }, []);

  // Proactively check cache existence and browser storage quota when model changes
  useEffect(() => {
    let isMounted = true;
    if (activeProviderId === 'on_device_mobile' && selectedModel) {
      void webllmMobileProvider.checkModelCache(selectedModel).then((cached) => {
        if (isMounted) setIsModelCached(cached);
      });
      void probeStorage().then((res) => {
        if (isMounted) setStorageEstimate(res);
      });
    }
    return () => {
      isMounted = false;
    };
  }, [activeProviderId, selectedModel]);

  const initialData = loadConversationsFromStorage(userId);
  const [conversations, setConversations] = useState<Conversation[]>(initialData.conversations);
  const [activeConversationId, setActiveConversationId] = useState<string>(initialData.activeId);

  const [isLoading, setIsLoading] = useState(false);
  const activeAbortControllerRef = useRef<AbortController | null>(null);
  const activeConversationIdRef = useRef<string>(activeConversationId);
  useEffect(() => {
    activeConversationIdRef.current = activeConversationId;
  }, [activeConversationId]);

  const activeBaseUrl = getActiveOllamaBaseUrl();

  // Adjust conversation state during render when active user account changes
  const [prevUserId, setPrevUserId] = useState(userId);
  if (prevUserId !== userId) {
    setPrevUserId(userId);
    const refreshed = loadConversationsFromStorage(userId);
    setConversations(refreshed.conversations);
    setActiveConversationId(refreshed.activeId);
  }

  // Persist conversations when idle or completed, preventing disk thrashing on every stream chunk
  useEffect(() => {
    if (!isLoading) {
      saveConversationsToStorage(conversations, activeConversationId, userId);
    }
  }, [conversations, activeConversationId, userId, isLoading]);

  // Ensure last state saved on window unload
  useEffect(() => {
    const handleBeforeUnload = () => {
      saveConversationsToStorage(conversations, activeConversationId, userId);
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [conversations, activeConversationId, userId]);

  // Derive active conversation and messages
  const activeConversation =
    conversations.find((c) => c.id === activeConversationId) || conversations[0] || null;
  const messages = activeConversation ? activeConversation.messages : [];

  // Check Provider connection and discover models
  const refreshConnection = useCallback(async () => {
    setConnectionState('checking');
    setConnectionError(null);
    setConnectionGuidance(null);

    try {
      const status = await activeProvider.checkStatus();

      setConnectionState(status.state);
      setModels(status.models);

      if (status.state === 'connected' && status.models.length > 0) {
        setSelectedModel((prev) => {
          if (prev && status.models.some((m) => m.name === prev || m.id === prev)) {
            return prev;
          }
          return status.activeModel || status.models[0].name;
        });
      } else {
        setSelectedModel(status.activeModel || '');
        setConnectionError(status.error || null);
        setConnectionGuidance(status.recoveryGuidance || null);
      }
    } catch (err: unknown) {
      setConnectionState('error');
      setModels([]);
      setSelectedModel('');
      setConnectionError(err instanceof Error ? err.message : 'Failed to query AI provider.');
      setConnectionGuidance('Check provider status and retry.');
    }
  }, [activeProvider]);

  // Initial connection check on mount or when active provider changes
  useEffect(() => {
    let isMounted = true;
    queueMicrotask(() => {
      if (isMounted) {
        void refreshConnection();
      }
    });
    return () => {
      isMounted = false;
    };
  }, [refreshConnection]);

  const handleSelectProvider = useCallback(
    (providerId: AIProviderId) => {
      if (!providers.some((p) => p.id === providerId)) return;
      if (activeAbortControllerRef.current) {
        activeAbortControllerRef.current.abort();
        activeAbortControllerRef.current = null;
        setIsLoading(false);
      }

      // If switching away from WebLLM while initializing, cancel initialization
      if (activeProviderId === 'on_device_mobile' && activeProvider.cancelInitialization && isInitializing) {
        activeProvider.cancelInitialization();
      }

      setActiveProviderId(providerId);
      saveProviderId(providerId);
      setInitProgress(null);
      setIsInitializing(false);
      setBenchmarkTimingMs(null);
    },
    [providers, activeProviderId, activeProvider, isInitializing]
  );

  const handleSelectModel = useCallback(
    (modelName: string) => {
      setSelectedModel(modelName);
      try {
        if (activeProviderId === 'on_device_mobile') {
          localStorage.setItem('kuro_selected_webllm_model', modelName);
        } else {
          localStorage.setItem('kuro_selected_ollama_model', modelName);
        }
      } catch {
        // ignore
      }
    },
    [activeProviderId]
  );

  const initializeOnDeviceModel = useCallback(
    async (modelId?: string) => {
      if (!activeProvider.initializeModel) return;
      // Concurrency guard: Ignore repeated clicks if already starting/cancelling
      if (isInitializing || lifecycleState === 'downloading_initializing' || lifecycleState === 'cancelling') {
        return;
      }

      const targetModel = modelId || selectedModel;
      setIsInitializing(true);
      setConnectionError(null);
      try {
        await activeProvider.initializeModel(targetModel, (p) => {
          setInitProgress(p);
        });
        await refreshConnection();
        const isCached = await webllmMobileProvider.checkModelCache(targetModel);
        setIsModelCached(isCached);
      } catch (err: unknown) {
        setConnectionError(err instanceof Error ? err.message : 'Model initialization failed.');
        await refreshConnection();
      } finally {
        setIsInitializing(false);
      }
    },
    [activeProvider, selectedModel, isInitializing, lifecycleState, refreshConnection]
  );

  const cancelOnDeviceInit = useCallback(() => {
    if (activeProvider.cancelInitialization) {
      activeProvider.cancelInitialization();
      setIsInitializing(false);
      setInitProgress(null);
      void refreshConnection();
    }
  }, [activeProvider, refreshConnection]);

  const deleteOnDeviceCachedModel = useCallback(
    async (modelId?: string) => {
      const target = modelId || selectedModel;
      if (!target || !activeProvider.deleteCachedModel) return;
      try {
        await activeProvider.deleteCachedModel(target);
        setIsModelCached(false);
        await refreshConnection();
      } catch (err) {
        console.error('[Kuro] Error deleting cached model:', err);
      }
    },
    [activeProvider, selectedModel, refreshConnection]
  );

  const unloadOnDeviceModel = useCallback(async () => {
    if (activeProvider.unload) {
      await activeProvider.unload();
      await refreshConnection();
    }
  }, [activeProvider, refreshConnection]);


  const cancelRequest = useCallback(() => {
    if (activeAbortControllerRef.current) {
      activeAbortControllerRef.current.abort();
      activeAbortControllerRef.current = null;
      setIsLoading(false);
    }
  }, []);

  // Conversation Management actions
  const startNewConversation = useCallback(() => {
    cancelRequest();
    const newConv = createNewConversation();
    setConversations((prev) => [newConv, ...prev]);
    setActiveConversationId(newConv.id);
  }, [cancelRequest]);

  const selectConversation = useCallback(
    (id: string) => {
      if (id === activeConversationId) return;
      cancelRequest();
      setActiveConversationId(id);
    },
    [activeConversationId, cancelRequest]
  );

  const deleteConversation = useCallback(
    (id: string) => {
      cancelRequest();
      setConversations((prev) => {
        const filtered = prev.filter((c) => c.id !== id);
        if (filtered.length === 0) {
          const fresh = createNewConversation();
          setActiveConversationId(fresh.id);
          return [fresh];
        }
        if (activeConversationId === id) {
          setActiveConversationId(filtered[0].id);
        }
        return filtered;
      });
    },
    [activeConversationId, cancelRequest]
  );

  const clearAllConversations = useCallback(() => {
    cancelRequest();
    const fresh = createNewConversation();
    setConversations([fresh]);
    setActiveConversationId(fresh.id);
  }, [cancelRequest]);

  const renameConversation = useCallback((id: string, newTitle: string) => {
    const trimmed = newTitle.trim();
    if (!trimmed) return;
    setConversations((prev) =>
      prev.map((c) => (c.id === id ? { ...c, title: trimmed.slice(0, 40), updatedAt: new Date().toISOString() } : c))
    );
  }, []);

  // Updates proposal status (e.g. 'executing', 'confirmed', 'cancelled', 'error')
  const updateProposalStatus = useCallback(
    (messageId: string, status: ActionProposal['status'], errorMsg?: string) => {
      setConversations((prev) =>
        prev.map((conv) => ({
          ...conv,
          messages: conv.messages.map((msg) => {
            if (msg.id === messageId && msg.proposal) {
              return {
                ...msg,
                proposal: {
                  ...msg.proposal,
                  status,
                  errorMsg: errorMsg !== undefined ? errorMsg : msg.proposal.errorMsg,
                },
              };
            }
            return msg;
          }),
        }))
      );
    },
    []
  );

  // Send message with streaming through the active AI provider
  const sendMessage = useCallback(
    async (text: string) => {
      const cleanText = text.trim();
      if (!cleanText || isLoading) return;

      const targetConvId = activeConversationIdRef.current;

      if (!activeProvider.isImplemented) {
        const errMsg: UIChatMessage = {
          id: `msg-${Date.now()}-err`,
          sender: 'assistant',
          text: `Provider "${activeProvider.name}" is not implemented in this build.`,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          status: 'error',
          errorMsg: 'Selected provider is scheduled for a future step.',
          recoveryGuidance: 'Please switch back to Local Ollama (PC) in the provider selector.',
        };

        setConversations((prev) =>
          prev.map((conv) =>
            conv.id === targetConvId
              ? { ...conv, messages: [...conv.messages, errMsg], updatedAt: new Date().toISOString() }
              : conv
          )
        );
        return;
      }

      // Check if on-device model needs initialization first
      if (activeProvider.id === 'on_device_mobile' && !activeProvider.isModelLoaded) {
        const errMsg: UIChatMessage = {
          id: `msg-${Date.now()}-err`,
          sender: 'assistant',
          text: 'The on-device model is not loaded yet. Please click "Download & Initialize Model" above to load the model into your browser.',
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          status: 'error',
          errorMsg: 'On-device model weights not loaded.',
          recoveryGuidance: 'Click "Download & Initialize Model" above to begin setup.',
        };

        setConversations((prev) =>
          prev.map((conv) =>
            conv.id === targetConvId
              ? { ...conv, messages: [...conv.messages, errMsg], updatedAt: new Date().toISOString() }
              : conv
          )
        );
        return;
      }

      if (!selectedModel) {

        const errMsg: UIChatMessage = {
          id: `msg-${Date.now()}-err`,
          sender: 'assistant',
          text: `Cannot send message: No model is currently available or selected for "${activeProvider.name}".`,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          status: 'error',
          errorMsg: connectionError || `${activeProvider.name} is offline or unreachable.`,
          recoveryGuidance:
            connectionGuidance ||
            'Ensure Ollama is running (`ollama serve`) and a model is pulled (e.g. `ollama run qwen2.5:3b`).',
        };

        setConversations((prev) =>
          prev.map((conv) =>
            conv.id === targetConvId
              ? { ...conv, messages: [...conv.messages, errMsg], updatedAt: new Date().toISOString() }
              : conv
          )
        );
        return;
      }

      const userMsg: UIChatMessage = {
        id: `user-${Date.now()}`,
        sender: 'user',
        text: cleanText,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        status: 'sent',
      };

      const assistantMsgId = `assistant-${Date.now()}`;
      const initialAssistantMsg: UIChatMessage = {
        id: assistantMsgId,
        sender: 'assistant',
        text: '',
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        status: 'sending',
        modelUsed: selectedModel,
        proposal: null,
      };

      // Add user message and assistant placeholder immediately
      setConversations((prev) =>
        prev.map((conv) => {
          if (conv.id !== targetConvId) return conv;
          const isInitialTitle = conv.title === 'New Conversation' || conv.messages.length <= 1;
          const newTitle = isInitialTitle ? cleanText.slice(0, 36) : conv.title;
          return {
            ...conv,
            title: newTitle,
            updatedAt: new Date().toISOString(),
            messages: [...conv.messages, userMsg, initialAssistantMsg],
          };
        })
      );

      setIsLoading(true);

      const controller = new AbortController();
      activeAbortControllerRef.current = controller;
      let accumulatedText = '';

      try {
        const currentConv = conversations.find((c) => c.id === targetConvId);
        const currentMessages = currentConv ? currentConv.messages : [];

        // Build context payload with bounded recent history (8 recent turns for fast CPU processing)
        const contextPayload: AIChatMessage[] = [
          { role: 'system', content: buildSystemPrompt() },
        ];

        const recentHistory = currentMessages
          .filter((m) => m.status === 'sent' && m.text.trim())
          .slice(-8);

        for (const m of recentHistory) {
          contextPayload.push({
            role: m.sender === 'user' ? 'user' : 'assistant',
            content: m.text,
          });
        }
        contextPayload.push({
          role: 'user',
          content: cleanText,
        });

        const streamResult = await activeProvider.sendChatStream({
          model: selectedModel,
          messages: contextPayload,
          signal: controller.signal,
          timeoutMs: 90000,
          options: {
            maxTokens: 384,
            temperature: 0.6,
            topP: 0.9,
          },
          onChunk: (_delta, fullTextSoFar) => {
            accumulatedText = fullTextSoFar;
            // Verify conversation is still actively selected by user
            if (targetConvId !== activeConversationIdRef.current) {
              return;
            }

            setConversations((prev) =>
              prev.map((conv) => {
                if (conv.id !== targetConvId) return conv;
                return {
                  ...conv,
                  messages: conv.messages.map((m) =>
                    m.id === assistantMsgId ? { ...m, text: fullTextSoFar } : m
                  ),
                };
              })
            );
          },
        });

        if (streamResult.totalDurationMs) {
          setBenchmarkTimingMs(streamResult.totalDurationMs);
        }

        // Ensure we only finalize if user hasn't switched away

        if (targetConvId !== activeConversationIdRef.current) {
          return;
        }

        // Parse for action proposals ONLY after complete stream has finished
        const parsedAction = parseActionProposal(streamResult.content || accumulatedText);

        setConversations((prev) =>
          prev.map((conv) => {
            if (conv.id !== targetConvId) return conv;
            return {
              ...conv,
              messages: conv.messages.map((m) =>
                m.id === assistantMsgId
                  ? {
                      ...m,
                      text: parsedAction.cleanText,
                      status: 'sent',
                      modelUsed: streamResult.modelUsed || selectedModel,
                      proposal: parsedAction.proposal,
                    }
                  : m
              ),
              updatedAt: new Date().toISOString(),
            };
          })
        );
      } catch (err: unknown) {
        if (targetConvId !== activeConversationIdRef.current) {
          return;
        }

        if (err instanceof AIProviderError && err.code === 'aborted') {
          const finalPartial = accumulatedText.trim();
          setConversations((prev) =>
            prev.map((conv) => {
              if (conv.id !== targetConvId) return conv;
              return {
                ...conv,
                messages: conv.messages.map((m) => {
                  if (m.id !== assistantMsgId) return m;
                  return {
                    ...m,
                    text: finalPartial
                      ? `${finalPartial}\n\n[Generation stopped]`
                      : '[Message generation cancelled]',
                    status: 'sent',
                    proposal: null,
                  };
                }),
                updatedAt: new Date().toISOString(),
              };
            })
          );
        } else {
          const providerErr = err instanceof AIProviderError ? err : null;
          const errorMsgText = providerErr?.message || (err instanceof Error ? err.message : 'Unknown AI Provider error');
          const guidance =
            providerErr?.recoveryGuidance ||
            'Verify that the active AI provider is running and accessible.';

          setConversations((prev) =>
            prev.map((conv) => {
              if (conv.id !== targetConvId) return conv;
              return {
                ...conv,
                messages: conv.messages.map((m) => {
                  if (m.id !== assistantMsgId) return m;
                  return {
                    ...m,
                    text: accumulatedText.trim()
                      ? `${accumulatedText.trim()}\n\n[Generation interrupted due to error]`
                      : `Failed to receive response from provider "${activeProvider.name}" (${selectedModel}).`,
                    status: 'error',
                    errorMsg: errorMsgText,
                    recoveryGuidance: guidance,
                    proposal: null,
                  };
                }),
                updatedAt: new Date().toISOString(),
              };
            })
          );
        }
      } finally {
        activeAbortControllerRef.current = null;
        setIsLoading(false);
      }
    },
    [isLoading, activeProvider, selectedModel, conversations, connectionError, connectionGuidance]
  );

  const retryLastMessage = useCallback(() => {
    const targetConv = conversations.find((c) => c.id === activeConversationId);
    if (!targetConv) return;
    const lastUserMsg = [...targetConv.messages].reverse().find((m) => m.sender === 'user');
    if (lastUserMsg) {
      sendMessage(lastUserMsg.text);
    }
  }, [conversations, activeConversationId, sendMessage]);

  return {
    providers,
    activeProvider,
    activeProviderId,
    selectProvider: handleSelectProvider,
    connectionState,
    models,
    selectedModel,
    connectionError,
    connectionGuidance,
    conversations,
    activeConversationId,
    activeConversation,
    messages,
    isLoading,
    refreshConnection,
    selectModel: handleSelectModel,
    startNewConversation,
    selectConversation,
    deleteConversation,
    clearAllConversations,
    renameConversation,
    updateProposalStatus,
    sendMessage,
    retryLastMessage,
    cancelRequest,
    activeBaseUrl,
    // On-device WebLLM lifecycle exports
    isModelLoaded: Boolean(activeProvider.isModelLoaded),
    isInitializing,
    initProgress,
    lifecycleState,
    isModelCached,
    storageEstimate,
    initializeOnDeviceModel,
    cancelOnDeviceInit,
    deleteOnDeviceCachedModel,
    unloadOnDeviceModel,
    benchmarkTimingMs,
  };
}

