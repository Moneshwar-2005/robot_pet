import React, { useState, useEffect } from 'react';
import type { WorkSummary } from '../../types';
import { Timer, Flame, Award, Play, Pause, RotateCcw } from 'lucide-react';

interface WorkSummaryWidgetProps {
  workSummary: WorkSummary;
  onViewWorkTracking?: () => void;
}

const currentDayName = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][new Date().getDay()];

export const WorkSummaryWidget: React.FC<WorkSummaryWidgetProps> = ({
  workSummary,
  onViewWorkTracking,
}) => {
  const [isTimerRunning, setIsTimerRunning] = useState(false);
  const [sessionSeconds, setSessionSeconds] = useState(25 * 60); // 25m Pomodoro

  useEffect(() => {
    if (!isTimerRunning) return;

    const interval = setInterval(() => {
      setSessionSeconds((prev) => {
        if (prev <= 1) {
          setIsTimerRunning(false);
          return 25 * 60;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [isTimerRunning]);

  // Toggle local simulator timer
  const toggleTimer = () => {
    setIsTimerRunning(!isTimerRunning);
  };

  const resetTimer = () => {
    setIsTimerRunning(false);
    setSessionSeconds(25 * 60);
  };

  const formatTimer = (totalSecs: number) => {
    const mins = Math.floor(totalSecs / 60);
    const secs = totalSecs % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const hoursToday = (workSummary.focusMinutesToday / 60).toFixed(1);
  const goalHours = (workSummary.focusGoalMinutes / 60).toFixed(1);
  const progressPercent =
    workSummary.focusGoalMinutes > 0
      ? Math.min(100, Math.round((workSummary.focusMinutesToday / workSummary.focusGoalMinutes) * 100))
      : 0;

  return (
    <div className="card">
      <div className="card-header">
        <div className="card-title-group">
          <Timer className="card-icon" />
          <div>
            <h3 className="card-title">Daily Focus &amp; Productivity Summary</h3>
            <p className="card-subtitle">
              {progressPercent}% of your daily {goalHours}h focus goal achieved
            </p>
          </div>
        </div>

        {onViewWorkTracking && (
          <button
            type="button"
            className="btn btn-secondary"
            style={{ padding: '5px 10px', fontSize: '12px' }}
            onClick={onViewWorkTracking}
          >
            Analytics
          </button>
        )}
      </div>

      {/* 4 Metric Stats */}
      <div className="metric-grid">
        <div className="metric-stat-box">
          <span className="metric-label">Focus Time</span>
          <span className="metric-value">{hoursToday}h</span>
          <span className="metric-sub">Goal: {goalHours}h</span>
        </div>

        <div className="metric-stat-box">
          <span className="metric-label">Streak</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <Flame size={18} style={{ color: 'var(--status-amber)' }} />
            <span className="metric-value">{workSummary.streakDays}d</span>
          </div>
          <span className="metric-sub">
            {workSummary.streakDays > 0 ? 'Daily target met' : 'Start streak today'}
          </span>
        </div>

        <div className="metric-stat-box">
          <span className="metric-label">Productivity</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <Award size={18} style={{ color: 'var(--accent-primary)' }} />
            <span className="metric-value">{workSummary.productivityScore}%</span>
          </div>
          <span className="metric-sub">
            {workSummary.productivityScore >= 80
              ? 'High efficiency'
              : workSummary.productivityScore > 0
              ? 'In progress'
              : 'No sessions yet'}
          </span>
        </div>

        <div className="metric-stat-box">
          <span className="metric-label">Tasks Done</span>
          <span className="metric-value">
            {workSummary.completedTasksToday}/{workSummary.totalTasksToday}
          </span>
          <span className="metric-sub">
            {workSummary.totalTasksToday === 0
              ? 'No tasks created'
              : workSummary.completedTasksToday === workSummary.totalTasksToday
              ? 'All tasks completed'
              : `${workSummary.totalTasksToday - workSummary.completedTasksToday} remaining`}
          </span>
        </div>
      </div>

      {/* Weekly Activity Mini Chart */}
      <div style={{ marginBottom: '16px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: 'var(--text-muted)', marginBottom: '4px' }}>
          <span>Weekly Focus Distribution (Hours)</span>
          <span>Today: {currentDayName} ({hoursToday}h)</span>
        </div>
        <div className="mini-chart">
          {workSummary.dailyDistribution.map((item) => {
            const isToday = item.day === currentDayName;
            const maxHour = 5;
            const barHeight = Math.min(100, (item.hours / maxHour) * 100);
            return (
              <div key={item.day} className="mini-chart-bar-wrap">
                <div
                  className={`mini-chart-bar ${isToday ? 'highlight' : ''}`}
                  style={{ height: `${barHeight}%` }}
                  title={`${item.day}: ${item.hours} hours`}
                />
                <span className="mini-chart-label" style={{ fontWeight: isToday ? 600 : 400, color: isToday ? 'var(--accent-primary)' : undefined }}>
                  {item.day}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Focus Timer Sandbox Simulator */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '12px 14px',
          borderRadius: 'var(--radius-md)',
          backgroundColor: 'var(--bg-card-subtle)',
          border: '1px solid var(--border-subtle)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: '18px',
              fontWeight: 700,
              color: isTimerRunning ? 'var(--accent-primary)' : 'var(--text-primary)',
            }}
          >
            {formatTimer(sessionSeconds)}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <span style={{ fontSize: '12px', fontWeight: 600 }}>Deep Focus Session</span>
            <span style={{ fontSize: '10.5px', color: 'var(--text-muted)' }}>
              {isTimerRunning ? '🟢 Running in simulator' : 'Companion idle'}
            </span>
          </div>
        </div>

        <div style={{ display: 'flex', gap: '6px' }}>
          <button
            type="button"
            className={`btn ${isTimerRunning ? 'btn-secondary' : 'btn-primary'}`}
            style={{ padding: '6px 12px', fontSize: '12px' }}
            onClick={toggleTimer}
          >
            {isTimerRunning ? <Pause size={13} /> : <Play size={13} />}
            <span>{isTimerRunning ? 'Pause' : 'Start Focus'}</span>
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            style={{ padding: '6px 10px', fontSize: '12px' }}
            onClick={resetTimer}
            title="Reset timer"
          >
            <RotateCcw size={13} />
          </button>
        </div>
      </div>
    </div>
  );
};
