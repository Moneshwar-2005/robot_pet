/**
 * Kuro Daily Productivity Summary Engine
 *
 * Scope: Phase 4, Step 4.3
 *
 * Synthesizes validated daily work sessions and task progress into:
 * 1. Measured quantitative metrics (exact durations, project & IDE breakdowns).
 * 2. Deterministic baseline reflection (100% offline, zero-LLM fallback).
 * 3. Local AI synthesis (via local Ollama or on-device WebLLM).
 *
 * PRIVACY GUARANTEES:
 * - Uses only approved session metadata and task titles.
 * - Never uploads raw process data, code files, or telemetry.
 * - Explicit user-triggered generation only (no background AI polling).
 */

import type { ClientWorkSession } from '../adapters';
import type { Task } from '../../types';
import type { AIProvider } from './types';

export interface DailyProjectMetric {
  readonly project: string;
  readonly minutes: number;
  readonly sessionCount: number;
  readonly ides: string[];
}

export interface DailyIdeMetric {
  readonly ide: string;
  readonly minutes: number;
  readonly sessionCount: number;
}

export interface DailyMetrics {
  readonly date: string; // YYYY-MM-DD
  readonly displayDate: string; // e.g. "Sunday, Oct 25, 2026"
  readonly totalFocusMinutes: number;
  readonly totalSessionsCount: number;
  readonly projectBreakdown: DailyProjectMetric[];
  readonly ideBreakdown: DailyIdeMetric[];
  readonly completedTasks: Task[];
  readonly pendingTasks: Task[];
  readonly hasIncompleteData: boolean;
  readonly rawSessions: ClientWorkSession[];
}

export interface DailySummaryResult {
  readonly date: string;
  readonly narrative: string;
  readonly recommendations: string[];
  readonly isAiGenerated: boolean;
  readonly providerId?: string;
  readonly providerName?: string;
  readonly modelUsed?: string;
  readonly fallbackReason?: string;
  readonly generatedAt: string;
  readonly metrics: DailyMetrics;
}

export function formatYMD(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function formatDisplayDate(dateStr: string): string {
  try {
    const [y, m, d] = dateStr.split('-').map(Number);
    const date = new Date(y, m - 1, d);
    return date.toLocaleDateString(undefined, {
      weekday: 'long',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  } catch {
    return dateStr;
  }
}

/**
 * Parses project and IDE from session title format:
 * "Antigravity IDE: smart-pet-assistant-web" or "Visual Studio Code: project-x"
 */
export function parseSessionTitle(title: string): { ide: string; project: string } {
  if (!title) return { ide: 'General', project: 'General Workspace' };

  if (title.includes(':')) {
    const [idePart, projPart] = title.split(':');
    return {
      ide: idePart.trim() || 'General',
      project: projPart.trim() || 'General Workspace',
    };
  }

  return { ide: 'General', project: title.trim() };
}

/**
 * Aggregates work sessions and task progress for a specific calendar date.
 */
export function aggregateDailyMetrics(
  targetDate: string,
  sessions: ClientWorkSession[] = [],
  tasks: Task[] = []
): DailyMetrics {
  // Filter sessions that started on targetDate (YYYY-MM-DD)
  const daySessions = sessions.filter((s: any) => {
    const rawStarted = s.startedAt || s.started_at;
    if (!rawStarted) return false;
    try {
      const sDate = new Date(rawStarted);
      return formatYMD(sDate) === targetDate;
    } catch {
      return false;
    }
  });

  let totalFocusMinutes = 0;
  const projectMap: Record<string, { minutes: number; sessionCount: number; ides: Set<string> }> = {};
  const ideMap: Record<string, { minutes: number; sessionCount: number }> = {};
  let hasIncompleteData = daySessions.length === 0;

  for (const s of (daySessions as any[])) {
    const rawMins = s.durationMinutes ?? s.duration_minutes;
    const mins = Math.max(1, Math.round(Number(rawMins) || 1));
    totalFocusMinutes += mins;

    const { ide, project } = parseSessionTitle(s.title);

    // Project breakdown
    if (!projectMap[project]) {
      projectMap[project] = { minutes: 0, sessionCount: 0, ides: new Set() };
    }
    projectMap[project].minutes += mins;
    projectMap[project].sessionCount += 1;
    projectMap[project].ides.add(ide);

    // IDE breakdown
    if (!ideMap[ide]) {
      ideMap[ide] = { minutes: 0, sessionCount: 0 };
    }
    ideMap[ide].minutes += mins;
    ideMap[ide].sessionCount += 1;

    const isCompleted = s.completedAt !== undefined ? !!s.completedAt : (s.is_completed ?? true);
    if (project === 'General Workspace' || !isCompleted) {
      hasIncompleteData = true;
    }
  }

  const projectBreakdown: DailyProjectMetric[] = Object.entries(projectMap)
    .map(([project, data]) => ({
      project,
      minutes: data.minutes,
      sessionCount: data.sessionCount,
      ides: Array.from(data.ides),
    }))
    .sort((a, b) => b.minutes - a.minutes);

  const ideBreakdown: DailyIdeMetric[] = Object.entries(ideMap)
    .map(([ide, data]) => ({
      ide,
      minutes: data.minutes,
      sessionCount: data.sessionCount,
    }))
    .sort((a, b) => b.minutes - a.minutes);

  // Filter tasks completed or currently pending
  const completedTasks = tasks.filter((t) => t.completed);
  const pendingTasks = tasks.filter((t) => !t.completed);

  return {
    date: targetDate,
    displayDate: formatDisplayDate(targetDate),
    totalFocusMinutes,
    totalSessionsCount: daySessions.length,
    projectBreakdown,
    ideBreakdown,
    completedTasks,
    pendingTasks,
    hasIncompleteData,
    rawSessions: daySessions,
  };
}

/**
 * Builds a deterministic, verified summary from local metrics without needing an LLM.
 */
export function generateDeterministicSummary(
  metrics: DailyMetrics,
  fallbackReason?: string
): DailySummaryResult {
  const hours = Math.floor(metrics.totalFocusMinutes / 60);
  const remainingMins = metrics.totalFocusMinutes % 60;
  const timeString = hours > 0 ? `${hours}h ${remainingMins}m` : `${remainingMins} minutes`;

  const topProject = metrics.projectBreakdown[0];
  const topIde = metrics.ideBreakdown[0];

  let narrative = '';

  if (metrics.totalSessionsCount === 0) {
    narrative = `No focused work sessions were logged for ${metrics.displayDate}. Any active tasks remain available in your task queue.`;
  } else {
    narrative = `On ${metrics.displayDate}, you completed ${timeString} of focused development across ${metrics.totalSessionsCount} recorded session(s). `;

    if (topProject) {
      narrative += `Your primary focus was on "${topProject.project}" with ${topProject.minutes} minute(s) of activity`;
      if (topIde && topIde.ide !== 'General') {
        narrative += ` primarily utilizing ${topIde.ide}.`;
      } else {
        narrative += '.';
      }
    }

    if (metrics.completedTasks.length > 0) {
      narrative += ` You accomplished ${metrics.completedTasks.length} task(s), including "${metrics.completedTasks[0].title}".`;
    }

    if (metrics.pendingTasks.length > 0) {
      narrative += ` There are currently ${metrics.pendingTasks.length} outstanding task(s) remaining in your project backlog.`;
    }
  }

  const recommendations: string[] = [];

  if (metrics.totalFocusMinutes >= 180) {
    recommendations.push('High deep-work duration logged today — ensure you schedule ergonomic recovery and ocular rest.');
  } else if (metrics.totalFocusMinutes > 0 && metrics.totalFocusMinutes < 60) {
    recommendations.push('Consider scheduling a dedicated 45-minute focus block tomorrow to maintain forward momentum.');
  }

  const highPriorityPending = metrics.pendingTasks.find((t) => t.priority === 'high' || t.priority === 'urgent');
  if (highPriorityPending) {
    recommendations.push(`Priority focus for tomorrow: Tackle outstanding task "${highPriorityPending.title}".`);
  } else if (metrics.pendingTasks.length > 0) {
    recommendations.push(`Next in queue: Advance task "${metrics.pendingTasks[0].title}".`);
  } else {
    recommendations.push('All scheduled tasks are up to date. Excellent sprint progress!');
  }

  if (metrics.hasIncompleteData && metrics.totalSessionsCount > 0) {
    recommendations.push('Tip: Label open workspaces clearly in your IDE so Kuro can capture exact project breakdowns.');
  }

  return {
    date: metrics.date,
    narrative,
    recommendations,
    isAiGenerated: false,
    providerId: 'deterministic',
    providerName: 'Deterministic Engine (Offline)',
    fallbackReason,
    generatedAt: new Date().toISOString(),
    metrics,
  };
}

/**
 * Generates an end-of-day summary using the active local AI provider (Ollama / WebLLM).
 * Gracefully falls back to deterministic summary if AI is offline or encounters errors.
 */
export async function generateAiDailySummary(
  metrics: DailyMetrics,
  provider?: AIProvider | null,
  model?: string,
  signal?: AbortSignal
): Promise<DailySummaryResult> {
  if (!provider) {
    return generateDeterministicSummary(metrics, 'No local AI provider available');
  }

  // 1. Probe provider availability
  let activeModel = model;
  try {
    const status = await provider.checkStatus();
    if (status.state !== 'connected' && (!provider.isModelLoaded || provider.lifecycleState !== 'ready')) {
      return generateDeterministicSummary(
        metrics,
        `Local AI (${provider.name}) is currently ${status.state}. Displaying verified deterministic summary.`
      );
    }
    if (!activeModel && status.activeModel) {
      activeModel = status.activeModel;
    }
  } catch (err: unknown) {
    return generateDeterministicSummary(
      metrics,
      `Could not connect to ${provider.name}: ${err instanceof Error ? err.message : 'Offline'}`
    );
  }

  // 2. Format concise, privacy-respecting prompt
  const hours = Math.floor(metrics.totalFocusMinutes / 60);
  const mins = metrics.totalFocusMinutes % 60;
  const timeStr = `${hours}h ${mins}m`;

  const projectListStr = metrics.projectBreakdown
    .map((p) => `- Project "${p.project}": ${p.minutes} mins (IDEs: ${p.ides.join(', ') || 'N/A'})`)
    .join('\n') || '- None recorded';

  const completedTasksStr = metrics.completedTasks
    .slice(0, 5)
    .map((t) => `- [Completed] ${t.title}`)
    .join('\n') || '- None';

  const pendingTasksStr = metrics.pendingTasks
    .slice(0, 5)
    .map((t) => `- [Pending - Priority ${t.priority}] ${t.title}`)
    .join('\n') || '- None';

  const systemPrompt = `You are Kuro, an encouraging, intelligent personal robot pet and desktop assistant.
Synthesize an end-of-day daily work summary based STRICTLY on the user's verified session metrics below.
Format your answer with two distinct parts:
1. "NARRATIVE:": A warm, concise 2-paragraph reflection summarizing the day's focus time, top projects, and accomplishments.
2. "RECOMMENDATIONS:": 2 or 3 bullet points with realistic, actionable suggestions for tomorrow based on pending tasks.
DO NOT fabricate tasks, project names, or durations not listed in the input.`;

  const userPrompt = `Date: ${metrics.displayDate}
Total Focus Time: ${timeStr} across ${metrics.totalSessionsCount} session(s)
Projects & IDEs:
${projectListStr}

Tasks Completed:
${completedTasksStr}

Tasks Outstanding:
${pendingTasksStr}

Please generate the daily summary.`;

  try {
    let accumulatedContent = '';

    const streamResult = await provider.sendChatStream({
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      model: activeModel,
      signal,
      timeoutMs: 30000,
      options: {
        temperature: 0.6,
        maxTokens: 500,
      },
      onChunk: (_delta, acc) => {
        accumulatedContent = acc;
      },
    });

    const fullText = (streamResult.content || accumulatedContent).trim();
    if (!fullText) {
      return generateDeterministicSummary(metrics, 'AI generated an empty response.');
    }

    // Parse narrative and recommendations from AI output
    let narrative = fullText;
    const recommendations: string[] = [];

    if (fullText.includes('RECOMMENDATIONS:')) {
      const parts = fullText.split('RECOMMENDATIONS:');
      narrative = parts[0].replace('NARRATIVE:', '').trim();
      const recsText = parts[1].trim();
      const lines = recsText.split('\n');
      for (const line of lines) {
        const clean = line.replace(/^[-*•\d.]\s*/, '').trim();
        if (clean) {
          recommendations.push(clean);
        }
      }
    } else if (fullText.includes('NARRATIVE:')) {
      narrative = fullText.replace('NARRATIVE:', '').trim();
    }

    if (recommendations.length === 0) {
      // Add sensible defaults if AI didn't format bullet section
      const topPending = metrics.pendingTasks[0];
      if (topPending) {
        recommendations.push(`Next in queue: Advance "${topPending.title}".`);
      }
      recommendations.push('Review tomorrow morning priorities during your first focus session.');
    }

    return {
      date: metrics.date,
      narrative,
      recommendations: recommendations.slice(0, 4),
      isAiGenerated: true,
      providerId: provider.id,
      providerName: provider.name,
      modelUsed: streamResult.modelUsed || model || 'local',
      generatedAt: new Date().toISOString(),
      metrics,
    };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : 'AI generation error';
    return generateDeterministicSummary(
      metrics,
      `Local AI generation encountered an error (${errorMsg}). Showing verified deterministic summary.`
    );
  }
}
