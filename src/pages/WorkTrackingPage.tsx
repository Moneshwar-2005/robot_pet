import React, { useState, useEffect } from 'react';
import type { WorkSummary } from '../types';
import { PlannedFeatureNotice } from '../components/common/PlannedFeatureNotice';
import { Play, Pause, RotateCcw, Activity, CheckCircle2 } from 'lucide-react';

interface WorkTrackingPageProps {
  workSummary: WorkSummary;
}

export const WorkTrackingPage: React.FC<WorkTrackingPageProps> = ({ workSummary }) => {
  const [timerMode, setTimerMode] = useState<'focus' | 'break'>('focus');
  const [secondsLeft, setSecondsLeft] = useState(25 * 60);
  const [isRunning, setIsRunning] = useState(false);

  useEffect(() => {
    if (!isRunning) return;

    const interval = setInterval(() => {
      setSecondsLeft((prev) => {
        if (prev <= 1) {
          setIsRunning(false);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [isRunning]);

  const toggleRun = () => setIsRunning(!isRunning);

  const resetTimer = (mode: 'focus' | 'break') => {
    setIsRunning(false);
    setTimerMode(mode);
    setSecondsLeft(mode === 'focus' ? 25 * 60 : 5 * 60);
  };

  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <PlannedFeatureNotice
        phase="Phase 1: Local Work Tracking"
        title="Focus Session &amp; Telemetry Tracker"
        description="Run local Pomodoro focus blocks and track daily session milestones. Automated window focus detection and robot head camera posture tracking will connect in Phase 2 & 3."
      />

      <div className="dashboard-grid">
        {/* Left Column: Big Interactive Timer */}
        <div className="col-6">
          <div className="card" style={{ textAlign: 'center', padding: '32px 20px' }}>
            <div style={{ display: 'flex', justifyContent: 'center', gap: '8px', marginBottom: '24px' }}>
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
              {formatTime(secondsLeft)}
            </div>

            <p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '24px' }}>
              {isRunning
                ? `Active ${timerMode === 'focus' ? 'Deep Work' : 'Rest'} Session — Kuro is guarding your focus.`
                : 'Press Start when you are ready to begin your sprint.'}
            </p>

            <div style={{ display: 'flex', justifyContent: 'center', gap: '12px' }}>
              <button
                type="button"
                className="btn btn-primary"
                style={{ padding: '10px 24px', fontSize: '14px' }}
                onClick={toggleRun}
              >
                {isRunning ? <Pause size={16} /> : <Play size={16} />}
                <span>{isRunning ? 'Pause' : 'Start Timer'}</span>
              </button>

              <button
                type="button"
                className="btn btn-secondary"
                style={{ padding: '10px 18px', fontSize: '14px' }}
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
                <span className="metric-value">2.8h</span>
                <span className="metric-sub">Target: 4.0h</span>
              </div>
              <div className="metric-stat-box">
                <span className="metric-label">Efficiency</span>
                <span className="metric-value">91%</span>
                <span className="metric-sub">Low distractions</span>
              </div>
              <div className="metric-stat-box">
                <span className="metric-label">Daily Streak</span>
                <span className="metric-value">{workSummary.streakDays}d</span>
                <span className="metric-sub">Consecutive days</span>
              </div>
              <div className="metric-stat-box">
                <span className="metric-label">Blocks Done</span>
                <span className="metric-value">5</span>
                <span className="metric-sub">25-min sprints</span>
              </div>
            </div>
          </div>

          <div className="card">
            <div className="card-header">
              <h3 className="card-title">Completed Sessions Today</h3>
              <span className="badge badge-phase">Local Log</span>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', fontSize: '13px' }}>
              {[
                { title: 'ESP32 Hardware Pinout Review', duration: '50m', time: '10:00 AM' },
                { title: 'Web UI Navigation Shell Design', duration: '45m', time: '11:30 AM' },
                { title: 'CSS Theme & OLED Styling', duration: '35m', time: '2:15 PM' },
              ].map((sess, i) => (
                <div
                  key={i}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '8px 12px',
                    borderRadius: 'var(--radius-sm)',
                    backgroundColor: 'var(--bg-card-subtle)',
                    border: '1px solid var(--border-subtle)',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <CheckCircle2 size={14} style={{ color: 'var(--status-green)' }} />
                    <span>{sess.title}</span>
                  </div>
                  <span className="mono" style={{ fontSize: '11.5px', color: 'var(--text-muted)' }}>
                    {sess.duration} • {sess.time}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
