import React, { useState, useEffect, useRef } from 'react';
import type { WorkSummary, Task } from '../types';
import type { ClientWorkSession } from '../lib/adapters';
import { formatSessionDuration, formatTimeDisplay } from '../lib/formatters';
import { PlannedFeatureNotice } from '../components/common/PlannedFeatureNotice';
import {
  Play,
  Pause,
  RotateCcw,
  Activity,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  Loader2,
  Trash2,
  Clock,
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
}

export const WorkTrackingPage: React.FC<WorkTrackingPageProps> = ({
  workSummary,
  sessions,
  loading = false,
  error = null,
  onRecordSession,
  onDeleteSession,
  onRetry,
}) => {
  const [timerMode, setTimerMode] = useState<'focus' | 'break'>('focus');
  const [secondsLeft, setSecondsLeft] = useState(25 * 60);
  const [isRunning, setIsRunning] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [sessionTitle, setSessionTitle] = useState('Deep Work Sprint');
  const sessionStartTimeRef = useRef<string | null>(null);
  const isRecordingRef = useRef(false);
  const sessionTitleRef = useRef(sessionTitle);

  useEffect(() => {
    sessionTitleRef.current = sessionTitle;
  }, [sessionTitle]);

  useEffect(() => {
    if (!isRunning) return;

    const interval = setInterval(() => {
      setSecondsLeft((prev) => {
        if (prev <= 1) {
          setIsRunning(false);
          if (!isRecordingRef.current) {
            isRecordingRef.current = true;
            setIsRecording(true);
            const startedAt =
              sessionStartTimeRef.current ||
              new Date(Date.now() - (timerMode === 'focus' ? 25 : 5) * 60000).toISOString();
            sessionStartTimeRef.current = null;
            const durationMinutes = timerMode === 'focus' ? 25 : 5;
            const titleToRecord =
              sessionTitleRef.current.trim() ||
              (timerMode === 'focus' ? 'Deep Work Sprint' : 'Rest Break');

            void onRecordSession({
              title: titleToRecord,
              sessionType: timerMode,
              durationMinutes,
              startedAt,
              completedAt: new Date().toISOString(),
            }).finally(() => {
              isRecordingRef.current = false;
              setIsRecording(false);
            });
          }
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [isRunning, timerMode, onRecordSession]);

  const toggleRun = () => {
    if (isRecording) return;
    if (!isRunning) {
      if (!sessionStartTimeRef.current) {
        sessionStartTimeRef.current = new Date().toISOString();
      }
      setIsRunning(true);
    } else {
      setIsRunning(false);
    }
  };

  const resetTimer = (mode: 'focus' | 'break') => {
    if (isRecording) return;
    setIsRunning(false);
    sessionStartTimeRef.current = null;
    setTimerMode(mode);
    setSecondsLeft(mode === 'focus' ? 25 * 60 : 5 * 60);
    setSessionTitle(mode === 'focus' ? 'Deep Work Sprint' : 'Rest Break');
  };

  const handleCompleteEarly = async () => {
    if (isRecordingRef.current || isRecording) return;
    const totalSecs = timerMode === 'focus' ? 25 * 60 : 5 * 60;
    const elapsedSecs = totalSecs - secondsLeft;
    const elapsedMins = Math.max(1, Math.round(elapsedSecs / 60));
    const startedAt = sessionStartTimeRef.current || new Date().toISOString();

    isRecordingRef.current = true;
    setIsRecording(true);
    setIsRunning(false);
    sessionStartTimeRef.current = null;

    try {
      await onRecordSession({
        title: sessionTitle.trim() || (timerMode === 'focus' ? 'Deep Work Sprint' : 'Rest Break'),
        sessionType: timerMode,
        durationMinutes: elapsedMins,
        startedAt,
        completedAt: new Date().toISOString(),
      });
    } finally {
      isRecordingRef.current = false;
      setIsRecording(false);
      setSecondsLeft(timerMode === 'focus' ? 25 * 60 : 5 * 60);
    }
  };

  const formatTimerDigits = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  const completedBlocksCount = sessions.filter((s) => s.sessionType === 'focus' && s.completedAt).length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <PlannedFeatureNotice
        phase="Phase 2: Persistent Work Sessions"
        title="Focus Session &amp; Telemetry Tracker"
        description="Run focus blocks and track daily session milestones. Authenticated session logs are persisted to Supabase; local demo mode is active when signed out."
      />

      {error && (
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
            <span style={{ fontSize: '13px' }}>{error}</span>
          </div>
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
      )}

      <div className="dashboard-grid">
        {/* Left Column: Big Interactive Timer */}
        <div className="col-6">
          <div className="card" style={{ textAlign: 'center', padding: '32px 20px' }}>
            <div style={{ display: 'flex', justifyContent: 'center', gap: '8px', marginBottom: '20px' }}>
              <button
                type="button"
                className={`expression-btn ${timerMode === 'focus' ? 'active' : ''}`}
                onClick={() => resetTimer('focus')}
              >
                Deep Focus (25m)
              </button>
              <button
                type="button"
                className={`expression-btn ${timerMode === 'break' ? 'active' : ''}`}
                onClick={() => resetTimer('break')}
              >
                Short Break (5m)
              </button>
            </div>

            <div style={{ maxWidth: '320px', margin: '0 auto 16px auto' }}>
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
            </div>

            <div
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: '64px',
                fontWeight: 700,
                color: isRunning ? 'var(--accent-primary)' : 'var(--text-primary)',
                letterSpacing: '-0.03em',
                marginBottom: '16px',
              }}
            >
              {formatTimerDigits(secondsLeft)}
            </div>

            <p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '24px' }}>
              {isRunning
                ? `Active ${timerMode === 'focus' ? 'Deep Work' : 'Rest'} Session — Kuro is guarding your focus.`
                : 'Press Start when you are ready to begin your sprint.'}
            </p>

            <div style={{ display: 'flex', justifyContent: 'center', gap: '10px', flexWrap: 'wrap' }}>
              <button
                type="button"
                className="btn btn-primary"
                style={{ padding: '10px 24px', fontSize: '14px' }}
                onClick={toggleRun}
              >
                {isRunning ? <Pause size={16} /> : <Play size={16} />}
                <span>{isRunning ? 'Pause' : 'Start Timer'}</span>
              </button>

              {isRunning && (
                <button
                  type="button"
                  className="btn btn-secondary"
                  style={{ padding: '10px 16px', fontSize: '14px' }}
                  onClick={handleCompleteEarly}
                >
                  <CheckCircle2 size={16} style={{ color: 'var(--status-green)' }} />
                  <span>Log Sprint</span>
                </button>
              )}

              <button
                type="button"
                className="btn btn-secondary"
                style={{ padding: '10px 16px', fontSize: '14px' }}
                onClick={() => resetTimer(timerMode)}
              >
                <RotateCcw size={16} />
                <span>Reset</span>
              </button>
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
                          <div style={{ fontWeight: 500, color: 'var(--text-primary)' }}>{sess.title}</div>
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
                            onClick={() => onDeleteSession(sess.id)}
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
    </div>
  );
};
