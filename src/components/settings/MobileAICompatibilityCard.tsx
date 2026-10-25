import React, { useState, useEffect, useCallback } from 'react';
import {
  Smartphone,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  RefreshCw,
  HardDrive,
  ShieldCheck,
  Sparkles,
  Info,
  Lock,
  Loader2,
} from 'lucide-react';
import {
  runMobileAICompatibilityProbe,
  requestPersistentStoragePermission,
  type CompatibilityReport,
} from '../../lib/ai/compatibilityProbe';

export const MobileAICompatibilityCard: React.FC = () => {
  const [report, setReport] = useState<CompatibilityReport | null>(null);
  const [isChecking, setIsChecking] = useState(false);
  const [persisting, setPersisting] = useState(false);
  const [persistMessage, setPersistMessage] = useState<string | null>(null);

  const handleRunProbe = useCallback(async () => {
    setIsChecking(true);
    setPersistMessage(null);
    try {
      const res = await runMobileAICompatibilityProbe();
      setReport(res);
    } catch (err) {
      console.error('[Kuro Compatibility Probe] Error during check:', err);
    } finally {
      setIsChecking(false);
    }
  }, []);

  // Run initial probe automatically on component mount
  useEffect(() => {
    let isMounted = true;
    queueMicrotask(() => {
      if (isMounted) {
        void handleRunProbe();
      }
    });
    return () => {
      isMounted = false;
    };
  }, [handleRunProbe]);


  const handleRequestPersistence = async () => {
    setPersisting(true);
    setPersistMessage(null);
    try {
      const granted = await requestPersistentStoragePermission();
      if (granted) {
        setPersistMessage('Persistent storage granted. Model files will be protected from browser auto-cleanup.');
      } else {
        setPersistMessage('Persistent storage was not granted by the browser (often requires bookmarking or PWA installation).');
      }
      // Refresh storage section
      const updated = await runMobileAICompatibilityProbe();
      setReport(updated);
    } catch (err) {
      console.error('[Kuro Persistence] Error requesting storage permission:', err);
      setPersistMessage('Failed to request persistence permission.');
    } finally {
      setPersisting(false);
    }
  };

  const formatBytes = (bytes?: number): string => {
    if (bytes === undefined || bytes === null || isNaN(bytes)) return 'Unavailable';
    if (bytes === 0) return '0 MB';
    const mb = bytes / (1024 * 1024);
    if (mb >= 1024) {
      return `${(mb / 1024).toFixed(1)} GB`;
    }
    return `${mb.toFixed(0)} MB`;
  };

  return (
    <div className="card" style={{ border: '1px solid var(--border-subtle)' }}>
      {/* Card Header */}
      <div className="card-header">
        <div className="card-title-group">
          <Smartphone className="card-icon" style={{ color: 'var(--accent-primary)' }} />
          <div>
            <h3 className="card-title">Mobile &amp; On-Device AI Compatibility</h3>
            <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: 0 }}>
              Assess client-side hardware and browser readiness for local AI inference
            </p>
          </div>
        </div>

        {report && (
          <span
            className={`badge ${
              report.canAttemptWebGPUInference
                ? 'badge-active'
                : report.webGpu.apiPresent
                ? 'badge-warning'
                : 'badge-neutral'
            }`}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}
          >
            {report.canAttemptWebGPUInference ? (
              <>
                <CheckCircle2 size={11} />
                <span>WebGPU Capable</span>
              </>
            ) : report.webGpu.apiPresent ? (
              <>
                <AlertTriangle size={11} />
                <span>Adapter Needed</span>
              </>
            ) : (
              <>
                <Info size={11} />
                <span>WebGPU Absent</span>
              </>
            )}
          </span>
        )}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', fontSize: '13px' }}>
        {/* Trigger / Status Banner */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '10px 12px',
            backgroundColor: 'var(--bg-card-subtle)',
            borderRadius: 'var(--radius-sm)',
            border: '1px solid var(--border-subtle)',
          }}
        >
          <div>
            <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
              Client Diagnostic Probe
            </div>
            <div style={{ fontSize: '11.5px', color: 'var(--text-muted)' }}>
              {isChecking
                ? 'Probing browser GPU, WebAssembly, and storage quotas...'
                : report
                ? `Last evaluated: ${new Date(report.timestamp).toLocaleTimeString()}`
                : 'Run check to assess this device for local AI'}
            </div>
          </div>

          <button
            type="button"
            className="btn btn-secondary"
            onClick={handleRunProbe}
            disabled={isChecking}
            style={{
              padding: '6px 12px',
              fontSize: '12px',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            {isChecking ? (
              <>
                <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} />
                <span>Probing...</span>
              </>
            ) : (
              <>
                <RefreshCw size={13} />
                <span>{report ? 'Re-run Diagnostic' : 'Run Compatibility Check'}</span>
              </>
            )}
          </button>
        </div>

        {report && (
          <>
            {/* System Environment Summary */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
                gap: '8px',
                padding: '10px',
                backgroundColor: 'rgba(255, 255, 255, 0.02)',
                border: '1px solid var(--border-subtle)',
                borderRadius: 'var(--radius-sm)',
                fontSize: '12px',
              }}
            >
              <div>
                <span style={{ color: 'var(--text-muted)', fontSize: '11px', display: 'block' }}>Detected OS</span>
                <strong style={{ color: 'var(--text-primary)' }}>{report.environment.os}</strong>
              </div>
              <div>
                <span style={{ color: 'var(--text-muted)', fontSize: '11px', display: 'block' }}>Browser</span>
                <strong style={{ color: 'var(--text-primary)' }}>{report.environment.browser}</strong>
              </div>
              <div>
                <span style={{ color: 'var(--text-muted)', fontSize: '11px', display: 'block' }}>Context Security</span>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '3px' }}>
                  {report.environment.isSecureContext ? (
                    <span style={{ color: 'var(--status-green)' }}>HTTPS / Localhost</span>
                  ) : (
                    <span style={{ color: 'var(--status-red)' }}>Insecure Context</span>
                  )}
                </span>
              </div>
              <div>
                <span style={{ color: 'var(--text-muted)', fontSize: '11px', display: 'block' }}>Device Form</span>
                <span style={{ color: 'var(--text-primary)' }}>
                  {report.environment.isMobileDevice ? 'Mobile Device' : 'Desktop / PC'}
                </span>
              </div>
            </div>

            {/* Core Capability Matrix */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)' }}>
                Hardware &amp; API Readiness
              </div>

              {/* WebGPU Status */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '8px 10px',
                  backgroundColor: 'var(--bg-card-subtle)',
                  borderRadius: 'var(--radius-sm)',
                }}
              >
                <div>
                  <div style={{ fontWeight: 500, color: 'var(--text-primary)' }}>WebGPU Engine</div>
                  <div style={{ fontSize: '11.5px', color: 'var(--text-muted)' }}>
                    {report.webGpu.adapterAvailable
                      ? report.webGpu.architectureDetails || 'GPU Hardware Adapter Initialized'
                      : report.webGpu.apiPresent
                      ? 'API present, but no compatible GPU adapter found'
                      : report.webGpu.error || 'Not supported in this browser version'}
                  </div>
                </div>

                {report.webGpu.adapterAvailable ? (
                  <span className="badge badge-active" style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <CheckCircle2 size={11} /> Supported
                  </span>
                ) : (
                  <span className="badge badge-neutral" style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <XCircle size={11} /> Unavailable
                  </span>
                )}
              </div>

              {/* WebAssembly Status */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '8px 10px',
                  backgroundColor: 'var(--bg-card-subtle)',
                  borderRadius: 'var(--radius-sm)',
                }}
              >
                <div>
                  <div style={{ fontWeight: 500, color: 'var(--text-primary)' }}>WebAssembly (WASM)</div>
                  <div style={{ fontSize: '11.5px', color: 'var(--text-muted)' }}>
                    {report.webAssembly
                      ? 'High-speed WASM execution ready'
                      : 'WebAssembly engine not available'}
                  </div>
                </div>

                {report.webAssembly ? (
                  <span className="badge badge-active" style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <CheckCircle2 size={11} /> Ready
                  </span>
                ) : (
                  <span className="badge badge-warning" style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <XCircle size={11} /> Absent
                  </span>
                )}
              </div>

              {/* Storage Quota & Persistence */}
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '6px',
                  padding: '10px',
                  backgroundColor: 'var(--bg-card-subtle)',
                  borderRadius: 'var(--radius-sm)',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <HardDrive size={13} style={{ color: 'var(--text-muted)' }} />
                    <span style={{ fontWeight: 500, color: 'var(--text-primary)' }}>Browser Storage Allocation</span>
                  </div>
                  <span className="badge badge-neutral">
                    {formatBytes(report.storage.availableBytes)} Available
                  </span>
                </div>

                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(3, 1fr)',
                    gap: '6px',
                    fontSize: '11.5px',
                    color: 'var(--text-muted)',
                    paddingTop: '4px',
                  }}
                >
                  <div>
                    Quota: <span style={{ color: 'var(--text-primary)' }}>{formatBytes(report.storage.quotaBytes)}</span>
                  </div>
                  <div>
                    Used: <span style={{ color: 'var(--text-primary)' }}>{formatBytes(report.storage.usageBytes)}</span>
                  </div>
                  <div>
                    Free: <span style={{ color: 'var(--text-primary)' }}>{formatBytes(report.storage.availableBytes)}</span>
                  </div>
                </div>

                {/* Persistent Storage State */}
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    paddingTop: '6px',
                    marginTop: '4px',
                    borderTop: '1px solid var(--border-subtle)',
                  }}
                >
                  <div>
                    <span style={{ fontSize: '11.5px', color: 'var(--text-primary)', fontWeight: 500 }}>
                      Persistent Storage:
                    </span>{' '}
                    <span style={{ fontSize: '11.5px', color: report.storage.isPersistent ? 'var(--status-green)' : 'var(--text-muted)' }}>
                      {report.storage.isPersistent
                        ? 'Granted (Protected from cache eviction)'
                        : 'Not yet granted (May be cleared under low disk space)'}
                    </span>
                  </div>

                  {!report.storage.isPersistent && (
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={handleRequestPersistence}
                      disabled={persisting}
                      style={{ padding: '3px 8px', fontSize: '11px', display: 'flex', alignItems: 'center', gap: '4px' }}
                      title="Request browser permission to retain downloaded model weights permanently"
                    >
                      {persisting ? (
                        <Loader2 size={10} style={{ animation: 'spin 1s linear infinite' }} />
                      ) : (
                        <Lock size={10} />
                      )}
                      <span>Request Persistence</span>
                    </button>
                  )}
                </div>

                {persistMessage && (
                  <div style={{ fontSize: '11px', color: 'var(--status-yellow)', marginTop: '2px' }}>
                    {persistMessage}
                  </div>
                )}
              </div>
            </div>

            {/* Provisional Model Tier Recommendation */}
            <div
              style={{
                padding: '12px',
                borderRadius: 'var(--radius-sm)',
                backgroundColor:
                  report.recommendedTier !== 'none'
                    ? 'rgba(16, 185, 129, 0.08)'
                    : 'rgba(239, 68, 68, 0.08)',
                border: `1px solid ${
                  report.recommendedTier !== 'none'
                    ? 'rgba(16, 185, 129, 0.25)'
                    : 'rgba(239, 68, 68, 0.25)'
                }`,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '6px' }}>
                <Sparkles
                  size={14}
                  style={{
                    color:
                      report.recommendedTier !== 'none'
                        ? 'var(--status-green)'
                        : 'var(--status-amber)',
                  }}
                />
                <strong style={{ fontSize: '13px', color: 'var(--text-primary)' }}>
                  {report.recommendedTier === 'lower_resource_0_5b'
                    ? 'Provisional Recommendation: Lower-Resource Tier (0.5B)'
                    : report.recommendedTier === 'higher_resource_1_5b'
                    ? 'Provisional Recommendation: Higher-Resource Tier (1.5B)'
                    : 'Provisional Recommendation: WebGPU Not Supported on this Browser'}
                </strong>
              </div>

              <p style={{ fontSize: '12px', color: 'var(--text-secondary)', margin: '0 0 8px 0', lineHeight: '1.5' }}>
                {report.tierRationale}
              </p>

              <div
                style={{
                  display: 'flex',
                  gap: '8px',
                  flexWrap: 'wrap',
                  fontSize: '11px',
                  color: 'var(--text-muted)',
                }}
              >
                <div style={{ padding: '3px 8px', background: 'var(--bg-input)', borderRadius: '4px' }}>
                  Tier 1: Qwen 2.5 0.5B (~380 MB 4-bit, ~600 MB RAM)
                </div>
                <div style={{ padding: '3px 8px', background: 'var(--bg-input)', borderRadius: '4px' }}>
                  Tier 2: Qwen 2.5 1.5B (~980 MB 4-bit, ~1.3 GB RAM)
                </div>
              </div>
            </div>

            {/* Clear Limitations & Privacy Notice */}
            <div
              style={{
                display: 'flex',
                gap: '8px',
                padding: '10px',
                backgroundColor: 'rgba(255, 255, 255, 0.02)',
                border: '1px solid var(--border-subtle)',
                borderRadius: 'var(--radius-sm)',
                fontSize: '11.5px',
                color: 'var(--text-muted)',
                lineHeight: '1.45',
              }}
            >
              <ShieldCheck size={16} style={{ color: 'var(--status-green)', flexShrink: 0, marginTop: '1px' }} />
              <div>
                <strong style={{ color: 'var(--text-secondary)' }}>Privacy &amp; Diagnostic Scope:</strong>
                <div>
                  All checks run 100% locally in your browser. Zero device diagnostics are sent over the network.
                </div>
                <div style={{ marginTop: '4px' }}>
                  {report.limitationsNotice}
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
};
