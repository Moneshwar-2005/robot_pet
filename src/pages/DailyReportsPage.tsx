import React, { useState, useMemo, useCallback } from 'react';
import type { ClientWorkSession } from '../lib/adapters';
import type { Task } from '../types';
import { useAuth } from '../context/useAuth';
import { useUserPreferences } from '../hooks/useUserPreferences';
import { useProjects } from '../hooks/useProjects';
import { useTasks } from '../hooks/useTasks';
import { useNormalizedTimer } from '../hooks/useNormalizedTimer';
import { useDailyReports } from '../hooks/useDailyReports';
import { useDesktopCompanion } from '../hooks/useDesktopCompanion';
import { formatYMD, formatDisplayDate } from '../lib/reportCalculations';
import { getProvider, getSavedProviderId } from '../lib/ai/providerRegistry';
import {
  Sparkles,
  Calendar,
  CheckCircle2,
  Circle,
  Lightbulb,
  Clock,
  Folder,
  Loader2,
  RotateCcw,
  Bot,
  AlertCircle,
  Monitor,
  Cpu,
  Coffee,
  Hourglass,
  Activity,
  CheckSquare,
  CloudOff,
  Download,
  ListFilter,
  Check,
} from 'lucide-react';

function getTodayYMD(): string {
  return formatYMD(new Date());
}

function getYesterdayYMD(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return formatYMD(d);
}

function formatTimeOnly(isoStr: string | null): string {
  if (!isoStr) return '';
  try {
    const d = new Date(isoStr);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}

export interface DailyReportsPageProps {
  sessions?: ClientWorkSession[];
  tasks?: Task[];
}

export const DailyReportsPage: React.FC<DailyReportsPageProps> = ({
  sessions = [],
  tasks: propTasks = [],
}) => {
  const { user } = useAuth();
  const { preferences } = useUserPreferences();
  const { projects } = useProjects();
  const { tasks: hookTasks } = useTasks();
  const { connectionState, recentSessions } = useDesktopCompanion();

  const [selectedDate, setSelectedDate] = useState<string>(() => getTodayYMD());
  const [copiedMarkdown, setCopiedMarkdown] = useState<boolean>(false);

  // Normalized Timer hook to access live entries
  const {
    activeEntry,
    activePauses,
    activeIdles,
    recentEntries,
  } = useNormalizedTimer({
    activityTrackingEnabled: preferences.activityTrackingEnabled,
    idleThresholdSeconds: preferences.idleThresholdSeconds,
  });

  // Effective tasks list (prefer props if passed from App, else fallback to hook)
  const effectiveTasks = useMemo(() => {
    return propTasks.length > 0 ? propTasks : hookTasks;
  }, [propTasks, hookTasks]);

  // Combine recent completed entries with current active entry
  const allTimeEntries = useMemo(() => {
    const list = [...recentEntries];
    if (activeEntry && !list.some((e) => e.id === activeEntry.id)) {
      list.unshift(activeEntry);
    }
    return list;
  }, [recentEntries, activeEntry]);

  // Combine Kuro work sessions with any completed desktop companion sessions
  const combinedLegacySessions = useMemo(() => {
    const list = [...sessions];
    if (connectionState === 'running_paired' && recentSessions.length > 0) {
      for (const compSess of recentSessions) {
        const alreadyExists = list.some(
          (s) => s.startedAt === compSess.startedAt || s.id === compSess.id
        );
        if (!alreadyExists && compSess.endedAt) {
          list.push({
            id: compSess.id,
            title: `${compSess.ideName}: ${compSess.project || 'General Workspace'}`,
            sessionType: 'focus',
            durationMinutes: Math.max(1, Math.round(compSess.durationSeconds / 60)),
            startedAt: compSess.startedAt,
            completedAt: compSess.endedAt,
            taskId: null,
            createdAt: compSess.startedAt,
          });
        }
      }
    }
    return list;
  }, [sessions, connectionState, recentSessions]);

  // Context bundle for report calculation
  const contextData = useMemo(() => {
    return {
      timeEntries: allTimeEntries,
      pauses: activePauses,
      idles: activeIdles,
      tasks: effectiveTasks,
      projects,
      legacySessions: combinedLegacySessions,
    };
  }, [allTimeEntries, activePauses, activeIdles, effectiveTasks, projects, combinedLegacySessions]);

  // Milestone 5 Daily Reports hook
  const {
    reports,
    currentReport,
    loading: reportsLoading,
    generating,
    error,
    hasPendingSync,
    generateReport,
    refreshReport,
  } = useDailyReports(selectedDate, contextData);

  const todayStr = useMemo(() => getTodayYMD(), []);
  const yesterdayStr = useMemo(() => getYesterdayYMD(), []);

  const activeProviderId = getSavedProviderId();
  const provider = getProvider(activeProviderId);

  // Time calculations
  const focusMinutes = currentReport ? Math.round(currentReport.totalFocusSeconds / 60) : 0;
  const focusHours = Math.floor(focusMinutes / 60);
  const remainingFocusMinutes = focusMinutes % 60;

  const pauseMinutes = currentReport ? Math.round(currentReport.totalPausedSeconds / 60) : 0;
  const idleMinutes = currentReport ? Math.round(currentReport.totalIdleSeconds / 60) : 0;

  const totalTrackedMinutes = currentReport
    ? Math.round(currentReport.totalTrackedSeconds / 60)
    : focusMinutes + pauseMinutes + (preferences.activityTrackingEnabled ? idleMinutes : 0);
  const trackedHours = Math.floor(totalTrackedMinutes / 60);
  const remainingTrackedMinutes = totalTrackedMinutes % 60;

  // Export / Copy Markdown Summary
  const handleExportMarkdown = useCallback(() => {
    if (!currentReport) return;

    const md = [
      `# Kuro Daily Work Summary — ${formatDisplayDate(selectedDate)}`,
      '',
      '## Key Quantitative Metrics',
      `- **Total Focus Time**: ${focusHours}h ${remainingFocusMinutes}m (${focusMinutes} minutes)`,
      `- **Break / Pause Time**: ${pauseMinutes}m`,
      preferences.activityTrackingEnabled ? `- **Inactive / Idle Time**: ${idleMinutes}m` : null,
      `- **Total Tracked Duration**: ${trackedHours}h ${remainingTrackedMinutes}m`,
      `- **Recorded Sessions**: ${currentReport.sessionCount}`,
      `- **Tasks Accomplished**: ${currentReport.tasksCompletedCount}`,
      `- **Tasks Created Today**: ${currentReport.tasksCreatedCount}`,
      `- **Tasks In Progress / Outstanding**: ${currentReport.outstandingTasksCount ?? 0}`,
      '',
      '## Project Time Distribution',
      ...(currentReport.projectBreakdown.length > 0
        ? currentReport.projectBreakdown.map(
            (p) => `- **${p.project}**: ${p.minutes}m (${p.sessionCount} sessions, ${p.completedTasksCount} tasks completed)`
          )
        : ['- No project sessions recorded.']),
      '',
      '## Tasks Worked On & Queue Status',
      ...(currentReport.taskBreakdown.length > 0
        ? currentReport.taskBreakdown.map(
            (t) =>
              `- [${t.completed ? 'x' : ' '}] **${t.title}** [${t.priority.toUpperCase()}] — ${t.projectName}${
                t.timeSpentSeconds > 0 ? ` (${Math.round(t.timeSpentSeconds / 60)}m logged)` : ''
              }`
          )
        : ['- No tasks recorded for this date.']),
      '',
      '## Narrative Reflection',
      currentReport.aiNarrative || 'No activity logged for this date.',
      '',
      '## Actionable Suggestions',
      ...(currentReport.actionableSuggestions.length > 0
        ? currentReport.actionableSuggestions.map((s) => `- ${s}`)
        : ['- Continue maintaining healthy focus rhythms.']),
      '',
      '---',
      `*Report synthesized via Kuro Companion (${currentReport.generationStatus})*`,
    ]
      .filter((line): line is string => line !== null)
      .join('\n');

    void navigator.clipboard.writeText(md).then(() => {
      setCopiedMarkdown(true);
      setTimeout(() => setCopiedMarkdown(false), 2500);
    });
  }, [currentReport, selectedDate, focusHours, remainingFocusMinutes, focusMinutes, pauseMinutes, idleMinutes, preferences.activityTrackingEnabled, trackedHours, remainingTrackedMinutes]);

  // Unique historical dates list from saved reports
  const historyDates = useMemo(() => {
    const dates = new Set<string>();
    for (const r of reports) {
      dates.add(r.reportDate);
    }
    return Array.from(dates).sort((a, b) => b.localeCompare(a));
  }, [reports]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {/* Date Switcher & Control Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          <button
            type="button"
            className={`expression-btn ${selectedDate === todayStr ? 'active' : ''}`}
            onClick={() => setSelectedDate(todayStr)}
          >
            <Calendar size={13} />
            <span>Today</span>
          </button>
          <button
            type="button"
            className={`expression-btn ${selectedDate === yesterdayStr ? 'active' : ''}`}
            onClick={() => setSelectedDate(yesterdayStr)}
          >
            <Calendar size={13} />
            <span>Yesterday</span>
          </button>

          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginLeft: '4px' }}>
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => e.target.value && setSelectedDate(e.target.value)}
              className="input"
              style={{
                fontSize: '12px',
                padding: '4px 8px',
                borderRadius: 'var(--radius-sm)',
                border: '1px solid var(--border-subtle)',
                backgroundColor: 'var(--bg-card)',
                color: 'var(--text-primary)',
              }}
              title="Select custom date"
            />
          </div>

          {/* Previous Reports Dropdown */}
          {historyDates.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginLeft: '6px' }}>
              <ListFilter size={13} style={{ color: 'var(--text-muted)' }} />
              <select
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
                style={{
                  fontSize: '12px',
                  padding: '4px 8px',
                  borderRadius: 'var(--radius-sm)',
                  border: '1px solid var(--border-subtle)',
                  backgroundColor: 'var(--bg-card)',
                  color: 'var(--text-primary)',
                  cursor: 'pointer',
                }}
                title="Select from previously generated reports"
              >
                <option value={selectedDate}>Saved Reports ({historyDates.length})</option>
                {historyDates.map((d) => (
                  <option key={d} value={d}>
                    {d} {d === todayStr ? '(Today)' : d === yesterdayStr ? '(Yesterday)' : ''}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        {/* Generate / Refresh / Export Actions */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={handleExportMarkdown}
            disabled={!currentReport}
            style={{ padding: '6px 12px', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '6px' }}
            title="Copy formatted daily markdown report to clipboard"
          >
            {copiedMarkdown ? <Check size={13} style={{ color: 'var(--status-green)' }} /> : <Download size={13} />}
            <span>{copiedMarkdown ? 'Copied Markdown!' : 'Export Markdown'}</span>
          </button>

          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => void refreshReport(selectedDate)}
            disabled={generating || reportsLoading}
            style={{ padding: '6px 12px', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '6px' }}
            title="Refresh verified metrics from database"
          >
            <RotateCcw size={13} className={generating ? 'spin' : ''} />
            <span>Refresh Report</span>
          </button>

          <button
            type="button"
            className="btn btn-primary"
            onClick={() => void generateReport(selectedDate, true)}
            disabled={generating || reportsLoading}
            style={{ padding: '6px 14px', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '6px' }}
            title={`Synthesize end-of-day summary using local ${provider.name}`}
          >
            {generating ? (
              <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} />
            ) : (
              <Sparkles size={13} />
            )}
            <span>{generating ? 'Synthesizing...' : 'Generate AI Summary'}</span>
          </button>
        </div>
      </div>

      {/* Offline Pending Sync Banner */}
      {hasPendingSync && (
        <div
          style={{
            padding: '10px 14px',
            backgroundColor: 'rgba(234, 179, 8, 0.08)',
            border: '1px solid rgba(234, 179, 8, 0.25)',
            borderRadius: 'var(--radius-sm)',
            fontSize: '12px',
            color: 'var(--status-yellow, #eab308)',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
          }}
        >
          <CloudOff size={15} style={{ flexShrink: 0 }} />
          <span>
            <strong>Pending Outbox Sync:</strong> This report has un-synced local changes safely cached in IndexedDB. Data will synchronize to your Supabase workspace once connectivity is restored.
          </span>
        </div>
      )}

      {/* Error Banner */}
      {error && (
        <div
          style={{
            padding: '10px 14px',
            backgroundColor: 'rgba(239, 68, 68, 0.08)',
            border: '1px solid rgba(239, 68, 68, 0.25)',
            borderRadius: 'var(--radius-sm)',
            fontSize: '12px',
            color: 'var(--status-red, #ef4444)',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
          }}
        >
          <AlertCircle size={15} style={{ flexShrink: 0 }} />
          <span>{error}</span>
        </div>
      )}

      {/* Desktop Companion Notice if active */}
      {connectionState === 'running_paired' && recentSessions.length > 0 && (
        <div
          style={{
            padding: '10px 14px',
            backgroundColor: 'rgba(16, 185, 129, 0.08)',
            border: '1px solid rgba(16, 185, 129, 0.25)',
            borderRadius: 'var(--radius-sm)',
            fontSize: '12px',
            color: 'var(--text-secondary)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '8px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Monitor size={15} style={{ color: 'var(--status-green)' }} />
            <span>
              <strong>Windows Desktop Companion Active:</strong> {recentSessions.length} local session(s) detected. Sessions are included in today&apos;s summary.
            </span>
          </div>
        </div>
      )}

      {/* Verified Quantitative Metrics Cards Grid */}
      <div className="dashboard-grid">
        {/* Total Focus Time */}
        <div className="col-4">
          <div className="card" style={{ padding: '16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
              <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Total Focus Time</span>
              <Clock size={16} style={{ color: 'var(--accent-primary)' }} />
            </div>
            <div style={{ fontSize: '24px', fontWeight: 700, color: 'var(--text-primary)' }}>
              {focusHours}h {remainingFocusMinutes}m
            </div>
            <div style={{ fontSize: '11.5px', color: 'var(--text-muted)', marginTop: '4px' }}>
              Across {currentReport?.sessionCount ?? 0} session(s) on {formatDisplayDate(selectedDate)}
            </div>
          </div>
        </div>

        {/* Break / Pause Time */}
        <div className="col-4">
          <div className="card" style={{ padding: '16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
              <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Break / Pause Time</span>
              <Coffee size={16} style={{ color: 'var(--status-amber, #f59e0b)' }} />
            </div>
            <div style={{ fontSize: '24px', fontWeight: 700, color: 'var(--text-primary)' }}>
              {pauseMinutes}m
            </div>
            <div style={{ fontSize: '11.5px', color: 'var(--text-muted)', marginTop: '4px' }}>
              Accurately deducted from focus duration
            </div>
          </div>
        </div>

        {/* Inactive / Idle Time (Privacy-Gated) */}
        <div className="col-4">
          <div className="card" style={{ padding: '16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
              <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Inactive / Idle Time</span>
              <Hourglass size={16} style={{ color: 'var(--text-muted)' }} />
            </div>
            <div style={{ fontSize: '24px', fontWeight: 700, color: 'var(--text-primary)' }}>
              {preferences.activityTrackingEnabled ? `${idleMinutes}m` : 'Disabled'}
            </div>
            <div style={{ fontSize: '11.5px', color: 'var(--text-muted)', marginTop: '4px' }}>
              {preferences.activityTrackingEnabled
                ? 'Detected from companion telemetry'
                : 'Activity tracking is turned off'}
            </div>
          </div>
        </div>

        {/* Total Tracked Time */}
        <div className="col-4">
          <div className="card" style={{ padding: '16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
              <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Total Tracked Time</span>
              <Activity size={16} style={{ color: 'var(--accent-primary)' }} />
            </div>
            <div style={{ fontSize: '24px', fontWeight: 700, color: 'var(--text-primary)' }}>
              {trackedHours}h {remainingTrackedMinutes}m
            </div>
            <div style={{ fontSize: '11.5px', color: 'var(--text-muted)', marginTop: '4px' }}>
              Focus + Pauses + Permitted Idles
            </div>
          </div>
        </div>

        {/* Tasks Accomplished */}
        <div className="col-4">
          <div className="card" style={{ padding: '16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
              <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Tasks Accomplished</span>
              <CheckCircle2 size={16} style={{ color: 'var(--status-green)' }} />
            </div>
            <div style={{ fontSize: '24px', fontWeight: 700, color: 'var(--text-primary)' }}>
              {currentReport?.tasksCompletedCount ?? 0}
            </div>
            <div style={{ fontSize: '11.5px', color: 'var(--text-muted)', marginTop: '4px' }}>
              {currentReport?.tasksCreatedCount ?? 0} created today &bull; {currentReport?.outstandingTasksCount ?? 0} in progress
            </div>
          </div>
        </div>

        {/* Engine Status */}
        <div className="col-4">
          <div className="card" style={{ padding: '16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
              <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Synthesis Engine</span>
              <Cpu size={16} style={{ color: 'var(--accent-primary)' }} />
            </div>
            <div style={{ fontSize: '15px', fontWeight: 600, color: 'var(--text-primary)', textTransform: 'capitalize' }}>
              Deterministic Engine
            </div>
            <div style={{ fontSize: '11.5px', color: 'var(--text-muted)', marginTop: '4px' }}>
              {user ? 'Cloud Workspace Synced' : '100% Offline / Private'}
            </div>
          </div>
        </div>
      </div>

      {/* Project Breakdown Card */}
      <div className="card">
        <div className="card-header" style={{ paddingBottom: '12px' }}>
          <div className="card-title-group">
            <Folder className="card-icon" style={{ color: 'var(--accent-primary)' }} />
            <div>
              <h3 className="card-title">Project Time Distribution</h3>
              <p className="card-subtitle">Verified time distribution for {formatDisplayDate(selectedDate)}</p>
            </div>
          </div>
        </div>

        {currentReport && currentReport.projectBreakdown.length > 0 ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '12px' }}>
            {currentReport.projectBreakdown.map((p) => {
              const pct = currentReport.totalFocusSeconds > 0
                ? Math.min(100, Math.round((p.activeSeconds / currentReport.totalFocusSeconds) * 100))
                : 0;
              return (
                <div
                  key={p.projectId || p.project}
                  style={{
                    backgroundColor: 'var(--bg-card-subtle)',
                    padding: '12px',
                    borderRadius: 'var(--radius-sm)',
                    border: '1px solid var(--border-subtle)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '6px',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <strong style={{ fontSize: '13px', color: 'var(--text-primary)' }}>{p.project}</strong>
                    <span style={{ fontSize: '11.5px', color: 'var(--accent-primary)', fontWeight: 600 }}>
                      {p.minutes}m ({pct}%)
                    </span>
                  </div>
                  <div style={{ width: '100%', height: '5px', backgroundColor: 'var(--border-subtle)', borderRadius: '3px', overflow: 'hidden' }}>
                    <div style={{ width: `${pct}%`, height: '100%', backgroundColor: 'var(--accent-primary)' }} />
                  </div>
                  <div style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span>{p.sessionCount} session(s)</span>
                    <span>{p.completedTasksCount} task(s) done</span>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div style={{ fontSize: '12.5px', color: 'var(--text-muted)', padding: '8px 0' }}>
            No project focus sessions were logged for this date.
          </div>
        )}
      </div>

      {/* Task Completion Breakdown Card */}
      <div className="card">
        <div className="card-header" style={{ paddingBottom: '12px' }}>
          <div className="card-title-group">
            <CheckSquare className="card-icon" style={{ color: 'var(--accent-primary)' }} />
            <div>
              <h3 className="card-title">Tasks Worked On &amp; Status</h3>
              <p className="card-subtitle">Tasks associated with work sessions or completed on {formatDisplayDate(selectedDate)}</p>
            </div>
          </div>
        </div>

        {currentReport && currentReport.taskBreakdown.length > 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {currentReport.taskBreakdown.map((t) => {
              const taskMinutes = Math.round(t.timeSpentSeconds / 60);

              let priorityColor = 'var(--text-muted)';
              let priorityBg = 'rgba(107, 114, 128, 0.12)';
              if (t.priority === 'urgent') {
                priorityColor = 'var(--status-red, #ef4444)';
                priorityBg = 'rgba(239, 68, 68, 0.12)';
              } else if (t.priority === 'high') {
                priorityColor = 'var(--status-amber, #f59e0b)';
                priorityBg = 'rgba(245, 158, 11, 0.12)';
              } else if (t.priority === 'medium') {
                priorityColor = 'var(--accent-primary, #3b82f6)';
                priorityBg = 'rgba(59, 130, 246, 0.12)';
              }

              return (
                <div
                  key={t.taskId}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '10px 14px',
                    backgroundColor: 'var(--bg-card-subtle)',
                    border: '1px solid var(--border-subtle)',
                    borderRadius: 'var(--radius-sm)',
                    flexWrap: 'wrap',
                    gap: '8px',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: '220px' }}>
                    {t.completed ? (
                      <CheckCircle2 size={16} style={{ color: 'var(--status-green)', flexShrink: 0 }} />
                    ) : (
                      <Circle size={16} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
                    )}
                    <div>
                      <div
                        style={{
                          fontSize: '13px',
                          fontWeight: 500,
                          color: 'var(--text-primary)',
                          textDecoration: t.completed ? 'line-through' : 'none',
                        }}
                      >
                        {t.title}
                      </div>
                      <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                        {t.projectName}
                      </div>
                    </div>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span
                      style={{
                        fontSize: '10.5px',
                        fontWeight: 600,
                        padding: '2px 6px',
                        borderRadius: '4px',
                        backgroundColor: priorityBg,
                        color: priorityColor,
                        textTransform: 'uppercase',
                      }}
                    >
                      {t.priority}
                    </span>

                    {taskMinutes > 0 && (
                      <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--accent-primary)' }}>
                        {taskMinutes}m logged
                      </span>
                    )}

                    <span
                      className={`badge ${t.completed ? 'badge-active' : 'badge-neutral'}`}
                      style={{ fontSize: '10.5px' }}
                    >
                      {t.completed ? 'Completed' : 'In Progress'}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div style={{ fontSize: '12.5px', color: 'var(--text-muted)', padding: '8px 0' }}>
            No task progress was recorded for this date.
          </div>
        )}
      </div>

      {/* Work Session Timeline Card */}
      <div className="card">
        <div className="card-header" style={{ paddingBottom: '12px' }}>
          <div className="card-title-group">
            <Clock className="card-icon" style={{ color: 'var(--accent-primary)' }} />
            <div>
              <h3 className="card-title">Work Session Timeline</h3>
              <p className="card-subtitle">Chronological record of focus sessions on {formatDisplayDate(selectedDate)}</p>
            </div>
          </div>
        </div>

        {currentReport && currentReport.sessions.length > 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {currentReport.sessions.map((sess, idx) => {
              const sessMinutes = Math.round(sess.activeSeconds / 60);
              const sessPauseMinutes = Math.round(sess.pausedSeconds / 60);
              const startFormatted = formatTimeOnly(sess.startedAt);
              const endFormatted = sess.endedAt ? formatTimeOnly(sess.endedAt) : 'In progress';

              return (
                <div
                  key={sess.id || idx}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '10px 14px',
                    backgroundColor: 'var(--bg-card-subtle)',
                    border: '1px solid var(--border-subtle)',
                    borderRadius: 'var(--radius-sm)',
                    flexWrap: 'wrap',
                    gap: '8px',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <div
                      style={{
                        padding: '4px 8px',
                        borderRadius: 'var(--radius-sm)',
                        backgroundColor: 'var(--bg-card)',
                        border: '1px solid var(--border-subtle)',
                        fontSize: '11px',
                        fontFamily: 'monospace',
                        color: 'var(--text-secondary)',
                      }}
                    >
                      {startFormatted} &ndash; {endFormatted}
                    </div>

                    <div>
                      <div style={{ fontSize: '13px', fontWeight: 500, color: 'var(--text-primary)' }}>
                        {sess.title}
                      </div>
                      <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                        Project: {sess.projectName} {sess.taskTitle ? `| Task: ${sess.taskTitle}` : ''}
                      </div>
                    </div>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <span style={{ fontSize: '12.5px', fontWeight: 600, color: 'var(--accent-primary)' }}>
                      {sessMinutes}m focus
                    </span>

                    {sessPauseMinutes > 0 && (
                      <span style={{ fontSize: '11px', color: 'var(--status-amber, #f59e0b)' }}>
                        ({sessPauseMinutes}m paused)
                      </span>
                    )}

                    <span
                      style={{
                        fontSize: '10.5px',
                        padding: '2px 6px',
                        borderRadius: '4px',
                        backgroundColor: 'var(--bg-card)',
                        border: '1px solid var(--border-subtle)',
                        color: 'var(--text-muted)',
                        textTransform: 'capitalize',
                      }}
                    >
                      {sess.source}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div style={{ fontSize: '12.5px', color: 'var(--text-muted)', padding: '8px 0' }}>
            No focus sessions were recorded on this date.
          </div>
        )}
      </div>

      {/* Main Narrative Report Card */}
      <div className="card">
        <div className="card-header">
          <div className="card-title-group">
            <Bot className="card-icon" style={{ color: 'var(--accent-primary)' }} />
            <div>
              <h3 className="card-title">Kuro&apos;s Daily Reflection</h3>
              <p className="card-subtitle">
                {currentReport?.updatedAt
                  ? `Report synthesized for ${formatDisplayDate(selectedDate)}${currentReport.reportingTimeZone ? ` (${currentReport.reportingTimeZone})` : ''}`
                  : `Report for ${formatDisplayDate(selectedDate)}`}
              </p>
            </div>
          </div>

          <span className="badge badge-neutral" style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
            <Cpu size={11} />
            <span>Deterministic Verified Report</span>
          </span>
        </div>

        {/* Narrative Content */}
        <div
          style={{
            fontSize: '13.5px',
            lineHeight: 1.65,
            color: 'var(--text-primary)',
            padding: '16px',
            backgroundColor: 'var(--bg-card-subtle)',
            borderRadius: 'var(--radius-md)',
            border: '1px solid var(--border-subtle)',
            whiteSpace: 'pre-line',
          }}
        >
          {currentReport?.aiNarrative || 'No focus activity recorded on this date.'}
        </div>

        {/* Disclosure Notice */}
        <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '8px', fontStyle: 'italic' }}>
          * The narrative above is synthesized from your verified session metadata. Quantitative duration figures are directly calculated from database records and normalized timer intervals.
        </div>

        {/* Recommendations / Actionable Suggestions Grid */}
        {currentReport && currentReport.actionableSuggestions.length > 0 && (
          <div style={{ marginTop: '20px' }}>
            <h4
              style={{
                fontSize: '13px',
                fontWeight: 600,
                marginBottom: '10px',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                color: 'var(--text-primary)',
              }}
            >
              <Lightbulb size={15} style={{ color: 'var(--status-amber, #f59e0b)' }} />
              Kuro&apos;s Actionable Suggestions for Tomorrow
            </h4>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {currentReport.actionableSuggestions.map((rec) => (
                <div
                  key={rec}
                  style={{
                    padding: '10px 12px',
                    backgroundColor: 'var(--bg-card-subtle)',
                    borderRadius: 'var(--radius-sm)',
                    border: '1px solid var(--border-subtle)',
                    fontSize: '12.5px',
                    color: 'var(--text-secondary)',
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: '8px',
                  }}
                >
                  <span style={{ color: 'var(--status-amber, #f59e0b)', fontWeight: 'bold' }}>&bull;</span>
                  <span>{rec}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
