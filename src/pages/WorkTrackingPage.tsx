import React, { useState, useEffect } from 'react';
import type { WorkSummary, Task } from '../types';
import type { ClientWorkSession } from '../lib/adapters';
import { formatSessionDuration, formatTimeDisplay } from '../lib/formatters';
import { formatTimerDuration } from '../lib/timerCalculations';
import { useTimer } from '../context/useTimer';
import {
  Play,
  Pause,
  Activity,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  Loader2,
  Trash2,
  Clock,
  Square,
  CheckSquare,
  Folder,
} from 'lucide-react';

interface WorkTrackingPageProps {
  workSummary: WorkSummary;
  sessions: ClientWorkSession[];
  loading?: boolean;
  error?: string | null;
  onRecordSession: (data: {
    title: string;
    sessionType?: 'focus' | 'break' | 'long_break';
    durationMinutes: number;
    startedAt: string;
    completedAt?: string | null;
    taskId?: string | null;
  }) => Promise<boolean>;
  onDeleteSession?: (id: string) => Promise<boolean>;
  onRetry?: () => void;
  tasks?: Task[];
  onFocusStateChange?: (
    state: {
      isActive: boolean;
      mode: 'focus' | 'short_break' | 'long_break';
      remainingSeconds: number;
    } | null
  ) => void;
}

export const WorkTrackingPage: React.FC<WorkTrackingPageProps> = ({
  workSummary,
  sessions,
  loading = false,
  error = null,
  onRecordSession: _onRecordSession,
  onDeleteSession,
  onRetry,
  tasks = [],
  onFocusStateChange,
}) => {
  const {
    activeEntry,
    activeTask,
    activeProject,
    timerStatus,
    elapsedSeconds,
    startTimer,
    pauseTimer,
    resumeTimer,
    stopTimer,
    isStale,
    error: timerError,
    clearError: clearTimerError,
  } = useTimer();

  const [timerMode, setTimerMode] = useState<'focus' | 'break'>('focus');
  const [sessionTitle, setSessionTitle] = useState('Deep Work Sprint');
  const [selectedTaskId, setSelectedTaskId] = useState<string>('');
  const [sessionToDelete, setSessionToDelete] = useState<ClientWorkSession | null>(null);

  // Sync focus state to parent companion/pet listeners
  useEffect(() => {
    if (onFocusStateChange) {
      if (timerStatus === 'running' || timerStatus === 'paused') {
        onFocusStateChange({
          isActive: timerStatus === 'running',
          mode: timerMode === 'focus' ? 'focus' : 'short_break',
          remainingSeconds: Math.max(0, 25 * 60 - elapsedSeconds),
        });
      } else {
        onFocusStateChange(null);
      }
    }
  }, [timerStatus, timerMode, elapsedSeconds, onFocusStateChange]);

  const handleStartTimer = async () => {
    const chosenTaskId = selectedTaskId || null;
    const taskObj = tasks.find((t) => t.id === chosenTaskId);
    const chosenProjectId = taskObj?.projectId || null;

    await startTimer({
      taskId: chosenTaskId,
      projectId: chosenProjectId,
      trackingSource: 'manual',
    });
  };

  const completedBlocksCount = sessions.filter((s) => s.sessionType === 'focus' && s.completedAt).length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {/* Error Banners */}
      {(error || timerError) && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '12px',
            padding: '12px 16px',
            backgroundColor: 'rgba(239, 68, 68, 0.12)',
            border: '1px solid var(--status-red)',
            borderRadius: 'var(--radius-md)',
            color: 'var(--text-primary)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <AlertCircle size={18} style={{ color: 'var(--status-red)', flexShrink: 0 }} />
            <span style={{ fontSize: '13px' }}>{timerError || error}</span>
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            {timerError && (
              <button
                type="button"
                className="btn btn-secondary"
                onClick={clearTimerError}
                style={{ padding: '4px 10px', fontSize: '12px' }}
              >
                Dismiss
              </button>
            )}
            {onRetry && (
              <button
                type="button"
                className="btn btn-secondary"
                onClick={onRetry}
                style={{ padding: '4px 10px', fontSize: '12px' }}
              >
                <RefreshCw size={12} />
                <span>Retry</span>
              </button>
            )}
          </div>
        </div>
      )}

      {/* Stale Timer Notice if active timer > 12 hours */}
      {isStale && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '12px',
            padding: '12px 16px',
            backgroundColor: 'rgba(234, 179, 8, 0.12)',
            border: '1px solid var(--status-yellow)',
            borderRadius: 'var(--radius-md)',
            color: 'var(--text-primary)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Clock size={18} style={{ color: 'var(--status-yellow)', flexShrink: 0 }} />
            <span style={{ fontSize: '13px' }}>
              This timer has been running or paused for over 12 hours without activity. Please finalize or stop your session.
            </span>
          </div>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => void stopTimer()}
            style={{ padding: '4px 12px', fontSize: '12px' }}
          >
            Finalize Now
          </button>
        </div>
      )}

      <div className="dashboard-grid">
        {/* Left Column: Big Interactive Normalized Timer */}
        <div className="col-6">
          <div className="card" style={{ textAlign: 'center', padding: '32px 20px' }}>
            {/* Timer Status & Mode Header */}
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '10px', marginBottom: '20px' }}>
              {timerStatus === 'running' ? (
                <span
                  className="badge"
                  style={{
                    backgroundColor: 'rgba(34, 197, 94, 0.15)',
                    color: 'var(--status-green)',
                    border: '1px solid rgba(34, 197, 94, 0.4)',
                    padding: '4px 12px',
                    fontWeight: 700,
                    letterSpacing: '0.05em',
                  }}
                >
                  ● RUNNING
                </span>
              ) : timerStatus === 'paused' ? (
                <span
                  className="badge"
                  style={{
                    backgroundColor: 'rgba(234, 179, 8, 0.15)',
                    color: 'var(--status-yellow)',
                    border: '1px solid rgba(234, 179, 8, 0.4)',
                    padding: '4px 12px',
                    fontWeight: 700,
                    letterSpacing: '0.05em',
                  }}
                >
                  ❚❚ PAUSED
                </span>
              ) : (
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button
                    type="button"
                    className={`expression-btn ${timerMode === 'focus' ? 'active' : ''}`}
                    onClick={() => {
                      setTimerMode('focus');
                      setSessionTitle('Deep Work Sprint');
                    }}
                  >
                    Deep Focus
                  </button>
                  <button
                    type="button"
                    className={`expression-btn ${timerMode === 'break' ? 'active' : ''}`}
                    onClick={() => {
                      setTimerMode('break');
                      setSessionTitle('Rest Break');
                    }}
                  >
                    Short Break
                  </button>
                </div>
              )}
            </div>

            {/* Active Task or Target Selector */}
            <div style={{ maxWidth: '340px', margin: '0 auto 16px auto', display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {activeEntry ? (
                <div
                  style={{
                    padding: '8px 14px',
                    backgroundColor: 'var(--bg-card-subtle)',
                    border: '1px solid var(--border-subtle)',
                    borderRadius: 'var(--radius-md)',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: '4px',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', fontWeight: 600 }}>
                    <CheckSquare size={14} style={{ color: 'var(--accent-primary)' }} />
                    <span>{activeTask?.title || sessionTitle || 'General Focus Session'}</span>
                  </div>
                  {activeProject && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '11px', color: 'var(--text-muted)' }}>
                      <Folder size={11} />
                      <span>{activeProject.name}</span>
                    </div>
                  )}
                </div>
              ) : (
                <>
                  <select
                    value={selectedTaskId}
                    onChange={(e) => setSelectedTaskId(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '7px 12px',
                      background: 'var(--bg-input)',
                      border: '1px solid var(--border-subtle)',
                      borderRadius: 'var(--radius-sm)',
                      color: 'var(--text-primary)',
                      fontSize: '13px',
                    }}
                  >
                    <option value="">(No linked task — General Sprint)</option>
                    {tasks
                      .filter((t) => !t.completed)
                      .map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.title}
                        </option>
                      ))}
                  </select>

                  <input
                    type="text"
                    value={sessionTitle}
                    onChange={(e) => setSessionTitle(e.target.value)}
                    placeholder="Session focus objective..."
                    style={{
                      width: '100%',
                      textAlign: 'center',
                      padding: '6px 12px',
                      background: 'var(--bg-input)',
                      border: '1px solid var(--border-subtle)',
                      borderRadius: 'var(--radius-sm)',
                      color: 'var(--text-primary)',
                      fontSize: '13px',
                    }}
                  />
                </>
              )}
            </div>

            {/* Big Monospace Duration Display */}
            <div
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: '64px',
                fontWeight: 700,
                color:
                  timerStatus === 'running'
                    ? 'var(--accent-primary)'
                    : timerStatus === 'paused'
                    ? 'var(--status-yellow)'
                    : 'var(--text-primary)',
                letterSpacing: '-0.03em',
                marginBottom: '16px',
              }}
            >
              {formatTimerDuration(elapsedSeconds)}
            </div>

            <p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '24px' }}>
              {timerStatus === 'running'
                ? 'Active focus session recorded to normalized database. Kuro is guarding your flow.'
                : timerStatus === 'paused'
                ? 'Session paused. Pause duration is strictly excluded from active work.'
                : 'Select an existing task or start a general sprint when you are ready.'}
            </p>

            {/* Primary Controls */}
            <div style={{ display: 'flex', justifyContent: 'center', gap: '10px', flexWrap: 'wrap' }}>
              {timerStatus === 'running' ? (
                <>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    style={{ padding: '10px 22px', fontSize: '14px' }}
                    onClick={() => void pauseTimer()}
                  >
                    <Pause size={16} />
                    <span>Pause</span>
                  </button>

                  <button
                    type="button"
                    className="btn btn-primary"
                    style={{ padding: '10px 22px', fontSize: '14px' }}
                    onClick={() => void stopTimer()}
                  >
                    <Square size={16} />
                    <span>Stop &amp; Log</span>
                  </button>
                </>
              ) : timerStatus === 'paused' ? (
                <>
                  <button
                    type="button"
                    className="btn btn-primary"
                    style={{ padding: '10px 22px', fontSize: '14px' }}
                    onClick={() => void resumeTimer()}
                  >
                    <Play size={16} />
                    <span>Resume</span>
                  </button>

                  <button
                    type="button"
                    className="btn btn-secondary"
                    style={{ padding: '10px 22px', fontSize: '14px' }}
                    onClick={() => void stopTimer()}
                  >
                    <Square size={16} />
                    <span>Stop &amp; Log</span>
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  className="btn btn-primary"
                  style={{ padding: '10px 28px', fontSize: '14px' }}
                  onClick={() => void handleStartTimer()}
                >
                  <Play size={16} />
                  <span>Start Timer</span>
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Right Column: Daily Stats & Recent Sessions */}
        <div className="col-6" style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <div className="card">
            <div className="card-header">
              <div className="card-title-group">
                <Activity className="card-icon" />
                <h3 className="card-title">Session Telemetry</h3>
              </div>
            </div>

            <div className="metric-grid" style={{ marginBottom: 0 }}>
              <div className="metric-stat-box">
                <span className="metric-label">Today's Focus</span>
                <span className="metric-value">{(workSummary.focusMinutesToday / 60).toFixed(1)}h</span>
                <span className="metric-sub">Target: {(workSummary.focusGoalMinutes / 60).toFixed(1)}h</span>
              </div>
              <div className="metric-stat-box">
                <span className="metric-label">Productivity</span>
                <span className="metric-value">{workSummary.productivityScore}%</span>
                <span className="metric-sub">Focus ratio</span>
              </div>
              <div className="metric-stat-box">
                <span className="metric-label">Daily Streak</span>
                <span className="metric-value">{workSummary.streakDays}d</span>
                <span className="metric-sub">Active sprint days</span>
              </div>
              <div className="metric-stat-box">
                <span className="metric-label">Blocks Done</span>
                <span className="metric-value">{completedBlocksCount}</span>
                <span className="metric-sub">Recorded sprints</span>
              </div>
            </div>
          </div>

          <div className="card">
            <div className="card-header">
              <h3 className="card-title">Completed Sessions</h3>
              <span className="badge badge-neutral">{sessions.length} logged</span>
            </div>

            {loading ? (
              <div className="empty-state">
                <Loader2 className="empty-state-icon" style={{ animation: 'spin 1s linear infinite' }} />
                <div className="empty-state-title">Loading sessions...</div>
                <p className="empty-state-desc">Fetching telemetry logs from database.</p>
              </div>
            ) : sessions.length === 0 ? (
              <div className="empty-state">
                <Clock className="empty-state-icon" />
                <div className="empty-state-title">No completed sessions logged</div>
                <p className="empty-state-desc">Start a sprint timer on the left to record your first focus session.</p>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', fontSize: '13px' }}>
                {sessions.map((sess) => {
                  let timeDisplay = '';
                  try {
                    const date = new Date(sess.startedAt);
                    timeDisplay = date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
                  } catch {
                    timeDisplay = formatTimeDisplay(sess.startedAt.split('T')[1]);
                  }

                  return (
                    <div
                      key={sess.id}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '10px 12px',
                        borderRadius: 'var(--radius-sm)',
                        backgroundColor: 'var(--bg-card-subtle)',
                        border: '1px solid var(--border-subtle)',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <CheckCircle2
                          size={15}
                          style={{
                            color: sess.sessionType === 'focus' ? 'var(--status-green)' : 'var(--accent-primary)',
                            flexShrink: 0,
                          }}
                        />
                        <div>
                          <div style={{ fontWeight: 500, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <span>{sess.title}</span>
                            {sess.isNormalized ? (
                              <span
                                className="badge"
                                style={{
                                  fontSize: '9.5px',
                                  padding: '1px 5px',
                                  backgroundColor: 'rgba(56, 189, 248, 0.12)',
                                  color: 'var(--accent-primary)',
                                  border: '1px solid rgba(56, 189, 248, 0.25)',
                                }}
                                title="Phase 9 normalized time entry"
                              >
                                Normalized
                              </span>
                            ) : (
                              <span
                                className="badge"
                                style={{
                                  fontSize: '9.5px',
                                  padding: '1px 5px',
                                  backgroundColor: 'var(--bg-card-hover)',
                                  color: 'var(--text-muted)',
                                }}
                                title="Historical work session"
                              >
                                Legacy
                              </span>
                            )}
                          </div>
                          <span style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'capitalize' }}>
                            {sess.sessionType} sprint
                          </span>
                        </div>
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <span className="mono" style={{ fontSize: '11.5px', color: 'var(--text-muted)' }}>
                          {formatSessionDuration(sess.durationMinutes)} • {timeDisplay}
                        </span>
                        {onDeleteSession && (
                          <button
                            type="button"
                            className="reminder-action-btn"
                            onClick={() => setSessionToDelete(sess)}
                            title="Delete session log"
                            style={{ color: 'var(--status-red)' }}
                          >
                            <Trash2 size={12} />
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Delete Session Confirmation Modal */}
      {sessionToDelete && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.75)',
            backdropFilter: 'blur(3px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 100,
            padding: '16px',
          }}
          onClick={() => setSessionToDelete(null)}
        >
          <div
            style={{
              backgroundColor: 'var(--bg-card)',
              border: '1px solid var(--border-color)',
              borderRadius: 'var(--radius-lg)',
              padding: '24px',
              maxWidth: '420px',
              width: '100%',
              boxShadow: '0 20px 40px rgba(0, 0, 0, 0.4)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', color: 'var(--status-red)', marginBottom: '12px' }}>
              <AlertCircle size={22} />
              <h3 style={{ fontSize: '16px', fontWeight: 600, color: 'var(--text-primary)' }}>Delete Session Record</h3>
            </div>
            <p style={{ fontSize: '13px', color: 'var(--text-secondary)', lineHeight: 1.5, marginBottom: '20px' }}>
              Are you sure you want to delete the session record for &quot;{sessionToDelete.title}&quot;?
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setSessionToDelete(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-danger"
                onClick={() => {
                  if (onDeleteSession) {
                    void onDeleteSession(sessionToDelete.id);
                  }
                  setSessionToDelete(null);
                }}
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
