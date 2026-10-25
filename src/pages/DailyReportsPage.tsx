import React, { useState, useMemo, useCallback, useRef } from 'react';
import type { ClientWorkSession } from '../lib/adapters';
import type { Task } from '../types';
import {
  aggregateDailyMetrics,
  generateDeterministicSummary,
  generateAiDailySummary,
  formatYMD,
  type DailySummaryResult,
} from '../lib/ai/dailySummary';
import { getProvider, getSavedProviderId } from '../lib/ai/providerRegistry';
import { useDesktopCompanion } from '../hooks/useDesktopCompanion';
import {
  Sparkles,
  Calendar,
  CheckCircle2,
  Lightbulb,
  Clock,
  Folder,
  Loader2,
  RotateCcw,
  Bot,
  AlertCircle,
  Monitor,
  Cpu,
} from 'lucide-react';

function getTodayYMD(): string {
  return formatYMD(new Date());
}

function getYesterdayYMD(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return formatYMD(d);
}

export interface DailyReportsPageProps {
  sessions?: ClientWorkSession[];
  tasks?: Task[];
}

export const DailyReportsPage: React.FC<DailyReportsPageProps> = ({
  sessions = [],
  tasks = [],
}) => {
  const [selectedDate, setSelectedDate] = useState<string>(() => getTodayYMD());
  const [aiSummaryResult, setAiSummaryResult] = useState<DailySummaryResult | null>(null);
  const [isGenerating, setIsGenerating] = useState<boolean>(false);

  const abortControllerRef = useRef<AbortController | null>(null);

  // Companion status for live local session awareness
  const { connectionState, recentSessions } = useDesktopCompanion();

  // Combine Kuro work sessions with any completed companion sessions for today
  const combinedSessions = useMemo(() => {
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

  // Aggregate metrics for selected date
  const metrics = useMemo(() => {
    return aggregateDailyMetrics(selectedDate, combinedSessions, tasks);
  }, [selectedDate, combinedSessions, tasks]);

  // Pure declarative fallback summary
  const deterministicSummary = useMemo(() => {
    return generateDeterministicSummary(metrics);
  }, [metrics]);

  // Active summary: prefer generated AI summary if for selectedDate, else deterministic
  const activeSummary = useMemo(() => {
    if (aiSummaryResult && aiSummaryResult.date === selectedDate) {
      return aiSummaryResult;
    }
    return deterministicSummary;
  }, [aiSummaryResult, selectedDate, deterministicSummary]);

  // Handle generation
  const handleGenerateSummary = useCallback(
    async (forceAi = true) => {
      setIsGenerating(true);

      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      const controller = new AbortController();
      abortControllerRef.current = controller;

      try {
        if (!forceAi) {
          setAiSummaryResult(null);
          return;
        }

        const activeProviderId = getSavedProviderId();
        const provider = getProvider(activeProviderId);

        const result = await generateAiDailySummary(
          metrics,
          provider,
          undefined,
          controller.signal
        );
        setAiSummaryResult(result);
      } catch (err: unknown) {
        if (err instanceof Error && err.name === 'AbortError') return;
        const fallback = generateDeterministicSummary(
          metrics,
          err instanceof Error ? err.message : 'AI generation error'
        );
        setAiSummaryResult(fallback);
      } finally {
        setIsGenerating(false);
      }
    },
    [metrics]
  );

  const activeProviderId = getSavedProviderId();
  const provider = getProvider(activeProviderId);

  const todayStr = useMemo(() => getTodayYMD(), []);
  const yesterdayStr = useMemo(() => getYesterdayYMD(), []);

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
        </div>

        {/* Generate / Refresh Actions */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => void handleGenerateSummary(false)}
            disabled={isGenerating}
            style={{ padding: '6px 12px', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '6px' }}
            title="Generate deterministic report without AI"
          >
            <RotateCcw size={13} />
            <span>Quick Metadata</span>
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => void handleGenerateSummary(true)}
            disabled={isGenerating}
            style={{ padding: '6px 14px', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '6px' }}
            title={`Synthesize end-of-day summary using local ${provider.name}`}
          >
            {isGenerating ? (
              <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} />
            ) : (
              <Sparkles size={13} />
            )}
            <span>{isGenerating ? 'Synthesizing...' : 'Generate AI Summary'}</span>
          </button>
        </div>
      </div>

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

      {/* Verified Quantitative Metrics Cards */}
      <div className="dashboard-grid">
        {/* Total Focus Time */}
        <div className="col-4">
          <div className="card" style={{ padding: '16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
              <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Total Focus Time</span>
              <Clock size={16} style={{ color: 'var(--accent-primary)' }} />
            </div>
            <div style={{ fontSize: '24px', fontWeight: 700, color: 'var(--text-primary)' }}>
              {Math.floor(metrics.totalFocusMinutes / 60)}h {metrics.totalFocusMinutes % 60}m
            </div>
            <div style={{ fontSize: '11.5px', color: 'var(--text-muted)', marginTop: '4px' }}>
              Across {metrics.totalSessionsCount} session(s) on {metrics.displayDate}
            </div>
          </div>
        </div>

        {/* Task Progress */}
        <div className="col-4">
          <div className="card" style={{ padding: '16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
              <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Tasks Accomplished</span>
              <CheckCircle2 size={16} style={{ color: 'var(--status-green)' }} />
            </div>
            <div style={{ fontSize: '24px', fontWeight: 700, color: 'var(--text-primary)' }}>
              {metrics.completedTasks.length}
            </div>
            <div style={{ fontSize: '11.5px', color: 'var(--text-muted)', marginTop: '4px' }}>
              {metrics.pendingTasks.length} task(s) currently outstanding
            </div>
          </div>
        </div>

        {/* AI Engine Status */}
        <div className="col-4">
          <div className="card" style={{ padding: '16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
              <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Local AI Engine</span>
              <Cpu size={16} style={{ color: 'var(--accent-primary)' }} />
            </div>
            <div style={{ fontSize: '15px', fontWeight: 600, color: 'var(--text-primary)', textTransform: 'capitalize' }}>
              {activeSummary.isAiGenerated ? activeSummary.providerName : 'Deterministic Engine'}
            </div>
            <div style={{ fontSize: '11.5px', color: 'var(--text-muted)', marginTop: '4px' }}>
              {activeSummary.modelUsed ? `Model: ${activeSummary.modelUsed}` : '100% Offline / Private'}
            </div>
          </div>
        </div>
      </div>

      {/* Project & Tooling Breakdown */}
      {metrics.projectBreakdown.length > 0 && (
        <div className="card">
          <div className="card-header" style={{ paddingBottom: '12px' }}>
            <div className="card-title-group">
              <Folder className="card-icon" style={{ color: 'var(--accent-primary)' }} />
              <div>
                <h3 className="card-title">Project &amp; IDE Breakdown</h3>
                <p className="card-subtitle">Verified time distribution for {metrics.displayDate}</p>
              </div>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '10px' }}>
            {metrics.projectBreakdown.map((p) => {
              const pct = metrics.totalFocusMinutes > 0 ? Math.round((p.minutes / metrics.totalFocusMinutes) * 100) : 0;
              return (
                <div
                  key={p.project}
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
                  <div style={{ width: '100%', height: '4px', backgroundColor: 'var(--border-subtle)', borderRadius: '2px', overflow: 'hidden' }}>
                    <div style={{ width: `${pct}%`, height: '100%', backgroundColor: 'var(--accent-primary)' }} />
                  </div>
                  <div style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <span>{p.sessionCount} session(s)</span>
                    {p.ides.length > 0 && <span>&bull; {p.ides.join(', ')}</span>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Main Narrative Report Card */}
      <div className="card">
        <div className="card-header">
          <div className="card-title-group">
            <Bot className="card-icon" style={{ color: 'var(--accent-primary)' }} />
            <div>
              <h3 className="card-title">Kuro&apos;s Daily Reflection</h3>
              <p className="card-subtitle">
                {activeSummary.generatedAt
                  ? `Synthesized at ${new Date(activeSummary.generatedAt).toLocaleTimeString()} for ${metrics.displayDate}`
                  : `Report for ${metrics.displayDate}`}
              </p>
            </div>
          </div>

          {/* Badge Distinguishing Source */}
          {activeSummary.isAiGenerated ? (
            <span className="badge badge-active" style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
              <Sparkles size={11} />
              <span>Local AI ({activeSummary.modelUsed || activeSummary.providerName})</span>
            </span>
          ) : (
            <span className="badge badge-neutral" style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
              <Cpu size={11} />
              <span>Deterministic Metadata Summary</span>
            </span>
          )}
        </div>

        {/* Fallback Notice if AI was unavailable */}
        {activeSummary.fallbackReason && (
          <div
            style={{
              padding: '8px 12px',
              backgroundColor: 'rgba(234, 179, 8, 0.08)',
              border: '1px solid rgba(234, 179, 8, 0.25)',
              borderRadius: 'var(--radius-sm)',
              fontSize: '11.5px',
              color: 'var(--status-yellow)',
              marginBottom: '14px',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            <AlertCircle size={13} style={{ flexShrink: 0 }} />
            <span>{activeSummary.fallbackReason}</span>
          </div>
        )}

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
          {activeSummary.narrative}
        </div>

        {/* Disclosure Notice distinguishing generated text vs measured metrics */}
        <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '8px', fontStyle: 'italic' }}>
          * The narrative above is synthesized from your approved session metadata. Quantitative duration figures are directly calculated from verified local logs.
        </div>

        {/* Recommendations Grid */}
        {activeSummary.recommendations.length > 0 && (
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
              <Lightbulb size={15} style={{ color: 'var(--status-amber)' }} />
              Kuro&apos;s Actionable Suggestions for Tomorrow
            </h4>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {activeSummary.recommendations.map((rec) => (
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
                  <span style={{ color: 'var(--status-amber)', fontWeight: 'bold' }}>&bull;</span>
                  <span>{rec}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Empty State message */}
        {metrics.totalSessionsCount === 0 && (
          <div
            style={{
              padding: '14px',
              backgroundColor: 'var(--bg-card-subtle)',
              border: '1px solid var(--border-subtle)',
              borderRadius: 'var(--radius-sm)',
              fontSize: '12px',
              color: 'var(--text-muted)',
              marginTop: '16px',
            }}
          >
            <strong>Note:</strong> No focus sessions were recorded on {metrics.displayDate}. To record activity, start a timer in Work Tracking or turn on IDE Activity Tracking in Settings &gt; Windows Desktop Companion.
          </div>
        )}

        {/* Incomplete Data warning */}
        {metrics.hasIncompleteData && metrics.totalSessionsCount > 0 && (
          <div
            style={{
              padding: '8px 12px',
              backgroundColor: 'var(--bg-card-subtle)',
              borderRadius: 'var(--radius-sm)',
              border: '1px solid var(--border-subtle)',
              fontSize: '11px',
              color: 'var(--text-muted)',
              marginTop: '12px',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            <AlertCircle size={12} />
            <span>Some sessions had unassigned projects or were reconstructed after a companion restart.</span>
          </div>
        )}
      </div>
    </div>
  );
};
