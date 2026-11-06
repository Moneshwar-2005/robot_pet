/**
 * Kuro Daily Productivity Reports & Work Summaries Engine
 *
 * Scope: Phase 10 Milestone 5 Hardening (Step 10.6.2)
 *
 * Responsibilities:
 * 1. Clips sessions, pauses, idles, and open timer intervals strictly to half-open day intervals [dayStart, dayEnd).
 * 2. Standardizes timezone reporting with accurate local midnight calculations and daylight-saving transition support (23h/25h days).
 * 3. Accurately counts created tasks (based on createdAt) and completed tasks (based on verified completedAt).
 * 4. Reconciles non-work intervals using computeIntervalUnion() so totalTrackedSeconds never exceeds wall-clock elapsed time.
 * 5. Deduplicates legacy work_sessions against normalized time_entries using interval subtraction.
 * 6. Preserves reporting timezone in application_breakdown metadata without database schema changes.
 * 7. Eliminates unconditional inclusion of undated tasks from historical reports.
 */

import type {
  TimeEntry,
  TimeEntryPause,
  TimeEntryIdle,
  Task,
  Project,
  DailyReport,
  DailyReportProjectBreakdown,
  DailyReportTaskBreakdown,
  DailyReportSessionItem,
} from '../types';
import type { ClientWorkSession } from './adapters';
import type { OutboxOperation } from '../types/sync';
import {
  computeIntervalUnion,
  type TimeInterval,
} from './timerCalculations.ts';
export { computeIntervalUnion, type TimeInterval };
import { generateDailyReportId } from './uuidv5.ts';

/**
 * Returns a valid IANA timezone string, prioritizing configured timezone or browser environment.
 */
export function resolveReportingTimeZone(configuredTimeZone?: string | null): string {
  if (configuredTimeZone && typeof configuredTimeZone === 'string') {
    try {
      Intl.DateTimeFormat(undefined, { timeZone: configuredTimeZone });
      return configuredTimeZone;
    } catch {}
  }
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

/**
 * Calculates the exact UTC millisecond epoch timestamp when local midnight begins on dateStr in timeZone.
 * Safely handles DST spring-forward (23h) and fall-back (25h) days without assuming fixed 24-hour millisecond math.
 */
export function getZonedMidnightUtc(dateStr: string, timeZone: string): number {
  const [y, m, d] = dateStr.split('-').map(Number);
  let t = Date.UTC(y, m - 1, d, 0, 0, 0);

  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
    hour12: false,
  });

  function getOffsetMs(timeMs: number): number {
    const parts = formatter.formatToParts(new Date(timeMs));
    const p: Record<string, string> = {};
    for (const part of parts) {
      p[part.type] = part.value;
    }
    let hr = parseInt(p.hour, 10);
    if (hr === 24) hr = 0;
    const localMs = Date.UTC(
      parseInt(p.year, 10),
      parseInt(p.month, 10) - 1,
      parseInt(p.day, 10),
      hr,
      parseInt(p.minute, 10),
      parseInt(p.second, 10)
    );
    return localMs - timeMs;
  }

  const offset1 = getOffsetMs(t);
  t = t - offset1;
  const offset2 = getOffsetMs(t);
  if (offset2 !== offset1) {
    t = t - (offset2 - offset1);
  }
  return t;
}

/**
 * Returns the next calendar date in YYYY-MM-DD format.
 */
export function getNextDateStr(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const nextDate = new Date(Date.UTC(y, m - 1, d + 1));
  const ny = nextDate.getUTCFullYear();
  const nm = String(nextDate.getUTCMonth() + 1).padStart(2, '0');
  const nd = String(nextDate.getUTCDate()).padStart(2, '0');
  return `${ny}-${nm}-${nd}`;
}

export interface DayBoundaries {
  dayStartMs: number;
  dayEndMs: number;
  startIso: string;
  endIso: string;
}

/**
 * Returns exact start and end UTC timestamps for a target local calendar day in half-open format: [dayStartMs, dayEndMs).
 */
export function getDayBoundaries(targetDate: string, timeZone: string): DayBoundaries {
  const dayStartMs = getZonedMidnightUtc(targetDate, timeZone);
  const nextDateStr = getNextDateStr(targetDate);
  const dayEndMs = getZonedMidnightUtc(nextDateStr, timeZone);
  return {
    dayStartMs,
    dayEndMs,
    startIso: new Date(dayStartMs).toISOString(),
    endIso: new Date(dayEndMs).toISOString(),
  };
}

/**
 * Subtracts an array of toSubtract intervals from a source interval,
 * returning the remaining non-overlapping segments.
 */
export function subtractIntervals(
  source: TimeInterval | TimeInterval[],
  toSubtract: TimeInterval[]
): TimeInterval[] {
  let current: TimeInterval[] = Array.isArray(source) ? [...source] : [source];

  for (const sub of toSubtract) {
    const next: TimeInterval[] = [];
    for (const seg of current) {
      if (sub.endMs <= seg.startMs || sub.startMs >= seg.endMs) {
        // No overlap
        next.push(seg);
      } else {
        // Overlap: keep portion before sub.startMs
        if (sub.startMs > seg.startMs) {
          next.push({ startMs: seg.startMs, endMs: sub.startMs });
        }
        // Keep portion after sub.endMs
        if (sub.endMs < seg.endMs) {
          next.push({ startMs: sub.endMs, endMs: seg.endMs });
        }
      }
    }
    current = next;
  }

  return current;
}

export function formatYMD(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function formatDisplayDate(dateStr: string, timeZone?: string): string {
  try {
    const [y, m, d] = dateStr.split('-').map(Number);
    const date = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
    return date.toLocaleDateString(undefined, {
      weekday: 'long',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      timeZone: timeZone || undefined,
    });
  } catch {
    return dateStr;
  }
}

export interface CalculateDailyReportParams {
  targetDate: string; // YYYY-MM-DD
  userId: string;
  timeEntries?: TimeEntry[];
  pauses?: TimeEntryPause[];
  idles?: TimeEntryIdle[];
  tasks?: Task[];
  projects?: Project[];
  legacySessions?: ClientWorkSession[];
  activityTrackingEnabled?: boolean;
  pendingOutboxOps?: OutboxOperation[];
  timeZone?: string;
}

/**
 * Calculates a complete, verified DailyReport for a target date from normalized timer data,
 * splitting intervals crossing midnight and strictly enforcing [dayStart, dayEnd) boundaries.
 */
export function calculateDailyReport(params: CalculateDailyReportParams): DailyReport {
  const {
    targetDate,
    userId,
    timeEntries = [],
    pauses = [],
    idles = [],
    tasks = [],
    projects = [],
    legacySessions = [],
    activityTrackingEnabled = false,
    pendingOutboxOps = [],
    timeZone,
  } = params;

  const reportingTimeZone = resolveReportingTimeZone(timeZone);
  const { dayStartMs, dayEndMs } = getDayBoundaries(targetDate, reportingTimeZone);

  // Project map for fast name lookup
  const projectMap = new Map<string, Project>();
  for (const p of projects) {
    projectMap.set(p.id, p);
  }

  // Task map for fast task lookup
  const taskMap = new Map<string, Task>();
  for (const t of tasks) {
    taskMap.set(t.id, t);
  }

  const sessionItems: DailyReportSessionItem[] = [];

  // Track task time spent: taskId -> seconds
  const taskTimeSpent = new Map<string, number>();

  // Track project metrics: projectId (or 'unlinked') -> stats
  const projectAggregates = new Map<
    string,
    {
      projectId: string | null;
      projectName: string;
      activeSeconds: number;
      sessionCount: number;
    }
  >();

  const nowMs = Date.now();
  const seenEntryIds = new Set<string>();
  const validNormalizedEntries: Array<{
    entry: TimeEntry;
    effectiveStartMs: number;
    effectiveEndMs: number;
    clippedPauses: TimeInterval[];
    clippedIdles: TimeInterval[];
  }> = [];

  // 1. Process and clip normalized time entries to [dayStartMs, dayEndMs)
  for (const entry of timeEntries) {
    if (seenEntryIds.has(entry.id)) continue;
    seenEntryIds.add(entry.id);

    const sStartMs = new Date(entry.startedAt).getTime();
    if (Number.isNaN(sStartMs)) continue;

    const sEndMs = entry.endedAt
      ? new Date(entry.endedAt).getTime()
      : (entry.state === 'running' || entry.state === 'paused' ? nowMs : sStartMs);
    if (Number.isNaN(sEndMs)) continue;

    // Clip session interval to target day half-open interval: [dayStartMs, dayEndMs)
    const effectiveStartMs = Math.max(sStartMs, dayStartMs);
    const effectiveEndMs = Math.min(sEndMs, dayEndMs);

    if (effectiveStartMs >= effectiveEndMs) continue;

    // Collect and clip pauses for this entry to [effectiveStartMs, effectiveEndMs)
    const entryPauses = pauses.filter((p) => p.timeEntryId === entry.id);
    const clippedPauses: TimeInterval[] = [];
    for (const p of entryPauses) {
      const pStart = new Date(p.pausedAt).getTime();
      if (Number.isNaN(pStart)) continue;
      const pEnd = p.resumedAt ? new Date(p.resumedAt).getTime() : sEndMs;
      if (Number.isNaN(pEnd)) continue;

      const cStart = Math.max(effectiveStartMs, Math.min(pStart, effectiveEndMs));
      const cEnd = Math.max(effectiveStartMs, Math.min(pEnd, effectiveEndMs));
      if (cEnd > cStart) {
        clippedPauses.push({ startMs: cStart, endMs: cEnd });
      }
    }

    // Collect and clip idles for this entry to [effectiveStartMs, effectiveEndMs)
    const entryIdles = idles.filter((i) => i.timeEntryId === entry.id);
    const clippedIdles: TimeInterval[] = [];
    if (activityTrackingEnabled) {
      for (const i of entryIdles) {
        const iStart = new Date(i.startedAt).getTime();
        if (Number.isNaN(iStart)) continue;
        const iEnd = i.endedAt ? new Date(i.endedAt).getTime() : sEndMs;
        if (Number.isNaN(iEnd)) continue;

        const cStart = Math.max(effectiveStartMs, Math.min(iStart, effectiveEndMs));
        const cEnd = Math.max(effectiveStartMs, Math.min(iEnd, effectiveEndMs));
        if (cEnd > cStart) {
          clippedIdles.push({ startMs: cStart, endMs: cEnd });
        }
      }
    }

    validNormalizedEntries.push({
      entry,
      effectiveStartMs,
      effectiveEndMs,
      clippedPauses,
      clippedIdles,
    });
  }

  // Sort normalized entries chronologically
  validNormalizedEntries.sort((a, b) => a.effectiveStartMs - b.effectiveStartMs || a.effectiveEndMs - b.effectiveEndMs);

  const normalizedCoverageIntervals: TimeInterval[] = validNormalizedEntries.map((v) => ({
    startMs: v.effectiveStartMs,
    endMs: v.effectiveEndMs,
  }));
  const normalizedCoverageUnion = computeIntervalUnion(normalizedCoverageIntervals);

  // 2. Process and clip legacy sessions, deduplicating against normalized coverage
  const seenLegacyIds = new Set<string>();
  const validLegacyEntries: Array<{
    legacy: ClientWorkSession;
    effLegStartMs: number;
    effLegEndMs: number;
    retainedIntervals: TimeInterval[];
  }> = [];

  for (const leg of legacySessions) {
    if (seenLegacyIds.has(leg.id)) continue;
    seenLegacyIds.add(leg.id);

    const legStartMs = new Date(leg.startedAt).getTime();
    if (Number.isNaN(legStartMs)) continue;

    let legEndMs = leg.completedAt
      ? new Date(leg.completedAt).getTime()
      : legStartMs + Math.max(0, (leg.durationMinutes || 0) * 60000);
    if (Number.isNaN(legEndMs) || legEndMs <= legStartMs) {
      legEndMs = legStartMs + Math.max(0, (leg.durationMinutes || 0) * 60000);
    }

    const effLegStartMs = Math.max(legStartMs, dayStartMs);
    const effLegEndMs = Math.min(legEndMs, dayEndMs);
    if (effLegStartMs >= effLegEndMs) continue;

    // Deduplicate against normalized coverage union
    const retainedIntervals = subtractIntervals(
      { startMs: effLegStartMs, endMs: effLegEndMs },
      normalizedCoverageUnion
    );

    if (retainedIntervals.length === 0) continue;

    validLegacyEntries.push({
      legacy: leg,
      effLegStartMs,
      effLegEndMs,
      retainedIntervals,
    });
  }

  // Sort legacy entries chronologically
  validLegacyEntries.sort((a, b) => a.effLegStartMs - b.effLegStartMs || a.effLegEndMs - b.effLegEndMs);

  // 3. Global session coverage union (Requirement 1, 2, 7)
  const allSessionIntervals: TimeInterval[] = [
    ...normalizedCoverageIntervals,
    ...validLegacyEntries.flatMap((v) => v.retainedIntervals),
  ];
  const globalSessionCoverageUnion = computeIntervalUnion(allSessionIntervals);

  let totalTrackedSeconds = 0;
  for (const inv of globalSessionCoverageUnion) {
    totalTrackedSeconds += Math.max(0, Math.floor((inv.endMs - inv.startMs) / 1000));
  }

  // 4. Non-work intervals (pauses & idles) clipped to valid session coverage (Requirement 4, 5, 6, 8, 9)
  const allRawPauses: TimeInterval[] = [];
  const allRawIdles: TimeInterval[] = [];

  for (const v of validNormalizedEntries) {
    allRawPauses.push(...v.clippedPauses);
    allRawIdles.push(...v.clippedIdles);
  }

  const sessionClippedPauses: TimeInterval[] = [];
  for (const p of allRawPauses) {
    for (const cov of globalSessionCoverageUnion) {
      const start = Math.max(p.startMs, cov.startMs);
      const end = Math.min(p.endMs, cov.endMs);
      if (end > start) {
        sessionClippedPauses.push({ startMs: start, endMs: end });
      }
    }
  }

  const sessionClippedIdles: TimeInterval[] = [];
  for (const i of allRawIdles) {
    for (const cov of globalSessionCoverageUnion) {
      const start = Math.max(i.startMs, cov.startMs);
      const end = Math.min(i.endMs, cov.endMs);
      if (end > start) {
        sessionClippedIdles.push({ startMs: start, endMs: end });
      }
    }
  }

  const globalPauseUnion = computeIntervalUnion(sessionClippedPauses);
  let totalPausedSeconds = 0;
  for (const inv of globalPauseUnion) {
    totalPausedSeconds += Math.max(0, Math.floor((inv.endMs - inv.startMs) / 1000));
  }

  // Deduplicate idles against pauses so non-work time is not counted twice
  const globalIdleUnion = computeIntervalUnion(sessionClippedIdles);
  const nonOverlappingIdles = subtractIntervals(globalIdleUnion, globalPauseUnion);
  let totalIdleSeconds = 0;
  for (const inv of nonOverlappingIdles) {
    totalIdleSeconds += Math.max(0, Math.floor((inv.endMs - inv.startMs) / 1000));
  }

  const globalNonWorkUnion = computeIntervalUnion([...globalPauseUnion, ...nonOverlappingIdles]);
  let totalNonWorkSeconds = 0;
  for (const inv of globalNonWorkUnion) {
    totalNonWorkSeconds += Math.max(0, Math.floor((inv.endMs - inv.startMs) / 1000));
  }

  // Final total focus seconds guaranteed: totalFocus + totalPaused + totalIdle <= totalTrackedSeconds
  const totalFocusSeconds = Math.max(0, totalTrackedSeconds - totalNonWorkSeconds);

  // 5. Build session items & project breakdowns without double counting overlapping work
  let assignedWorkIntervals: TimeInterval[] = [];

  // A. Process normalized entries
  for (const v of validNormalizedEntries) {
    const rawSessionInterval = { startMs: v.effectiveStartMs, endMs: v.effectiveEndMs };
    const rawWork = subtractIntervals(rawSessionInterval, globalNonWorkUnion);
    const effectiveWork = subtractIntervals(rawWork, assignedWorkIntervals);

    let activeSecs = 0;
    for (const seg of effectiveWork) {
      activeSecs += Math.max(0, Math.floor((seg.endMs - seg.startMs) / 1000));
    }

    assignedWorkIntervals = computeIntervalUnion([...assignedWorkIntervals, ...effectiveWork]);

    const sessPauses = computeIntervalUnion(v.clippedPauses);
    let sessPauseSecs = 0;
    for (const inv of sessPauses) {
      sessPauseSecs += Math.max(0, Math.floor((inv.endMs - inv.startMs) / 1000));
    }

    const sessIdles = subtractIntervals(computeIntervalUnion(v.clippedIdles), globalPauseUnion);
    let sessIdleSecs = 0;
    for (const inv of sessIdles) {
      sessIdleSecs += Math.max(0, Math.floor((inv.endMs - inv.startMs) / 1000));
    }

    const associatedTask = v.entry.taskId ? taskMap.get(v.entry.taskId) : null;
    const taskTitle = associatedTask ? associatedTask.title : null;

    if (v.entry.taskId && activeSecs > 0) {
      taskTimeSpent.set(v.entry.taskId, (taskTimeSpent.get(v.entry.taskId) || 0) + activeSecs);
    }

    let effectiveProjectId = v.entry.projectId;
    if (!effectiveProjectId && associatedTask?.projectId) {
      effectiveProjectId = associatedTask.projectId;
    }

    const matchedProject = effectiveProjectId ? projectMap.get(effectiveProjectId) : null;
    const projectName = matchedProject ? matchedProject.name : (effectiveProjectId ? 'Project' : 'Unlinked Focus');

    const projKey = effectiveProjectId || 'unlinked';
    const existingProj = projectAggregates.get(projKey) || {
      projectId: effectiveProjectId || null,
      projectName,
      activeSeconds: 0,
      sessionCount: 0,
    };
    existingProj.activeSeconds += activeSecs;
    existingProj.sessionCount += 1;
    projectAggregates.set(projKey, existingProj);

    sessionItems.push({
      id: v.entry.id,
      title: taskTitle || (projectName !== 'Unlinked Focus' ? `${projectName} Session` : 'General Focus'),
      startedAt: new Date(v.effectiveStartMs).toISOString(),
      endedAt: v.entry.endedAt ? new Date(v.effectiveEndMs).toISOString() : null,
      activeSeconds: activeSecs,
      pausedSeconds: sessPauseSecs,
      idleSeconds: sessIdleSecs,
      projectId: effectiveProjectId || null,
      projectName,
      taskId: v.entry.taskId || null,
      taskTitle,
      source: 'normalized',
    });
  }

  // B. Process retained legacy entries
  for (const v of validLegacyEntries) {
    const rawLegacyWork = subtractIntervals(v.retainedIntervals, globalNonWorkUnion);
    const effectiveLegacyWork = subtractIntervals(rawLegacyWork, assignedWorkIntervals);

    let legacyActiveSecs = 0;
    for (const seg of effectiveLegacyWork) {
      legacyActiveSecs += Math.max(0, Math.floor((seg.endMs - seg.startMs) / 1000));
    }

    if (legacyActiveSecs === 0) continue;

    assignedWorkIntervals = computeIntervalUnion([...assignedWorkIntervals, ...effectiveLegacyWork]);

    const associatedTask = v.legacy.taskId ? taskMap.get(v.legacy.taskId) : null;
    const taskTitle = associatedTask ? associatedTask.title : null;

    if (v.legacy.taskId) {
      taskTimeSpent.set(v.legacy.taskId, (taskTimeSpent.get(v.legacy.taskId) || 0) + legacyActiveSecs);
    }

    let legProjectId: string | null = null;
    let legProjectName = 'General Workspace';
    if (associatedTask?.projectId) {
      legProjectId = associatedTask.projectId;
      const matched = projectMap.get(legProjectId);
      if (matched) legProjectName = matched.name;
    }

    const projKey = legProjectId || 'unlinked';
    const existingProj = projectAggregates.get(projKey) || {
      projectId: legProjectId,
      projectName: legProjectName,
      activeSeconds: 0,
      sessionCount: 0,
    };
    existingProj.activeSeconds += legacyActiveSecs;
    existingProj.sessionCount += 1;
    projectAggregates.set(projKey, existingProj);

    sessionItems.push({
      id: v.legacy.id,
      title: v.legacy.title || taskTitle || 'Legacy Focus Session',
      startedAt: new Date(v.effLegStartMs).toISOString(),
      endedAt: v.legacy.completedAt ? new Date(v.effLegEndMs).toISOString() : null,
      activeSeconds: legacyActiveSecs,
      pausedSeconds: 0,
      idleSeconds: 0,
      projectId: legProjectId,
      projectName: legProjectName,
      taskId: v.legacy.taskId || null,
      taskTitle,
      source: 'legacy',
    });
  }

  // Sort sessions chronologically
  sessionItems.sort((a, b) => new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime());

  // 3. Task breakdown & creation/completion metrics
  const workedTaskIds = new Set(taskTimeSpent.keys());

  // Count tasks whose createdAt falls strictly within [dayStartMs, dayEndMs)
  const createdTasksOnDay = tasks.filter((t) => {
    if (!t.createdAt) return false;
    const cMs = new Date(t.createdAt).getTime();
    return !Number.isNaN(cMs) && cMs >= dayStartMs && cMs < dayEndMs;
  });
  const tasksCreatedCount = createdTasksOnDay.length;

  // Count tasks whose verified completedAt falls strictly within [dayStartMs, dayEndMs)
  const completedTasksOnDay = tasks.filter((t) => {
    if (!t.completed || !t.completedAt) return false;
    const compMs = new Date(t.completedAt).getTime();
    return !Number.isNaN(compMs) && compMs >= dayStartMs && compMs < dayEndMs;
  });
  const tasksCompletedCount = completedTasksOnDay.length;

  // Relevant tasks to display in task breakdown for this date:
  // Strictly includes only tasks with a verified relationship to this date.
  const relevantTasks = tasks.filter((t) => {
    // 1. Worked on during this date's focus sessions
    if (workedTaskIds.has(t.id)) return true;
    // 2. Created on this target date
    if (t.createdAt) {
      const cMs = new Date(t.createdAt).getTime();
      if (!Number.isNaN(cMs) && cMs >= dayStartMs && cMs < dayEndMs) return true;
    }
    // 3. Completed on this target date with verified completedAt timestamp
    if (t.completed && t.completedAt) {
      const compMs = new Date(t.completedAt).getTime();
      if (!Number.isNaN(compMs) && compMs >= dayStartMs && compMs < dayEndMs) return true;
    }
    // 4. Due on this target date
    if (t.dueDate === targetDate) return true;

    return false;
  });

  const taskBreakdown: DailyReportTaskBreakdown[] = relevantTasks.map((t) => {
    const matchedProject = t.projectId ? projectMap.get(t.projectId) : null;
    return {
      taskId: t.id,
      title: t.title,
      priority: t.priority,
      completed: t.completed,
      projectId: t.projectId || null,
      projectName: matchedProject ? matchedProject.name : 'General Workspace',
      timeSpentSeconds: taskTimeSpent.get(t.id) || 0,
    };
  });

  // Sort task breakdown by time spent descending
  taskBreakdown.sort((a, b) => b.timeSpentSeconds - a.timeSpentSeconds);

  // Outstanding tasks that remain incomplete across workspace
  const outstandingTasks = tasks.filter((t) => !t.completed);
  const outstandingTasksCount = outstandingTasks.length;

  // 4. Project breakdown formatting
  const projectBreakdown: DailyReportProjectBreakdown[] = Array.from(projectAggregates.values())
    .map((p) => {
      const completedForProj = completedTasksOnDay.filter((t) => t.projectId === p.projectId).length;
      return {
        projectId: p.projectId,
        project: p.projectName,
        minutes: Math.round(p.activeSeconds / 60),
        activeSeconds: p.activeSeconds,
        sessionCount: p.sessionCount,
        completedTasksCount: completedForProj,
      };
    })
    .sort((a, b) => b.activeSeconds - a.activeSeconds);

  // 5. Check for pending outbox items affecting this date
  const hasPendingOutboxForDate = pendingOutboxOps.some((op) => {
    if (op.status !== 'pending') return false;
    if (op.entityType === 'daily_report') {
      const p = op.payload as { report_date?: string };
      return p?.report_date === targetDate;
    }
    if (op.entityType.startsWith('time_entry')) {
      const cMs = new Date(op.createdAt).getTime();
      return !Number.isNaN(cMs) && cMs >= dayStartMs && cMs < dayEndMs;
    }
    return false;
  });

  const hasPendingSync = hasPendingOutboxForDate;

  // 6. Deterministic Narrative & Actionable Suggestions
  const hours = Math.floor(totalFocusSeconds / 3600);
  const minutes = Math.floor((totalFocusSeconds % 3600) / 60);
  const durationText = hours > 0 ? `${hours}h ${minutes}m` : `${minutes} minute(s)`;

  let narrative = '';
  if (sessionItems.length === 0) {
    narrative = `No work sessions were recorded on ${formatDisplayDate(targetDate, reportingTimeZone)}. Tasks in your queue remain available for your next focus session.`;
  } else {
    narrative = `On ${formatDisplayDate(targetDate, reportingTimeZone)}, you logged ${durationText} of focused work across ${sessionItems.length} session(s). `;

    if (totalPausedSeconds > 0 || totalIdleSeconds > 0) {
      const pMins = Math.round(totalPausedSeconds / 60);
      const iMins = Math.round(totalIdleSeconds / 60);
      if (activityTrackingEnabled && iMins > 0) {
        narrative += `Recorded break time totaled ${pMins}m, with ${iMins}m of inactive/idle duration. `;
      } else if (pMins > 0) {
        narrative += `Recorded pause time was ${pMins}m. `;
      }
    }

    if (projectBreakdown.length > 0 && projectBreakdown[0].project !== 'Unlinked Focus') {
      const topProj = projectBreakdown[0];
      narrative += `Your primary focus was on "${topProj.project}" (${topProj.minutes}m). `;
    }

    if (tasksCompletedCount > 0 && completedTasksOnDay.length > 0) {
      narrative += `You completed ${tasksCompletedCount} task(s), including "${completedTasksOnDay[0].title}". `;
    }

    if (outstandingTasksCount > 0) {
      narrative += `There are ${outstandingTasksCount} task(s) worked on that remain in progress.`;
    }
  }

  const suggestions: string[] = [];
  if (totalFocusSeconds >= 10800) {
    suggestions.push('High deep-work duration logged today — ensure you schedule ergonomic recovery and ocular rest.');
  } else if (totalFocusSeconds > 0 && totalFocusSeconds < 3600) {
    suggestions.push('Consider scheduling a dedicated 45-minute focus block tomorrow to maintain forward momentum.');
  }

  const urgentOrHighTask = outstandingTasks.find((t) => t.priority === 'urgent' || t.priority === 'high');
  if (urgentOrHighTask) {
    suggestions.push(`Priority focus for tomorrow: Advance outstanding task "${urgentOrHighTask.title}".`);
  } else if (outstandingTasks.length > 0) {
    suggestions.push(`Next in queue: Advance task "${outstandingTasks[0].title}".`);
  } else if (tasksCompletedCount > 0) {
    suggestions.push('Great job completing your target tasks! Review your backlog to outline tomorrow\'s goals.');
  }

  if (totalFocusSeconds >= 7200 && totalPausedSeconds < 600) {
    suggestions.push('Take short 5-minute movement breaks between long focus sessions to sustain cognitive clarity.');
  }

  const deterministicId = generateDailyReportId(userId, targetDate);
  const nowIso = new Date().toISOString();

  return {
    id: deterministicId,
    userId,
    reportDate: targetDate,
    totalFocusSeconds,
    totalPausedSeconds,
    totalIdleSeconds,
    totalTrackedSeconds,
    sessionCount: sessionItems.length,
    tasksCompletedCount,
    tasksCreatedCount,
    projectBreakdown,
    taskBreakdown,
    sessions: sessionItems,
    aiNarrative: narrative.trim(),
    actionableSuggestions: suggestions,
    generationStatus: 'completed',
    hasPendingSync,
    reportingTimeZone,
    outstandingTasksCount,
    createdAt: nowIso,
    updatedAt: nowIso,
  };
}
