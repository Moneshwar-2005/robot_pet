import { useState, useEffect, useRef, useCallback } from 'react';
import { useAuth } from '../context/useAuth';
import {
  checkOllamaConnection,
  sendOllamaChat,
  OllamaClientError,
  getActiveOllamaBaseUrl,
  type OllamaModel,
  type OllamaChatMessage,
  type OllamaConnectionState,
} from '../lib/ollama';
import {
  parseActionProposal,
  type ActionProposal,
} from '../lib/assistantActions';
import { formatLocalDateString } from '../lib/formatters';

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
    text: 'Hello! I am Kuro, your personal desktop assistant. I am connected directly to your local Ollama AI model. How can I assist your productivity today?',
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

export function useOllamaChat() {
  const { user } = useAuth();
  const userId = user?.id || null;

  const [connectionState, setConnectionState] = useState<OllamaConnectionState>('checking');
  const [models, setModels] = useState<OllamaModel[]>([]);
  const [selectedModel, setSelectedModel] = useState<string>('');
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [connectionGuidance, setConnectionGuidance] = useState<string | null>(null);

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

  // Persist conversations whenever they change
  useEffect(() => {
    saveConversationsToStorage(conversations, activeConversationId, userId);
  }, [conversations, activeConversationId, userId]);

  // Derive active conversation and messages
  const activeConversation =
    conversations.find((c) => c.id === activeConversationId) || conversations[0] || null;
  const messages = activeConversation ? activeConversation.messages : [];

  // Check Ollama connection and discover models
  const refreshConnection = useCallback(async () => {
    setConnectionState('checking');
    setConnectionError(null);
    setConnectionGuidance(null);

    const result = await checkOllamaConnection(activeBaseUrl, 6000);

    setConnectionState(result.state);
    setModels(result.models);

    if (result.ok && result.models.length > 0) {
      setSelectedModel((prev) => {
        if (prev && result.models.some((m) => m.name === prev)) {
          return prev;
        }
        try {
          const saved = localStorage.getItem('kuro_selected_ollama_model');
          if (saved && result.models.some((m) => m.name === saved)) {
            return saved;
          }
        } catch {
          // ignore
        }
        return result.models[0].name;
      });
    } else {
      setConnectionError(result.error || null);
      setConnectionGuidance(result.recoveryGuidance || null);
    }
  }, [activeBaseUrl]);

  // Initial connection check on mount
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

  const handleSelectModel = useCallback((modelName: string) => {
    setSelectedModel(modelName);
    try {
      localStorage.setItem('kuro_selected_ollama_model', modelName);
    } catch {
      // ignore
    }
  }, []);

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
      // Abort in-flight request so response is never routed to wrong conversation
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

  // Send message
  const sendMessage = useCallback(
    async (text: string) => {
      const cleanText = text.trim();
      if (!cleanText || isLoading) return;

      const targetConvId = activeConversationIdRef.current;

      if (!selectedModel) {
        const errMsg: UIChatMessage = {
          id: `msg-${Date.now()}-err`,
          sender: 'assistant',
          text: 'Cannot send message: No local Ollama model is currently available or selected.',
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          status: 'error',
          errorMsg: connectionError || 'Ollama is offline or unreachable.',
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

      // Add user message to active conversation and update title if needed
      setConversations((prev) =>
        prev.map((conv) => {
          if (conv.id !== targetConvId) return conv;
          const isInitialTitle = conv.title === 'New Conversation' || conv.messages.length <= 1;
          const newTitle = isInitialTitle ? cleanText.slice(0, 36) : conv.title;
          return {
            ...conv,
            title: newTitle,
            updatedAt: new Date().toISOString(),
            messages: [...conv.messages, userMsg],
          };
        })
      );

      setIsLoading(true);

      const controller = new AbortController();
      activeAbortControllerRef.current = controller;

      try {
        const currentConv = conversations.find((c) => c.id === targetConvId);
        const currentMessages = currentConv ? currentConv.messages : [];

        // Build context payload
        const contextPayload: OllamaChatMessage[] = [
          { role: 'system', content: buildSystemPrompt() },
        ];

        // Include recent conversation turns (up to 10 previous turns)
        const recentHistory = currentMessages.filter((m) => m.status !== 'error').slice(-10);
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

        const response = await sendOllamaChat({
          baseUrl: activeBaseUrl,
          model: selectedModel,
          messages: contextPayload,
          signal: controller.signal,
          timeoutMs: 60000,
        });

        // Ensure we only update if user hasn't switched away
        if (targetConvId !== activeConversationIdRef.current) {
          return;
        }

        // Parse for action proposals (create_task, create_reminder)
        const parsedAction = parseActionProposal(response.message.content);

        const assistantMsg: UIChatMessage = {
          id: `assistant-${Date.now()}`,
          sender: 'assistant',
          text: parsedAction.cleanText,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          status: 'sent',
          modelUsed: response.model,
          proposal: parsedAction.proposal,
        };

        setConversations((prev) =>
          prev.map((conv) =>
            conv.id === targetConvId
              ? { ...conv, messages: [...conv.messages, assistantMsg], updatedAt: new Date().toISOString() }
              : conv
          )
        );
      } catch (err: unknown) {
        if (targetConvId !== activeConversationIdRef.current) {
          return;
        }

        if (err instanceof OllamaClientError && err.code === 'aborted') {
          const cancelledMsg: UIChatMessage = {
            id: `assistant-${Date.now()}-cancelled`,
            sender: 'assistant',
            text: '[Message generation cancelled]',
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            status: 'sent',
          };
          setConversations((prev) =>
            prev.map((conv) =>
              conv.id === targetConvId ? { ...conv, messages: [...conv.messages, cancelledMsg] } : conv
            )
          );
        } else {
          const clientErr = err instanceof OllamaClientError ? err : null;
          const errorMsgText = clientErr?.message || (err instanceof Error ? err.message : 'Unknown Ollama error');
          const guidance =
            clientErr?.recoveryGuidance ||
            'Verify that Ollama is active on http://localhost:11434 and your selected model is ready.';

          const errorMsg: UIChatMessage = {
            id: `assistant-${Date.now()}-err`,
            sender: 'assistant',
            text: `Failed to receive response from model "${selectedModel}".`,
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            status: 'error',
            errorMsg: errorMsgText,
            recoveryGuidance: guidance,
          };

          setConversations((prev) =>
            prev.map((conv) =>
              conv.id === targetConvId ? { ...conv, messages: [...conv.messages, errorMsg] } : conv
            )
          );
        }
      } finally {
        activeAbortControllerRef.current = null;
        setIsLoading(false);
      }
    },
    [isLoading, selectedModel, conversations, activeBaseUrl, connectionError, connectionGuidance]
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
  };
}
