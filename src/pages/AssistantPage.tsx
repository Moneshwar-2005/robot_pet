import React, { useState, useRef, useEffect } from 'react';
import { PlannedFeatureNotice } from '../components/common/PlannedFeatureNotice';
import {
  Bot,
  Send,
  User,
  Sparkles,
  Mic,
  RotateCcw,
  Trash2,
  AlertCircle,
  Square,
  Loader2,
  Cpu,
  RefreshCw,
  Terminal,
  Plus,
  History,
  MessageSquare,
  Check,
  Edit2,
  ChevronLeft,
  Layers,
} from 'lucide-react';
import { useAssistantChat } from '../hooks/useAssistantChat';
import { useAuth } from '../context/useAuth';
import { ActionProposalCard } from '../components/assistant/ActionProposalCard';
import { WebLLMSetupPanel } from '../components/assistant/WebLLMSetupPanel';
import { CloudAISetupPanel } from '../components/assistant/CloudAISetupPanel';
import type { Task, Reminder, PageId } from '../types';
import type { ActionProposal, TaskProposalPayload, ReminderProposalPayload } from '../lib/assistantActions';
import type { AIProviderId } from '../lib/ai';
import type { ClientMemory } from '../lib/adapters';

interface AssistantPageProps {
  onAddTask?: (newTaskData: Omit<Task, 'id'>) => Promise<void>;
  onAddReminder?: (newReminderData: Omit<Reminder, 'id'>) => Promise<void>;
  onNavigate?: (page: PageId) => void;
  memories?: ClientMemory[];
}

export const AssistantPage: React.FC<AssistantPageProps> = ({
  onAddTask,
  onAddReminder,
  onNavigate,
  memories,
}) => {
  const { user } = useAuth();
  const isAuthUser = Boolean(user);
  const userEmail = user?.email || null;

  const {
    providers,
    activeProvider,
    activeProviderId,
    selectProvider,
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
    selectModel,
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
    isModelLoaded,
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
  } = useAssistantChat({ memories });


  const [inputValue, setInputValue] = useState('');
  const [showHistoryPanel, setShowHistoryPanel] = useState(false);
  const [convToDelete, setConvToDelete] = useState<string | null>(null);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [editingConvId, setEditingConvId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState('');

  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading]);

  const handleSendMessage = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputValue.trim() || isLoading) return;
    const text = inputValue;
    setInputValue('');
    sendMessage(text);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && e.shiftKey) {
      e.preventDefault();
    }
  };

  const handleQuickCommand = (prompt: string) => {
    setInputValue(prompt);
  };

  const formatModelSize = (bytes?: number): string => {
    if (!bytes || bytes <= 0) return '';
    const gb = bytes / (1024 * 1024 * 1024);
    return `${gb.toFixed(1)} GB`;
  };

  // Action Confirmation Handlers
  const handleConfirmAction = async (msgId: string, proposal: ActionProposal) => {
    updateProposalStatus(msgId, 'executing');

    try {
      if (proposal.actionType === 'create_task') {
        if (!onAddTask) {
          throw new Error('Task creation service is currently unavailable.');
        }

        const p = proposal.payload as TaskProposalPayload;
        const taskPayload: Omit<Task, 'id'> = {
          title: p.title,
          category: p.category,
          priority: p.priority,
          dueDate: p.dueDate,
          dueTime: p.dueTime,
          estimatedMinutes: p.estimatedMinutes,
          completed: false,
          tags: [],
          description: p.description,
        };

        await onAddTask(taskPayload);
        updateProposalStatus(msgId, 'confirmed');
      } else if (proposal.actionType === 'create_reminder') {
        if (!onAddReminder) {
          throw new Error('Reminder creation service is currently unavailable.');
        }

        const p = proposal.payload as ReminderProposalPayload;
        const reminderPayload: Omit<Reminder, 'id'> = {
          title: p.title,
          time: p.time,
          type: p.type,
          priority: p.priority,
          done: false,
        };

        await onAddReminder(reminderPayload);
        updateProposalStatus(msgId, 'confirmed');
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to save record.';
      updateProposalStatus(msgId, 'error', msg);
      throw err;
    }
  };

  const handleCancelAction = (msgId: string) => {
    updateProposalStatus(msgId, 'cancelled');
  };

  // Conversation Renaming
  const handleStartRename = (id: string, currentTitle: string) => {
    setEditingConvId(id);
    setEditingTitle(currentTitle);
  };

  const handleSaveRename = (id: string) => {
    if (editingTitle.trim()) {
      renameConversation(id, editingTitle.trim());
    }
    setEditingConvId(null);
  };

  const renderConnectionBadge = () => {
    if (activeProviderId === 'on_device_mobile') {
      if (isModelLoaded || lifecycleState === 'ready') {
        return (
          <div
            style={{
              fontSize: '11px',
              color: 'var(--status-green)',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            <span className="brand-pulse-dot" />
            <span>WebLLM Ready ({selectedModel || 'On-Device'})</span>
            {benchmarkTimingMs !== null && benchmarkTimingMs !== undefined && (
              <span style={{ color: 'var(--text-muted)' }}>
                • ~{(benchmarkTimingMs / 1000).toFixed(1)}s
              </span>
            )}
          </div>
        );
      }
      if (lifecycleState === 'cancelling') {
        return (
          <div
            style={{
              fontSize: '11px',
              color: 'var(--status-amber)',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} />
            <span>Cancelling...</span>
          </div>
        );
      }
      if (isInitializing || lifecycleState === 'downloading_initializing') {
        return (
          <div
            style={{
              fontSize: '11px',
              color: 'var(--status-amber)',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} />
            <span>
              Initializing On-Device AI... ({Math.round((initProgress?.progress || 0) * 100)}%)
            </span>
          </div>
        );
      }
      if (connectionState === 'unsupported' || lifecycleState === 'unsupported') {
        return (
          <div
            style={{
              fontSize: '11px',
              color: 'var(--status-red)',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            <AlertCircle size={12} />
            <span>WebGPU Unsupported</span>
          </div>
        );
      }
      if (lifecycleState === 'failed') {
        return (
          <div
            style={{
              fontSize: '11px',
              color: 'var(--status-red)',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            <AlertCircle size={12} />
            <span>Initialization Failed</span>
          </div>
        );
      }
      return (
        <div
          style={{
            fontSize: '11px',
            color: 'var(--status-yellow)',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
          }}
        >
          <AlertCircle size={12} />
          <span>{isModelCached ? 'On-Device AI (Cached)' : 'On-Device AI (Setup Required)'}</span>
        </div>
      );
    }

    if (activeProviderId === 'hosted_cloud') {
      if (connectionState === 'connected') {
        return (
          <div
            style={{
              fontSize: '11px',
              color: 'var(--status-green)',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            <span className="brand-pulse-dot" />
            <span>Cloud AI Ready ({selectedModel})</span>
          </div>
        );
      }
      if (connectionState === 'checking') {
        return (
          <div
            style={{
              fontSize: '11px',
              color: 'var(--text-muted)',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} />
            <span>Checking Cloud AI...</span>
          </div>
        );
      }
      return (
        <div
          style={{
            fontSize: '11px',
            color: 'var(--status-amber)',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
          }}
        >
          <AlertCircle size={12} />
          <span>Cloud AI (Setup Required)</span>
        </div>
      );
    }

    switch (connectionState) {
      case 'connected':
        return (
          <div
            style={{
              fontSize: '11px',
              color: 'var(--status-green)',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            <span className="brand-pulse-dot" />
            <span>
              {activeProvider.name} Ready ({selectedModel || 'Connected'})
            </span>
          </div>
        );
      case 'checking':
        return (
          <div
            style={{
              fontSize: '11px',
              color: 'var(--text-muted)',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} />
            <span>Probing {activeProvider.name}...</span>
          </div>
        );
      case 'no_models':
        return (
          <div
            style={{
              fontSize: '11px',
              color: 'var(--status-yellow)',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            <AlertCircle size={12} />
            <span>0 Models in {activeProvider.name}</span>
          </div>
        );
      case 'unsupported':
        return (
          <div
            style={{
              fontSize: '11px',
              color: 'var(--text-muted)',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            <AlertCircle size={12} />
            <span>{activeProvider.name} (Planned Provider)</span>
          </div>
        );
      case 'unavailable':
      default:

        return (
          <div
            style={{
              fontSize: '11px',
              color: 'var(--status-red)',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            <span
              style={{
                width: '7px',
                height: '7px',
                borderRadius: '50%',
                backgroundColor: 'var(--status-red)',
              }}
            />
            <span>{activeProvider.name} Offline</span>
          </div>
        );
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <PlannedFeatureNotice
        phase="Phase 3: Personal Assistant (Step 3.4)"
        title="Provider-Independent AI Architecture"
        description="Kuro's assistant logic is provider-independent. Currently powered by Local Ollama (PC) with streaming responses and safe action confirmations. Architectural foundation ready for future on-device mobile AI."
      />

      {/* Main Container Card */}
      <div
        className="card"
        style={{
          display: 'flex',
          flexDirection: 'column',
          height: '720px',
          padding: 0,
          overflow: 'hidden',
          position: 'relative',
        }}
      >
        {/* Chat Header */}
        <div
          style={{
            padding: '12px 18px',
            borderBottom: '1px solid var(--border-subtle)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            backgroundColor: 'var(--bg-card-subtle)',
            flexWrap: 'wrap',
            gap: '12px',
          }}
        >
          {/* Left Brand & Connection */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <button
              type="button"
              className="reminder-action-btn"
              onClick={() => setShowHistoryPanel((prev) => !prev)}
              title={showHistoryPanel ? 'Hide conversation history' : 'Show conversation history'}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '5px',
                padding: '6px 10px',
                fontSize: '12px',
                backgroundColor: showHistoryPanel ? 'var(--bg-card-hover)' : 'transparent',
              }}
            >
              <History size={14} />
              <span className="hide-mobile">Chats ({conversations.length})</span>
            </button>

            <div className="brand-icon-wrap" style={{ width: '32px', height: '32px' }}>
              <Bot size={17} />
            </div>

            <div>
              <div
                style={{
                  fontSize: '13.5px',
                  fontWeight: 600,
                  color: 'var(--text-primary)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                }}
              >
                <span>{activeConversation?.title || 'Kuro Assistant'}</span>
                <span className="badge badge-primary" style={{ fontSize: '10px' }}>
                  Local LLM
                </span>
              </div>
              {renderConnectionBadge()}
            </div>
          </div>

          {/* Right Controls */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            {/* New Conversation Button */}
            <button
              type="button"
              className="btn btn-secondary"
              onClick={startNewConversation}
              style={{ padding: '6px 12px', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '5px' }}
              title="Start a new separate conversation"
            >
              <Plus size={13} />
              <span>New Chat</span>
            </button>

            {/* AI Provider Selector */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <Layers size={14} style={{ color: 'var(--text-muted)' }} />
              <select
                value={activeProviderId}
                onChange={(e) => selectProvider(e.target.value as AIProviderId)}
                style={{
                  backgroundColor: 'var(--bg-card)',
                  color: 'var(--text-primary)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: 'var(--radius-sm)',
                  padding: '5px 8px',
                  fontSize: '12px',
                  outline: 'none',
                  cursor: 'pointer',
                  maxWidth: '170px',
                }}
                title="Select active AI runtime provider"
              >
                {providers.map((p) => (
                  <option key={p.id} value={p.id} disabled={!p.isImplemented}>
                    {p.name} {!p.isImplemented ? '(Planned)' : ''}
                  </option>
                ))}
              </select>
            </div>

            {/* Model Selector (when supported) */}
            {activeProvider.capabilities.modelDiscovery && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <Cpu size={14} style={{ color: 'var(--text-muted)' }} />
                <select
                  value={selectedModel}
                  onChange={(e) => selectModel(e.target.value)}
                  disabled={models.length === 0 || connectionState !== 'connected'}
                  style={{
                    backgroundColor: 'var(--bg-card)',
                    color: 'var(--text-primary)',
                    border: '1px solid var(--border-subtle)',
                    borderRadius: 'var(--radius-sm)',
                    padding: '5px 8px',
                    fontSize: '12px',
                    outline: 'none',
                    cursor: models.length > 0 ? 'pointer' : 'not-allowed',
                    maxWidth: '170px',
                  }}
                  title={`Select active model for ${activeProvider.name}`}
                >
                  {models.length === 0 ? (
                    <option value="">No models available</option>
                  ) : (
                    models.map((m) => (
                      <option key={m.name} value={m.name}>
                        {m.name} {m.size ? `(${formatModelSize(m.size)})` : ''}
                      </option>
                    ))
                  )}
                </select>
              </div>
            )}

            {/* Refresh Connection Button */}
            <button
              type="button"
              className="reminder-action-btn"
              onClick={refreshConnection}
              title={`Refresh ${activeProvider.name} connection & model list`}
              style={{
                width: '30px',
                height: '30px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <RotateCcw
                size={14}
                style={{
                  animation: connectionState === 'checking' ? 'spin 1s linear infinite' : 'none',
                }}
              />
            </button>
          </div>
        </div>

        {/* On-Device Mobile AI (WebLLM) Setup & Status Card */}
        {activeProviderId === 'on_device_mobile' && (
          <WebLLMSetupPanel
            models={models}
            selectedModel={selectedModel}
            onSelectModel={selectModel}
            isModelLoaded={isModelLoaded}
            isInitializing={isInitializing}
            initProgress={initProgress}
            connectionState={connectionState}
            connectionError={connectionError}
            lifecycleState={lifecycleState}
            isModelCached={isModelCached}
            storageEstimate={storageEstimate}
            onInitialize={initializeOnDeviceModel}
            onCancel={cancelOnDeviceInit}
            onRetry={refreshConnection}
            onDeleteCachedModel={deleteOnDeviceCachedModel}
            onUnloadModel={unloadOnDeviceModel}
            benchmarkTimingMs={benchmarkTimingMs}
            onSwitchToOllama={() => selectProvider('ollama')}
          />
        )}

        {/* Optional Cloud AI Setup Card */}
        {activeProviderId === 'hosted_cloud' && (
          <CloudAISetupPanel
            connectionState={connectionState}
            connectionError={connectionError}
            onRefresh={refreshConnection}
            onSwitchToOllama={() => selectProvider('ollama')}
          />
        )}

        {/* Offline / Setup Recovery Guidance Banner for Ollama */}
        {activeProviderId === 'ollama' && connectionState !== 'connected' && connectionState !== 'checking' && (
          <div
            style={{
              padding: '12px 18px',
              backgroundColor: 'var(--bg-card)',
              borderBottom: '1px solid var(--border-subtle)',
              display: 'flex',
              alignItems: 'flex-start',
              gap: '12px',
            }}
          >
            <div
              style={{
                padding: '6px',
                borderRadius: 'var(--radius-sm)',
                backgroundColor: 'rgba(239, 68, 68, 0.1)',
                color: 'var(--status-red)',
                flexShrink: 0,
              }}
            >
              <AlertCircle size={16} />
            </div>

            <div style={{ flex: 1, fontSize: '12.5px' }}>
              <div style={{ fontWeight: 600, color: 'var(--text-primary)', marginBottom: '3px' }}>
                {connectionState === 'no_models'
                  ? 'Ollama is running, but no models are installed'
                  : 'Ollama is offline or unreachable'}
              </div>
              <p style={{ color: 'var(--text-secondary)', margin: '0 0 6px 0', lineHeight: 1.4 }}>
                {connectionError ||
                  'Kuro communicates with Ollama locally on ' +
                    activeBaseUrl +
                    '. Launch Ollama on your system to activate real AI responses.'}
              </p>

              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  backgroundColor: 'var(--bg-card-subtle)',
                  padding: '6px 10px',
                  borderRadius: 'var(--radius-sm)',
                  border: '1px solid var(--border-subtle)',
                  fontFamily: 'monospace',
                  fontSize: '11.5px',
                  color: 'var(--accent-primary)',
                  marginBottom: '6px',
                  overflowX: 'auto',
                }}
              >
                <Terminal size={13} style={{ flexShrink: 0 }} />
                <span>
                  {connectionState === 'no_models'
                    ? 'ollama run qwen2.5:3b'
                    : 'ollama serve (or set OLLAMA_ORIGINS=http://localhost:5173 && ollama serve)'}
                </span>
              </div>

              {connectionGuidance && (
                <div style={{ fontSize: '11px', color: 'var(--text-muted)', whiteSpace: 'pre-line' }}>
                  {connectionGuidance}
                </div>
              )}
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', flexShrink: 0 }}>
              <button
                type="button"
                className="btn btn-secondary"
                style={{ padding: '6px 12px', fontSize: '12px' }}
                onClick={refreshConnection}
              >
                <RefreshCw size={13} />
                <span>Retry</span>
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                style={{ padding: '4px 8px', fontSize: '10.5px' }}
                onClick={() => selectProvider('on_device_mobile')}
                title="Switch to in-browser WebLLM"
              >
                Use WebLLM
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                style={{ padding: '4px 8px', fontSize: '10.5px' }}
                onClick={() => selectProvider('hosted_cloud')}
                title="Switch to Cloud AI"
              >
                Use Cloud AI
              </button>
            </div>
          </div>
        )}

        {/* Content Body: Split between History Drawer (when open) and Active Chat */}
        <div style={{ flex: 1, display: 'flex', overflow: 'hidden', position: 'relative' }}>
          {/* Conversation History Drawer */}
          {showHistoryPanel && (
            <div
              style={{
                width: '260px',
                borderRight: '1px solid var(--border-subtle)',
                backgroundColor: 'var(--bg-card-subtle)',
                display: 'flex',
                flexDirection: 'column',
                flexShrink: 0,
              }}
            >
              <div
                style={{
                  padding: '12px 14px',
                  borderBottom: '1px solid var(--border-subtle)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  fontSize: '12px',
                  fontWeight: 600,
                  color: 'var(--text-secondary)',
                }}
              >
                <span>Conversations</span>
                <button
                  type="button"
                  className="reminder-action-btn"
                  onClick={() => setShowHistoryPanel(false)}
                  title="Close sidebar"
                >
                  <ChevronLeft size={14} />
                </button>
              </div>

              {/* Conversation List */}
              <div style={{ flex: 1, overflowY: 'auto', padding: '8px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                {conversations.map((conv) => {
                  const isActive = conv.id === activeConversationId;
                  const isEditing = editingConvId === conv.id;

                  return (
                    <div
                      key={conv.id}
                      style={{
                        padding: '8px 10px',
                        borderRadius: 'var(--radius-sm)',
                        backgroundColor: isActive ? 'var(--bg-card)' : 'transparent',
                        border: `1px solid ${isActive ? 'var(--border-subtle)' : 'transparent'}`,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        cursor: 'pointer',
                        gap: '6px',
                      }}
                      onClick={() => !isEditing && selectConversation(conv.id)}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1, minWidth: 0 }}>
                        <MessageSquare
                          size={13}
                          style={{
                            color: isActive ? 'var(--accent-primary)' : 'var(--text-muted)',
                            flexShrink: 0,
                          }}
                        />

                        {isEditing ? (
                          <input
                            type="text"
                            value={editingTitle}
                            onChange={(e) => setEditingTitle(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') handleSaveRename(conv.id);
                              if (e.key === 'Escape') setEditingConvId(null);
                            }}
                            autoFocus
                            onClick={(e) => e.stopPropagation()}
                            style={{
                              fontSize: '12px',
                              padding: '2px 4px',
                              width: '100%',
                              backgroundColor: 'var(--bg-input)',
                              border: '1px solid var(--border-subtle)',
                              borderRadius: 'var(--radius-sm)',
                              color: 'var(--text-primary)',
                            }}
                          />
                        ) : (
                          <div style={{ minWidth: 0, flex: 1 }}>
                            <div
                              style={{
                                fontSize: '12px',
                                fontWeight: isActive ? 600 : 400,
                                color: isActive ? 'var(--text-primary)' : 'var(--text-secondary)',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                              }}
                            >
                              {conv.title}
                            </div>
                            <div style={{ fontSize: '10px', color: 'var(--text-muted)' }}>
                              {conv.messages.length} messages
                            </div>
                          </div>
                        )}
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', gap: '2px', flexShrink: 0 }} onClick={(e) => e.stopPropagation()}>
                        {isEditing ? (
                          <button
                            type="button"
                            className="reminder-action-btn"
                            onClick={() => handleSaveRename(conv.id)}
                            title="Save title"
                          >
                            <Check size={12} style={{ color: 'var(--status-green)' }} />
                          </button>
                        ) : (
                          <>
                            <button
                              type="button"
                              className="reminder-action-btn"
                              onClick={() => handleStartRename(conv.id, conv.title)}
                              title="Rename conversation"
                            >
                              <Edit2 size={11} />
                            </button>
                            <button
                              type="button"
                              className="reminder-action-btn"
                              onClick={() => setConvToDelete(conv.id)}
                              title="Delete conversation"
                              style={{ color: 'var(--status-red)' }}
                            >
                              <Trash2 size={11} />
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* History Footer */}
              <div
                style={{
                  padding: '10px 14px',
                  borderTop: '1px solid var(--border-subtle)',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}
              >
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setShowClearConfirm(true)}
                  style={{
                    padding: '4px 8px',
                    fontSize: '11px',
                    width: '100%',
                    justifyContent: 'center',
                    color: 'var(--status-red)',
                  }}
                  title="Clear all conversation threads"
                >
                  <Trash2 size={12} />
                  <span>Clear All History</span>
                </button>
              </div>
            </div>
          )}

          {/* Active Chat Messages Stream */}
          <div
            style={{
              flex: 1,
              overflowY: 'auto',
              padding: '20px',
              display: 'flex',
              flexDirection: 'column',
              gap: '16px',
            }}
          >
            {messages.map((msg) => {
              const isUser = msg.sender === 'user';
              const isError = msg.status === 'error';

              return (
                <div
                  key={msg.id}
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: '10px',
                    alignSelf: isUser ? 'flex-end' : 'flex-start',
                    maxWidth: '82%',
                  }}
                >
                  {!isUser && (
                    <div
                      style={{
                        width: '32px',
                        height: '32px',
                        borderRadius: '50%',
                        background: isError ? 'rgba(239, 68, 68, 0.15)' : 'var(--accent-bg-subtle)',
                        border: `1px solid ${isError ? 'var(--status-red)' : 'var(--accent-border)'}`,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: isError ? 'var(--status-red)' : 'var(--accent-primary)',
                        flexShrink: 0,
                      }}
                    >
                      {isError ? <AlertCircle size={16} /> : <Bot size={16} />}
                    </div>
                  )}

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', maxWidth: '100%' }}>
                    <div
                      style={{
                        padding: '12px 16px',
                        borderRadius: 'var(--radius-lg)',
                        backgroundColor: isUser
                          ? 'var(--accent-primary)'
                          : isError
                            ? 'rgba(239, 68, 68, 0.08)'
                            : 'var(--bg-card-subtle)',
                        color: isUser ? '#03070d' : 'var(--text-primary)',
                        fontWeight: isUser ? 500 : 400,
                        fontSize: '13.5px',
                        lineHeight: '1.5',
                        border: isUser
                          ? 'none'
                          : `1px solid ${isError ? 'rgba(239, 68, 68, 0.3)' : 'var(--border-subtle)'}`,
                        borderTopRightRadius: isUser ? '2px' : undefined,
                        borderTopLeftRadius: !isUser ? '2px' : undefined,
                        whiteSpace: 'pre-wrap',
                        wordBreak: 'break-word',
                      }}
                    >
                      {msg.status === 'sending' && !msg.text ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <span className="brand-pulse-dot" style={{ animationDuration: '0.8s' }} />
                          <span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
                            {msg.modelUsed || selectedModel || 'Kuro'} is thinking...
                          </span>
                        </div>
                      ) : (
                        <>
                          {msg.text}
                          {msg.status === 'sending' && (
                            <span
                              className="brand-pulse-dot"
                              style={{
                                display: 'inline-block',
                                width: '6px',
                                height: '6px',
                                marginLeft: '5px',
                                verticalAlign: 'baseline',
                                animationDuration: '0.6s',
                              }}
                              title="Streaming response..."
                            />
                          )}
                        </>
                      )}

                      {/* Streaming in-bubble stop button */}
                      {msg.status === 'sending' && (
                        <div style={{ marginTop: '8px', display: 'flex', justifyContent: 'flex-end' }}>
                          <button
                            type="button"
                            className="btn btn-secondary"
                            onClick={cancelRequest}
                            style={{
                              padding: '2px 8px',
                              fontSize: '11px',
                              color: 'var(--status-red)',
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '4px',
                            }}
                            title="Stop generating"
                          >
                            <Square size={10} />
                            <span>Stop</span>
                          </button>
                        </div>
                      )}

                      {/* Assistant Action Proposal Card */}
                      {msg.proposal && (
                        <ActionProposalCard
                          proposal={msg.proposal}
                          onConfirm={(p) => handleConfirmAction(msg.id, p)}
                          onCancel={() => handleCancelAction(msg.id)}
                          isAuthUser={isAuthUser}
                          userEmail={userEmail}
                          onNavigate={onNavigate ? (p) => onNavigate(p) : undefined}
                        />
                      )}

                      {/* Error State Body */}
                      {isError && msg.errorMsg && (
                        <div
                          style={{
                            marginTop: '8px',
                            paddingTop: '8px',
                            borderTop: '1px solid rgba(239, 68, 68, 0.2)',
                            fontSize: '11.5px',
                            color: 'var(--status-red)',
                          }}
                        >
                          <strong>Error:</strong> {msg.errorMsg}
                          {msg.recoveryGuidance && (
                            <div style={{ marginTop: '4px', color: 'var(--text-muted)' }}>
                              {msg.recoveryGuidance}
                            </div>
                          )}
                          <button
                            type="button"
                            className="btn btn-secondary"
                            style={{
                              marginTop: '8px',
                              padding: '4px 10px',
                              fontSize: '11.5px',
                              color: 'var(--text-primary)',
                            }}
                            onClick={retryLastMessage}
                          >
                            <RotateCcw size={12} />
                            <span>Retry Message</span>
                          </button>
                        </div>
                      )}
                    </div>

                    <span
                      style={{
                        fontSize: '10.5px',
                        color: 'var(--text-muted)',
                        alignSelf: isUser ? 'flex-end' : 'flex-start',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                      }}
                    >
                      <span>{msg.timestamp}</span>
                      {msg.modelUsed && (
                        <span
                          style={{
                            padding: '1px 5px',
                            borderRadius: '4px',
                            backgroundColor: 'var(--bg-card-hover)',
                            fontSize: '9.5px',
                          }}
                        >
                          {msg.modelUsed}
                        </span>
                      )}
                    </span>
                  </div>

                  {isUser && (
                    <div
                      style={{
                        width: '32px',
                        height: '32px',
                        borderRadius: '50%',
                        background: 'var(--bg-card-hover)',
                        border: '1px solid var(--border-subtle)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: 'var(--text-secondary)',
                        flexShrink: 0,
                      }}
                    >
                      <User size={16} />
                    </div>
                  )}
                </div>
              );
            })}

            {/* In-Flight Inference Bubble Fallback */}
            {isLoading && !messages.some((m) => m.status === 'sending') && (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: '10px',
                  alignSelf: 'flex-start',
                  maxWidth: '75%',
                }}
              >
                <div
                  style={{
                    width: '32px',
                    height: '32px',
                    borderRadius: '50%',
                    background: 'var(--accent-bg-subtle)',
                    border: '1px solid var(--accent-border)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: 'var(--accent-primary)',
                    flexShrink: 0,
                  }}
                >
                  <Bot size={16} />
                </div>

                <div
                  style={{
                    padding: '12px 16px',
                    borderRadius: 'var(--radius-lg)',
                    backgroundColor: 'var(--bg-card-subtle)',
                    border: '1px solid var(--border-subtle)',
                    borderTopLeftRadius: '2px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '12px',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span className="brand-pulse-dot" style={{ animationDuration: '0.8s' }} />
                    <span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
                      {selectedModel} is thinking...
                    </span>
                  </div>

                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={cancelRequest}
                    style={{
                      padding: '3px 8px',
                      fontSize: '11px',
                      color: 'var(--status-red)',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px',
                    }}
                    title="Cancel active response"
                  >
                    <Square size={11} />
                    <span>Cancel</span>
                  </button>
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>
        </div>

        {/* Quick Command Chips */}
        <div
          style={{
            padding: '8px 18px',
            borderTop: '1px solid var(--border-subtle)',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            overflowX: 'auto',
          }}
        >
          <span style={{ fontSize: '11px', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
            Action Prompts:
          </span>
          {[
            'Schedule a task for tomorrow at 3 PM: ESP32 Pinout Review',
            'Set a reminder to drink water in 1 hour',
            'What is my focus plan for today?',
            'Tips for staying productive during deep work',
          ].map((prompt) => (
            <button
              key={prompt}
              type="button"
              className="expression-btn"
              style={{ whiteSpace: 'nowrap', fontSize: '11px' }}
              onClick={() => handleQuickCommand(prompt)}
            >
              <Sparkles size={11} /> {prompt}
            </button>
          ))}
        </div>

        {/* Input Bar */}
        <form
          onSubmit={handleSendMessage}
          style={{
            padding: '12px 18px',
            borderTop: '1px solid var(--border-subtle)',
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            backgroundColor: 'var(--bg-card)',
          }}
        >
          <input
            type="text"
            placeholder={
              activeProviderId === 'on_device_mobile'
                ? isModelLoaded || lifecycleState === 'ready'
                  ? `Ask ${selectedModel || 'Kuro'} anything (on-device local AI)...`
                  : lifecycleState === 'cancelling'
                  ? 'Cancelling model initialization...'
                  : lifecycleState === 'cancelled'
                  ? 'Initialization cancelled. Click Retry above to resume...'
                  : lifecycleState === 'failed'
                  ? 'Initialization failed. Review error above and retry...'
                  : isInitializing || lifecycleState === 'downloading_initializing'
                  ? 'Model is downloading & initializing (see progress above)...'
                  : connectionState === 'unsupported' || lifecycleState === 'unsupported'
                  ? 'WebGPU unavailable on this device/browser.'
                  : isModelCached
                  ? 'Model cached in browser. Click "Load Cached Model" above...'
                  : 'Download & initialize model above to start chatting...'
                : connectionState === 'connected'
                ? `Ask ${selectedModel || 'Kuro'} anything or ask to create a task/reminder...`
                : 'Ollama is offline. Start Ollama to chat...'
            }
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={activeProviderId === 'on_device_mobile' && !isModelLoaded && lifecycleState !== 'ready'}
            style={{
              flex: 1,
              padding: '10px 14px',
              backgroundColor: 'var(--bg-input)',
              border: '1px solid var(--border-subtle)',
              borderRadius: 'var(--radius-md)',
              color: 'var(--text-primary)',
              fontSize: '13.5px',
              opacity: activeProviderId === 'on_device_mobile' && !isModelLoaded ? 0.7 : 1,
            }}
          />

          <button
            type="button"
            className="header-theme-toggle"
            title="Voice Input (Planned for Phase 4)"
            style={{ cursor: 'not-allowed', opacity: 0.6 }}
          >
            <Mic size={18} />
          </button>

          {isLoading ? (
            <button
              type="button"
              className="btn btn-secondary"
              style={{ padding: '10px 16px', color: 'var(--status-red)' }}
              onClick={cancelRequest}
              title="Stop generating"
            >
              <Square size={14} />
              <span>Stop</span>
            </button>
          ) : (
            <button
              type="submit"
              className="btn btn-primary"
              style={{ padding: '10px 16px' }}
              disabled={
                !inputValue.trim() ||
                (activeProviderId === 'on_device_mobile' && !isModelLoaded)
              }
              title={
                activeProviderId === 'on_device_mobile' && !isModelLoaded
                  ? 'Initialize on-device model first'
                  : 'Send message'
              }
            >
              <Send size={15} />
              <span>Send</span>
            </button>
          )}
        </form>

        {/* Delete Conversation Confirmation Modal */}
        {convToDelete && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              backgroundColor: 'rgba(0, 0, 0, 0.6)',
              backdropFilter: 'blur(3px)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 50,
              padding: '20px',
            }}
          >
            <div
              className="card"
              style={{
                maxWidth: '380px',
                width: '100%',
                padding: '20px',
                boxShadow: 'var(--shadow-lg)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', color: 'var(--status-red)', marginBottom: '8px' }}>
                <Trash2 size={18} />
                <h4 style={{ margin: 0, fontSize: '15px', fontWeight: 600 }}>Delete Conversation?</h4>
              </div>
              <p style={{ fontSize: '12.5px', color: 'var(--text-secondary)', marginBottom: '16px', lineHeight: 1.5 }}>
                Are you sure you want to delete this conversation thread? This action cannot be undone.
              </p>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setConvToDelete(null)}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  style={{ backgroundColor: 'var(--status-red)', borderColor: 'var(--status-red)', color: '#fff' }}
                  onClick={() => {
                    deleteConversation(convToDelete);
                    setConvToDelete(null);
                  }}
                >
                  Delete
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Clear All Confirmation Modal */}
        {showClearConfirm && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              backgroundColor: 'rgba(0, 0, 0, 0.6)',
              backdropFilter: 'blur(3px)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 50,
              padding: '20px',
            }}
          >
            <div
              className="card"
              style={{
                maxWidth: '400px',
                width: '100%',
                padding: '20px',
                boxShadow: 'var(--shadow-lg)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', color: 'var(--status-red)', marginBottom: '8px' }}>
                <AlertCircle size={18} />
                <h4 style={{ margin: 0, fontSize: '15px', fontWeight: 600 }}>Clear All Conversations?</h4>
              </div>
              <p style={{ fontSize: '12.5px', color: 'var(--text-secondary)', marginBottom: '16px', lineHeight: 1.5 }}>
                This will clear all local chat history for this account and start a fresh conversation. Your tasks, reminders, and database records will NOT be deleted.
              </p>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setShowClearConfirm(false)}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  style={{ backgroundColor: 'var(--status-red)', borderColor: 'var(--status-red)', color: '#fff' }}
                  onClick={() => {
                    clearAllConversations();
                    setShowClearConfirm(false);
                    setShowHistoryPanel(false);
                  }}
                >
                  Clear All
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
