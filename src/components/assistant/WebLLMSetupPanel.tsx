import React, { useState } from 'react';
import {
  Smartphone,
  Cpu,
  Download,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  XCircle,
  HardDrive,
  ShieldCheck,
  RotateCcw,
  Trash2,
  PowerOff,
  Database,
  Info,
} from 'lucide-react';
import type { AIModelInfo, AIInitProgress, AIConnectionState, WebLLMLifecycleState } from '../../lib/ai';
import type { StorageProbeResult } from '../../lib/ai/compatibilityProbe';
import { WEBLLM_SUPPORTED_MODELS } from '../../lib/ai/webllmProvider';

interface WebLLMSetupPanelProps {
  models: AIModelInfo[];
  selectedModel: string;
  onSelectModel: (modelName: string) => void;
  isModelLoaded: boolean;
  isInitializing: boolean;
  initProgress: AIInitProgress | null;
  connectionState: AIConnectionState;
  connectionError: string | null;
  lifecycleState?: WebLLMLifecycleState;
  isModelCached?: boolean;
  storageEstimate?: StorageProbeResult | null;
  onInitialize: (modelId?: string) => Promise<void>;
  onCancel: () => void;
  onRetry: () => void;
  onDeleteCachedModel?: (modelId?: string) => Promise<void>;
  onUnloadModel?: () => Promise<void>;
  benchmarkTimingMs?: number | null;
  onSwitchToOllama?: () => void;
}

export const WebLLMSetupPanel: React.FC<WebLLMSetupPanelProps> = ({
  models,
  selectedModel,
  onSelectModel,
  isModelLoaded,
  isInitializing,
  initProgress,
  connectionState,
  connectionError,
  lifecycleState = 'not_initialized',
  isModelCached = false,
  storageEstimate,
  onInitialize,
  onCancel,
  onRetry,
  onDeleteCachedModel,
  onUnloadModel,
  benchmarkTimingMs,
  onSwitchToOllama,
}) => {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isUnloading, setIsUnloading] = useState(false);

  const isUnsupported = connectionState === 'unsupported' || lifecycleState === 'unsupported';
  const isReady = isModelLoaded || lifecycleState === 'ready';
  const isCancelling = lifecycleState === 'cancelling';
  const isCancelled = lifecycleState === 'cancelled';
  const isFailed = lifecycleState === 'failed' || (connectionState === 'error' && !isReady);
  const isChecking = lifecycleState === 'checking_compatibility';

  // Find detailed model specifications from the curated catalog
  const catalogItem = WEBLLM_SUPPORTED_MODELS.find(
    (m) => m.id === selectedModel || m.name === selectedModel
  ) || WEBLLM_SUPPORTED_MODELS[0];

  const modelId = catalogItem.id;
  const downloadSizeMB = catalogItem.downloadSizeMB;
  const vramRequiredMB = catalogItem.vramRequiredMB;

  // Format progress percentage safely
  const progressPercent = Math.min(100, Math.max(0, Math.round((initProgress?.progress || 0) * 100)));

  // Calculate browser storage metrics
  const availableBytes = storageEstimate?.availableBytes;
  const availableMB = availableBytes !== undefined ? Math.round(availableBytes / (1024 * 1024)) : null;
  const isLowStorage = availableMB !== null && availableMB < downloadSizeMB * 1.5;

  const handleDeleteCache = async () => {
    if (!onDeleteCachedModel) return;
    setIsDeleting(true);
    try {
      await onDeleteCachedModel(modelId);
      setConfirmDelete(false);
    } finally {
      setIsDeleting(false);
    }
  };

  const handleUnload = async () => {
    if (!onUnloadModel) return;
    setIsUnloading(true);
    try {
      await onUnloadModel();
    } finally {
      setIsUnloading(false);
    }
  };

  return (
    <div
      style={{
        padding: '16px 20px',
        backgroundColor: 'var(--bg-card)',
        borderBottom: '1px solid var(--border-subtle)',
        display: 'flex',
        flexDirection: 'column',
        gap: '12px',
      }}
    >
      {/* Header Bar */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Smartphone size={18} style={{ color: 'var(--accent-primary)' }} />
          <strong style={{ fontSize: '13.5px', color: 'var(--text-primary)' }}>
            On-Device Mobile AI (WebLLM)
          </strong>
        </div>

        {/* Dynamic Lifecycle Status Badge */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          {isReady ? (
            <span className="badge badge-active" style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              <CheckCircle2 size={11} /> Model Ready
            </span>
          ) : isCancelling ? (
            <span className="badge badge-warning" style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              <Loader2 size={11} style={{ animation: 'spin 1s linear infinite' }} />
              <span>Cancelling...</span>
            </span>
          ) : isCancelled ? (
            <span className="badge badge-neutral" style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              <RotateCcw size={11} /> Cancelled
            </span>
          ) : isInitializing || lifecycleState === 'downloading_initializing' ? (
            <span className="badge badge-warning" style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              <Loader2 size={11} style={{ animation: 'spin 1s linear infinite' }} />
              <span>Loading {progressPercent}%</span>
            </span>
          ) : isChecking ? (
            <span className="badge badge-neutral" style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              <Loader2 size={11} style={{ animation: 'spin 1s linear infinite' }} />
              <span>Checking Hardware</span>
            </span>
          ) : isFailed ? (
            <span className="badge badge-neutral" style={{ display: 'flex', alignItems: 'center', gap: '4px', color: 'var(--status-red)' }}>
              <AlertTriangle size={11} /> Init Failed
            </span>
          ) : isUnsupported ? (
            <span className="badge badge-neutral" style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              <XCircle size={11} /> WebGPU Needed
            </span>
          ) : (
            <span className="badge badge-warning" style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              <Download size={11} /> {isModelCached ? 'Ready to Load' : 'Setup Required'}
            </span>
          )}
        </div>
      </div>

      {/* Main Body per Lifecycle State */}
      {isUnsupported ? (
        /* Unsupported Device / Browser */
        <div
          style={{
            padding: '12px 14px',
            backgroundColor: 'rgba(239, 68, 68, 0.08)',
            border: '1px solid rgba(239, 68, 68, 0.25)',
            borderRadius: 'var(--radius-sm)',
            fontSize: '12.5px',
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--status-red)', fontWeight: 600 }}>
            <AlertTriangle size={15} />
            <span>WebGPU Hardware Acceleration Unavailable</span>
          </div>
          <p style={{ color: 'var(--text-secondary)', margin: 0, lineHeight: 1.45 }}>
            {connectionError ||
              'WebGPU is not supported by your current browser or hardware adapter. On Android, Chrome 121+ is required; on iOS, Safari on iOS 18.2+ with WebGPU enabled is required.'}
          </p>
          {onSwitchToOllama && (
            <button
              type="button"
              className="btn btn-primary"
              onClick={onSwitchToOllama}
              style={{ width: 'fit-content', padding: '6px 12px', fontSize: '12px', marginTop: '4px' }}
            >
              Switch to Local Ollama (PC)
            </button>
          )}
        </div>
      ) : isReady ? (
        /* Ready State: Model loaded in Web Worker */
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '12px 16px',
            backgroundColor: 'rgba(16, 185, 129, 0.08)',
            border: '1px solid rgba(16, 185, 129, 0.25)',
            borderRadius: 'var(--radius-sm)',
            fontSize: '12.5px',
            flexWrap: 'wrap',
            gap: '12px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
            <Cpu size={18} style={{ color: 'var(--status-green)', marginTop: '2px', flexShrink: 0 }} />
            <div>
              <div style={{ fontWeight: 600, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span>{catalogItem.name}</span>
                <span style={{ fontSize: '11px', fontFamily: 'monospace', color: 'var(--text-muted)' }}>
                  ({modelId})
                </span>
              </div>
              <div style={{ fontSize: '11.5px', color: 'var(--text-muted)', marginTop: '2px' }}>
                Inference running locally in Web Worker via WebGPU shaders (~{vramRequiredMB} MB VRAM).
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            {benchmarkTimingMs !== null && benchmarkTimingMs !== undefined && (
              <div
                style={{
                  fontSize: '11px',
                  color: 'var(--text-muted)',
                  backgroundColor: 'var(--bg-card-subtle)',
                  padding: '4px 8px',
                  borderRadius: '4px',
                  border: '1px solid var(--border-subtle)',
                }}
              >
                Last run: <strong style={{ color: 'var(--text-primary)' }}>{(benchmarkTimingMs / 1000).toFixed(1)}s</strong>{' '}
                <span style={{ fontSize: '10px' }}>(device-specific estimate)</span>
              </div>
            )}

            {onUnloadModel && (
              <button
                type="button"
                className="btn btn-secondary"
                onClick={handleUnload}
                disabled={isUnloading}
                style={{ padding: '4px 10px', fontSize: '11.5px', display: 'flex', alignItems: 'center', gap: '4px' }}
                title="Release model from Web Worker and GPU memory"
              >
                <PowerOff size={12} />
                <span>{isUnloading ? 'Unloading...' : 'Unload'}</span>
              </button>
            )}
          </div>
        </div>
      ) : isInitializing || lifecycleState === 'downloading_initializing' || isCancelling ? (
        /* Downloading & Initializing Progress Bar */
        <div
          style={{
            padding: '14px',
            backgroundColor: 'var(--bg-card-subtle)',
            border: '1px solid var(--border-subtle)',
            borderRadius: 'var(--radius-sm)',
            display: 'flex',
            flexDirection: 'column',
            gap: '10px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '12.5px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Loader2 size={14} style={{ animation: 'spin 1s linear infinite', color: 'var(--accent-primary)' }} />
              <strong style={{ color: 'var(--text-primary)' }}>
                {isCancelling ? 'Cancelling Model Initialization...' : 'Downloading & Initializing Model...'}
              </strong>
            </div>
            {!isCancelling && (
              <span style={{ fontWeight: 600, color: 'var(--accent-primary)', fontSize: '13px' }}>
                {progressPercent}%
              </span>
            )}
          </div>

          {/* Progress Bar */}
          <div
            style={{
              width: '100%',
              height: '6px',
              backgroundColor: 'var(--bg-input)',
              borderRadius: '3px',
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                width: isCancelling ? '100%' : `${progressPercent}%`,
                height: '100%',
                backgroundColor: isCancelling ? 'var(--status-amber)' : 'var(--accent-primary)',
                transition: 'width 0.2s ease',
              }}
            />
          </div>

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '11.5px', color: 'var(--text-muted)' }}>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '75%' }}>
              {isCancelling ? 'Terminating worker and freeing allocations...' : initProgress?.text || 'Fetching model weights...'}
            </span>
            {!isCancelling && initProgress?.timeElapsed !== undefined && (
              <span>{Math.round(initProgress.timeElapsed)}s elapsed</span>
            )}
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', paddingTop: '4px' }}>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={onCancel}
              disabled={isCancelling}
              style={{ padding: '4px 10px', fontSize: '11.5px' }}
            >
              {isCancelling ? 'Cancelling...' : 'Cancel Download'}
            </button>
          </div>
        </div>
      ) : isFailed || isCancelled ? (
        /* Failed or Cancelled State with Retry */
        <div
          style={{
            padding: '14px',
            backgroundColor: isFailed ? 'rgba(239, 68, 68, 0.08)' : 'var(--bg-card-subtle)',
            border: `1px solid ${isFailed ? 'rgba(239, 68, 68, 0.25)' : 'var(--border-subtle)'}`,
            borderRadius: 'var(--radius-sm)',
            display: 'flex',
            flexDirection: 'column',
            gap: '10px',
            fontSize: '12.5px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: isFailed ? 'var(--status-red)' : 'var(--text-primary)', fontWeight: 600 }}>
            {isFailed ? <AlertTriangle size={16} /> : <RotateCcw size={16} />}
            <span>{isFailed ? 'Model Initialization Failed' : 'Model Initialization Cancelled'}</span>
          </div>

          <p style={{ color: 'var(--text-secondary)', margin: 0, lineHeight: 1.45 }}>
            {connectionError ||
              (isFailed
                ? 'An error occurred while loading the WebLLM model into the Web Worker. Check network connectivity or device storage.'
                : 'The initialization process was stopped. You can retry whenever you are ready.')}
          </p>

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '8px', paddingTop: '4px' }}>
            <button
              type="button"
              className="btn btn-primary"
              onClick={onRetry}
              style={{ padding: '6px 14px', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '6px' }}
            >
              <RotateCcw size={13} />
              <span>Retry Initialization</span>
            </button>
          </div>
        </div>
      ) : (
        /* Default Not-Initialized State: Consent, Model Selection, Storage & Cache Visibility */
        <div
          style={{
            padding: '14px',
            backgroundColor: 'var(--bg-card-subtle)',
            border: '1px solid var(--border-subtle)',
            borderRadius: 'var(--radius-sm)',
            display: 'flex',
            flexDirection: 'column',
            gap: '12px',
            fontSize: '12.5px',
          }}
        >
          {/* Model Selection and Verified Identifier */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px' }}>
            <div>
              <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
                On-Device Model Selection
              </div>
              <div style={{ fontSize: '11.5px', color: 'var(--text-muted)' }}>
                Verified Identifier: <code style={{ color: 'var(--accent-primary)', fontSize: '11px' }}>{modelId}</code>
              </div>
            </div>

            {models.length > 0 && (
              <select
                value={selectedModel}
                onChange={(e) => onSelectModel(e.target.value)}
                style={{
                  backgroundColor: 'var(--bg-card)',
                  color: 'var(--text-primary)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: 'var(--radius-sm)',
                  padding: '5px 8px',
                  fontSize: '12px',
                  outline: 'none',
                  cursor: 'pointer',
                  maxWidth: '240px',
                }}
              >
                {models.map((m) => (
                  <option key={m.id || m.name} value={m.id || m.name}>
                    {m.name}
                  </option>
                ))}
              </select>
            )}
          </div>

          {/* Model Footprint and Cache Status */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '8px 12px',
              backgroundColor: 'var(--bg-card)',
              borderRadius: 'var(--radius-sm)',
              border: '1px solid var(--border-subtle)',
              fontSize: '11.5px',
              flexWrap: 'wrap',
              gap: '8px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <Database size={13} style={{ color: 'var(--text-muted)' }} />
              <span>
                Download Size: <strong>~{downloadSizeMB} MB</strong> | Est. VRAM: <strong>~{vramRequiredMB} MB</strong>
              </span>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              {isModelCached ? (
                <span
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px',
                    color: 'var(--status-green)',
                    fontWeight: 600,
                  }}
                >
                  <CheckCircle2 size={12} /> Cached in Browser
                </span>
              ) : (
                <span style={{ color: 'var(--text-muted)' }}>
                  Download required on first use
                </span>
              )}

              {/* Cache Management: Delete Cache Button */}
              {isModelCached && onDeleteCachedModel && (
                confirmDelete ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={() => setConfirmDelete(false)}
                      style={{ padding: '2px 6px', fontSize: '10.5px' }}
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={handleDeleteCache}
                      disabled={isDeleting}
                      style={{ padding: '2px 6px', fontSize: '10.5px', color: 'var(--status-red)' }}
                    >
                      {isDeleting ? 'Deleting...' : 'Confirm Delete'}
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => setConfirmDelete(true)}
                    style={{ padding: '2px 8px', fontSize: '10.5px', display: 'flex', alignItems: 'center', gap: '3px' }}
                    title="Delete model weights from browser storage"
                  >
                    <Trash2 size={11} />
                    <span>Clear Cache</span>
                  </button>
                )
              )}
            </div>
          </div>

          {/* Storage Estimate & Safety Warning */}
          {availableMB !== null && (
            <div
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: '8px',
                fontSize: '11.5px',
                padding: '8px 12px',
                borderRadius: 'var(--radius-sm)',
                backgroundColor: isLowStorage ? 'rgba(245, 158, 11, 0.1)' : 'var(--bg-card)',
                border: `1px solid ${isLowStorage ? 'rgba(245, 158, 11, 0.3)' : 'var(--border-subtle)'}`,
                color: isLowStorage ? 'var(--status-amber)' : 'var(--text-secondary)',
              }}
            >
              {isLowStorage ? <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: '2px' }} /> : <Info size={14} style={{ flexShrink: 0, marginTop: '2px' }} />}
              <div>
                <strong>Browser Storage Quota:</strong> ~{availableMB} MB available.
                {isLowStorage && (
                  <span>
                    {' '}Warning: Available browser quota is below the recommended {(downloadSizeMB * 1.5).toFixed(0)} MB buffer. Mobile OS may evict cache under pressure.
                  </span>
                )}
              </div>
            </div>
          )}

          {/* Privacy & Cache Eviction Guarantees */}
          <div style={{ display: 'flex', gap: '8px', fontSize: '11.5px', color: 'var(--text-muted)', lineHeight: '1.45' }}>
            <ShieldCheck size={14} style={{ color: 'var(--status-green)', flexShrink: 0, marginTop: '2px' }} />
            <div>
              <strong>100% Client-Side Privacy:</strong> Inference runs entirely in-browser. Prompts and responses never touch external servers or cloud AI.
            </div>
          </div>

          <div style={{ display: 'flex', gap: '8px', fontSize: '11.5px', color: 'var(--text-muted)', lineHeight: '1.45' }}>
            <HardDrive size={14} style={{ color: 'var(--status-amber)', flexShrink: 0, marginTop: '2px' }} />
            <div>
              <strong>Cache Eviction Notice:</strong> Browser storage quota is an estimate and does not equal physical disk space. Mobile operating systems may evict cached model weights if device storage runs low.
            </div>
          </div>

          {/* Explicit User Action Trigger */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', paddingTop: '4px' }}>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => void onInitialize(modelId)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                padding: '7px 14px',
                fontSize: '12.5px',
              }}
            >
              <Download size={14} />
              <span>
                {isModelCached
                  ? `Load Cached Model (~${downloadSizeMB} MB)`
                  : `Download & Initialize Model (~${downloadSizeMB} MB)`}
              </span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
