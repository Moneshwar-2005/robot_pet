import React, { useState, useCallback } from 'react';
import {
  Monitor,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  PowerOff,
  RotateCcw,
  Key,
  ShieldCheck,
  Terminal,
  Info,
  Lock,
  Play,
  Square,
  Clock,
  Folder,
  Trash2,
  Check,
  BookmarkPlus,
  Activity,
} from 'lucide-react';
import { useDesktopCompanion } from '../../hooks/useDesktopCompanion';
import { useWorkSessions } from '../../hooks/useWorkSessions';
import type { CompanionIdeSession } from '../../lib/companion/types';

function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  if (mins === 0) return `${secs}s`;
  return `${mins}m ${secs}s`;
}

export const DesktopCompanionCard: React.FC = () => {
  const {
    connectionState,
    status,
    errorMessage,
    isPairing,
    refreshStatus,
    pair,
    disconnect,
    shutdown,
    // Step 4.2 Tracking
    isTracking,
    activeSession,
    recentSessions,
    isTrackingBusy,
    startTracking,
    stopTracking,
    clearHistory,
  } = useDesktopCompanion();

  const { recordSession } = useWorkSessions();

  const [inputToken, setInputToken] = useState('');
  const [isShuttingDown, setIsShuttingDown] = useState(false);
  const [savedSessionIds, setSavedSessionIds] = useState<Set<string>>(() => {
    try {
      const stored = localStorage.getItem('kuro_saved_companion_session_ids');
      if (stored) return new Set(JSON.parse(stored));
    } catch {
      // ignore
    }
    return new Set();
  });
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

  const isConnected = connectionState === 'running_paired';
  const isUnpaired = connectionState === 'running_unpaired';
  const isChecking = connectionState === 'checking';
  const isOffline = connectionState === 'not_running';

  const handlePairSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputToken.trim()) return;
    await pair(inputToken.trim());
    setInputToken('');
  };

  const handleShutdown = async () => {
    if (!window.confirm('Are you sure you want to shut down the Kuro Desktop Companion service?')) {
      return;
    }
    setIsShuttingDown(true);
    await shutdown();
    setIsShuttingDown(false);
  };

  const handleSaveToWorkSessions = useCallback(
    async (session: CompanionIdeSession) => {
      // Prevent duplicate saves
      if (savedSessionIds.has(session.id)) {
        return;
      }

      const title = `${session.ideName}: ${session.project || 'General Workspace'}`;
      const durationMinutes = Math.max(1, Math.round(session.durationSeconds / 60));
      const completedTime = session.endedAt || session.lastSeenAt || session.startedAt;
      const success = await recordSession({
        title,
        sessionType: 'focus',
        durationMinutes,
        startedAt: session.startedAt,
        completedAt: completedTime,
      });

      if (success) {
        setSavedSessionIds((prev) => {
          const next = new Set(prev).add(session.id);
          try {
            localStorage.setItem('kuro_saved_companion_session_ids', JSON.stringify(Array.from(next)));
          } catch {
            // ignore
          }
          return next;
        });
        setSaveMessage(`Recorded "${title}" (${durationMinutes}m) into Kuro Work Sessions!`);
        setTimeout(() => setSaveMessage(null), 4000);
      }
    },
    [recordSession, savedSessionIds]
  );

  return (
    <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      {/* Header */}
      <div className="card-header">
        <div className="card-title-group">
          <Monitor className="card-icon" style={{ color: 'var(--accent-primary)' }} />
          <div>
            <h3 className="card-title">Windows Desktop Companion</h3>
            <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: 0 }}>
              Local bridge for privacy-respecting IDE work session detection
            </p>
          </div>
        </div>

        {/* Status Badge */}
        {isChecking && (
          <span className="badge badge-neutral" style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
            <Loader2 size={11} style={{ animation: 'spin 1s linear infinite' }} />
            <span>Checking...</span>
          </span>
        )}
        {isOffline && (
          <span className="badge badge-warning" style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
            <PowerOff size={11} />
            <span>Offline</span>
          </span>
        )}
        {isUnpaired && (
          <span className="badge badge-warning" style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
            <Key size={11} />
            <span>Pairing Required</span>
          </span>
        )}
        {isConnected && (
          <span className="badge badge-active" style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
            <CheckCircle2 size={11} />
            <span>Running &amp; Paired</span>
          </span>
        )}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
        {/* Step 4.2 Security Notice */}
        <div
          style={{
            padding: '10px 14px',
            backgroundColor: 'var(--bg-card-subtle)',
            border: '1px solid var(--border-subtle)',
            borderRadius: 'var(--radius-sm)',
            fontSize: '12px',
            lineHeight: '1.45',
            color: 'var(--text-secondary)',
            display: 'flex',
            alignItems: 'flex-start',
            gap: '8px',
          }}
        >
          <Info size={15} style={{ color: 'var(--accent-primary)', flexShrink: 0, marginTop: '2px' }} />
          <div>
            <strong>Privacy-Respecting IDE Detection:</strong> Operates strictly via loopback (<code>127.0.0.1:48299 / 48199</code>).
            <div style={{ marginTop: '2px', color: 'var(--text-muted)' }}>
              Tracking is opt-in and disabled by default. When enabled, it only reads coarse IDE process presence and safe window workspace titles. Zero keystrokes, clipboard, screenshots, or code files are ever collected.
            </div>
          </div>
        </div>

        {/* State 1: Running & Paired */}
        {isConnected && status && (
          <div
            style={{
              padding: '12px 14px',
              backgroundColor: 'rgba(16, 185, 129, 0.08)',
              border: '1px solid rgba(16, 185, 129, 0.25)',
              borderRadius: 'var(--radius-sm)',
              display: 'flex',
              flexDirection: 'column',
              gap: '12px',
              fontSize: '12.5px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <CheckCircle2 size={16} style={{ color: 'var(--status-green)' }} />
                <strong style={{ color: 'var(--text-primary)' }}>Companion Connected &amp; Authorized</strong>
              </div>
              <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontFamily: 'monospace' }}>
                Uptime: {status.uptimeSeconds}s | v{status.version}
              </span>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '8px', fontSize: '11.5px' }}>
              <div style={{ backgroundColor: 'var(--bg-card)', padding: '6px 10px', borderRadius: '4px', border: '1px solid var(--border-subtle)' }}>
                <span style={{ color: 'var(--text-muted)' }}>Loopback Host:</span>{' '}
                <strong style={{ color: 'var(--text-primary)' }}>127.0.0.1:{status.port || '48299'}</strong>
              </div>
              <div style={{ backgroundColor: 'var(--bg-card)', padding: '6px 10px', borderRadius: '4px', border: '1px solid var(--border-subtle)' }}>
                <span style={{ color: 'var(--text-muted)' }}>IDE Detection:</span>{' '}
                <strong style={{ color: isTracking ? 'var(--status-green)' : 'var(--text-muted)' }}>
                  {isTracking ? 'Active (Polling 5s)' : 'Inactive (Opt-In)'}
                </strong>
              </div>
            </div>

            {/* Tracking Controls & Live IDE Status */}
            <div
              style={{
                backgroundColor: 'var(--bg-card)',
                padding: '12px',
                borderRadius: 'var(--radius-sm)',
                border: '1px solid var(--border-subtle)',
                display: 'flex',
                flexDirection: 'column',
                gap: '10px',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <Activity size={15} style={{ color: isTracking ? 'var(--status-green)' : 'var(--text-muted)' }} />
                  <strong style={{ fontSize: '13px', color: 'var(--text-primary)' }}>IDE Activity Tracking</strong>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  {isTracking ? (
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={() => void stopTracking()}
                      disabled={isTrackingBusy}
                      style={{
                        padding: '4px 10px',
                        fontSize: '11.5px',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '5px',
                        color: 'var(--status-yellow)',
                      }}
                    >
                      <Square size={12} />
                      <span>{isTrackingBusy ? 'Stopping...' : 'Stop Tracking'}</span>
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={() => void startTracking()}
                      disabled={isTrackingBusy}
                      style={{
                        padding: '4px 10px',
                        fontSize: '11.5px',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '5px',
                      }}
                    >
                      <Play size={12} />
                      <span>{isTrackingBusy ? 'Starting...' : 'Start Tracking'}</span>
                    </button>
                  )}
                </div>
              </div>

              {/* Live Active IDE Indicator */}
              {isTracking && (
                <div
                  style={{
                    padding: '8px 10px',
                    backgroundColor: activeSession ? 'rgba(16, 185, 129, 0.06)' : 'var(--bg-card-subtle)',
                    borderRadius: '4px',
                    border: `1px solid ${activeSession ? 'rgba(16, 185, 129, 0.2)' : 'var(--border-subtle)'}`,
                    fontSize: '12px',
                  }}
                >
                  {activeSession ? (
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span
                          style={{
                            width: '8px',
                            height: '8px',
                            borderRadius: '50%',
                            backgroundColor: 'var(--status-green)',
                            display: 'inline-block',
                          }}
                        />
                        <strong style={{ color: 'var(--text-primary)' }}>{activeSession.ideName}</strong>
                        {activeSession.project ? (
                          <span style={{ display: 'flex', alignItems: 'center', gap: '3px', color: 'var(--accent-primary)' }}>
                            <Folder size={12} />
                            <span>{activeSession.project}</span>
                          </span>
                        ) : (
                          <span style={{ color: 'var(--text-muted)', fontSize: '11px' }}>(No project in title)</span>
                        )}
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', gap: '4px', color: 'var(--text-secondary)', fontFamily: 'monospace' }}>
                        <Clock size={12} />
                        <span>{formatDuration(activeSession.durationSeconds)}</span>
                      </div>
                    </div>
                  ) : (
                    <div style={{ color: 'var(--text-muted)', fontStyle: 'italic', fontSize: '11.5px' }}>
                      Tracking active: Waiting for supported IDE window (Antigravity IDE, VS Code, Visual Studio, Cursor)...
                    </div>
                  )}
                </div>
              )}

              {/* Supported IDEs Note */}
              <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                <strong>Supported Environments:</strong> Antigravity IDE, Visual Studio Code, Visual Studio, Cursor, IntelliJ IDEA, PyCharm, WebStorm, Sublime Text.
              </div>
            </div>

            {/* Notification message */}
            {saveMessage && (
              <div
                style={{
                  padding: '6px 10px',
                  backgroundColor: 'rgba(16, 185, 129, 0.12)',
                  border: '1px solid var(--status-green)',
                  borderRadius: '4px',
                  fontSize: '11.5px',
                  color: 'var(--status-green)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                }}
              >
                <Check size={13} />
                <span>{saveMessage}</span>
              </div>
            )}

            {/* Recent Detected Activity Sessions */}
            {recentSessions.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <strong style={{ fontSize: '12px', color: 'var(--text-primary)' }}>
                    Recent Detected Sessions ({recentSessions.length})
                  </strong>
                  <button
                    type="button"
                    onClick={() => void clearHistory()}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: 'var(--text-muted)',
                      fontSize: '11px',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '3px',
                      padding: 0,
                    }}
                    title="Clear session history"
                  >
                    <Trash2 size={11} /> Clear History
                  </button>
                </div>

                <div
                  style={{
                    maxHeight: '160px',
                    overflowY: 'auto',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '4px',
                  }}
                >
                  {recentSessions.slice(0, 10).map((sess) => {
                    const isSaved = savedSessionIds.has(sess.id);
                    return (
                      <div
                        key={sess.id}
                        style={{
                          backgroundColor: 'var(--bg-card)',
                          padding: '6px 8px',
                          borderRadius: '4px',
                          border: '1px solid var(--border-subtle)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          gap: '6px',
                          fontSize: '11.5px',
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', overflow: 'hidden' }}>
                          <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{sess.ideName}</span>
                          <span style={{ color: 'var(--text-muted)' }}>&bull;</span>
                          <span style={{ color: sess.project ? 'var(--accent-primary)' : 'var(--text-muted)', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>
                            {sess.project || 'General'}
                          </span>
                        </div>

                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
                          <span style={{ fontFamily: 'monospace', color: 'var(--text-secondary)' }}>
                            {formatDuration(sess.durationSeconds)}
                          </span>
                          <button
                            type="button"
                            className="btn btn-secondary"
                            onClick={() => void handleSaveToWorkSessions(sess)}
                            disabled={isSaved}
                            style={{
                              padding: '2px 6px',
                              fontSize: '10.5px',
                              display: 'flex',
                              alignItems: 'center',
                              gap: '3px',
                              color: isSaved ? 'var(--status-green)' : 'var(--text-secondary)',
                            }}
                            title="Save session into Kuro Work Sessions log"
                          >
                            {isSaved ? <Check size={10} /> : <BookmarkPlus size={10} />}
                            <span>{isSaved ? 'Saved' : 'Save'}</span>
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Disconnect and Shutdown controls */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '8px', paddingTop: '4px' }}>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={disconnect}
                style={{ padding: '4px 10px', fontSize: '11.5px' }}
                title="Disconnect pairing token from this browser"
              >
                Disconnect
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={handleShutdown}
                disabled={isShuttingDown}
                style={{ padding: '4px 10px', fontSize: '11.5px', color: 'var(--status-red)' }}
                title="Send shutdown command to companion process"
              >
                {isShuttingDown ? 'Stopping...' : 'Stop Companion'}
              </button>
            </div>
          </div>
        )}

        {/* State 2: Running but Unpaired */}
        {isUnpaired && (
          <div
            style={{
              padding: '12px 14px',
              backgroundColor: 'rgba(234, 179, 8, 0.08)',
              border: '1px solid rgba(234, 179, 8, 0.3)',
              borderRadius: 'var(--radius-sm)',
              display: 'flex',
              flexDirection: 'column',
              gap: '10px',
              fontSize: '12.5px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <AlertTriangle size={16} style={{ color: 'var(--status-yellow)' }} />
              <strong style={{ color: 'var(--text-primary)' }}>Companion Detected — Pairing Required</strong>
            </div>
            <p style={{ margin: 0, fontSize: '12px', color: 'var(--text-muted)', lineHeight: '1.4' }}>
              The companion is active on loopback. Enter the 6-digit Pairing PIN or 32-character token displayed in the console or saved in <code>companion\.session_pin</code>.
            </p>

            <form onSubmit={handlePairSubmit} style={{ display: 'flex', gap: '8px', marginTop: '4px' }}>
              <div style={{ position: 'relative', flex: 1 }}>
                <Key
                  size={14}
                  style={{
                    position: 'absolute',
                    left: '10px',
                    top: '50%',
                    transform: 'translateY(-50%)',
                    color: 'var(--text-muted)',
                  }}
                />
                <input
                  type="password"
                  value={inputToken}
                  onChange={(e) => setInputToken(e.target.value)}
                  placeholder="Enter 6-digit PIN or 32-character token..."
                  className="input"
                  style={{
                    width: '100%',
                    paddingLeft: '32px',
                    fontSize: '12px',
                    fontFamily: 'monospace',
                  }}
                  autoComplete="off"
                />
              </div>
              <button
                type="submit"
                className="btn btn-primary"
                disabled={isPairing || !inputToken.trim()}
                style={{ padding: '6px 14px', fontSize: '12px', whiteSpace: 'nowrap' }}
              >
                {isPairing ? 'Pairing...' : 'Pair Companion'}
              </button>
            </form>
          </div>
        )}

        {/* State 3: Offline / Not Running */}
        {isOffline && (
          <div
            style={{
              padding: '12px 14px',
              backgroundColor: 'var(--bg-card-subtle)',
              border: '1px solid var(--border-subtle)',
              borderRadius: 'var(--radius-sm)',
              display: 'flex',
              flexDirection: 'column',
              gap: '10px',
              fontSize: '12px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <PowerOff size={15} style={{ color: 'var(--text-muted)' }} />
                <strong style={{ color: 'var(--text-primary)' }}>Companion Not Running</strong>
              </div>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => void refreshStatus()}
                style={{ padding: '3px 8px', fontSize: '11px', display: 'flex', alignItems: 'center', gap: '4px' }}
              >
                <RotateCcw size={11} /> Check Again
              </button>
            </div>

            <p style={{ margin: 0, color: 'var(--text-muted)', lineHeight: '1.45' }}>
              Start the companion service on your Windows machine to pair with Kuro.
            </p>

            <div
              style={{
                backgroundColor: 'var(--bg-card)',
                padding: '8px 10px',
                borderRadius: '4px',
                border: '1px solid var(--border-subtle)',
                fontFamily: 'monospace',
                fontSize: '11px',
                color: 'var(--text-secondary)',
              }}
            >
              <div style={{ color: 'var(--text-muted)', marginBottom: '3px' }}># Quick Start (Terminal):</div>
              <div>companion\start-companion.bat</div>
              <div style={{ color: 'var(--text-muted)', margin: '3px 0' }}># Or using Node directly:</div>
              <div>node companion/server.mjs</div>
            </div>
          </div>
        )}

        {/* Error Notification */}
        {errorMessage && (
          <div
            style={{
              padding: '8px 12px',
              backgroundColor: 'rgba(239, 68, 68, 0.1)',
              border: '1px solid rgba(239, 68, 68, 0.3)',
              borderRadius: 'var(--radius-sm)',
              fontSize: '12px',
              color: 'var(--status-red)',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            <AlertTriangle size={14} style={{ flexShrink: 0 }} />
            <span>{errorMessage}</span>
          </div>
        )}

        {/* Privacy & Security Guarantees */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
            gap: '8px',
            fontSize: '11px',
            color: 'var(--text-muted)',
            paddingTop: '6px',
            borderTop: '1px solid var(--border-subtle)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
            <Lock size={12} style={{ color: 'var(--status-green)' }} />
            <span>Loopback Only (127.0.0.1)</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
            <ShieldCheck size={12} style={{ color: 'var(--status-green)' }} />
            <span>Origin + Session Token Guard</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
            <Terminal size={12} style={{ color: 'var(--status-green)' }} />
            <span>Zero Keystrokes or Source Code</span>
          </div>
        </div>
      </div>
    </div>
  );
};
