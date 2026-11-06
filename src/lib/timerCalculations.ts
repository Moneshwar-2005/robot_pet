/**
 * Kuro Companion — Normalized Timer Duration & State Calculations
 *
 * Implements deterministic calculation of active work intervals, pause durations,
 * and idle periods matching the Phase 9 PostgreSQL database trigger specifications
 * (fn_sync_time_entry_duration_on_pause and fn_sync_time_entry_duration_on_idle).
 */

import type { TimeEntry, TimeEntryPause, TimeEntryIdle } from '../types';

export interface TimeInterval {
  startMs: number;
  endMs: number;
}

/**
 * Computes the union of a set of intervals by sorting and merging overlapping or adjacent intervals.
 * Safely filters out invalid or inverted timestamp ranges (where endMs <= startMs or NaN).
 */
export function computeIntervalUnion(intervals: TimeInterval[]): TimeInterval[] {
  if (!intervals || intervals.length === 0) return [];

  // Filter out invalid or zero/inverted ranges
  const valid = intervals
    .filter(
      (inv) =>
        inv &&
        typeof inv.startMs === 'number' &&
        typeof inv.endMs === 'number' &&
        !Number.isNaN(inv.startMs) &&
        !Number.isNaN(inv.endMs) &&
        inv.endMs > inv.startMs
    )
    .sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);

  if (valid.length === 0) return [];

  const merged: TimeInterval[] = [{ startMs: valid[0].startMs, endMs: valid[0].endMs }];

  for (let i = 1; i < valid.length; i++) {
    const current = valid[i];
    const last = merged[merged.length - 1];

    if (current.startMs <= last.endMs) {
      // Overlapping or adjacent: merge by extending endMs
      last.endMs = Math.max(last.endMs, current.endMs);
    } else {
      merged.push({ startMs: current.startMs, endMs: current.endMs });
    }
  }

  return merged;
}

/**
 * Calculates the active work duration in seconds for a time entry,
 * accounting for all closed and open pause and idle intervals using interval union.
 *
 * Invariant: activeDuration = max(0, totalElapsed - union_of_pause_and_idle_intervals)
 * Overlapping or nested pauses and idles never double-count, and active duration never goes below zero.
 */
export function calculateActiveDuration(
  entry: TimeEntry | null,
  pauses: TimeEntryPause[] = [],
  idles: TimeEntryIdle[] = [],
  currentTimestampMs?: number
): number {
  if (!entry) return 0;

  const startMs = new Date(entry.startedAt).getTime();
  if (Number.isNaN(startMs)) return 0;

  const nowMs = currentTimestampMs ?? Date.now();
  const endMs = entry.endedAt ? new Date(entry.endedAt).getTime() : nowMs;
  if (Number.isNaN(endMs) || endMs <= startMs) return 0;

  const totalElapsedSecs = Math.max(0, Math.floor((endMs - startMs) / 1000));

  const rawIntervals: TimeInterval[] = [];

  // 1. Collect pauses clamped to [startMs, endMs]
  for (const pause of pauses) {
    const pStartRaw = new Date(pause.pausedAt).getTime();
    if (Number.isNaN(pStartRaw)) continue;

    const pEndRaw = pause.resumedAt ? new Date(pause.resumedAt).getTime() : endMs;
    if (Number.isNaN(pEndRaw)) continue;

    const clampedStart = Math.max(startMs, Math.min(pStartRaw, endMs));
    const clampedEnd = Math.max(startMs, Math.min(pEndRaw, endMs));

    if (clampedEnd > clampedStart) {
      rawIntervals.push({ startMs: clampedStart, endMs: clampedEnd });
    }
  }

  // 2. Collect idles clamped to [startMs, endMs]
  for (const idle of idles) {
    const iStartRaw = new Date(idle.startedAt).getTime();
    if (Number.isNaN(iStartRaw)) continue;

    const iEndRaw = idle.endedAt ? new Date(idle.endedAt).getTime() : endMs;
    if (Number.isNaN(iEndRaw)) continue;

    const clampedStart = Math.max(startMs, Math.min(iStartRaw, endMs));
    const clampedEnd = Math.max(startMs, Math.min(iEndRaw, endMs));

    if (clampedEnd > clampedStart) {
      rawIntervals.push({ startMs: clampedStart, endMs: clampedEnd });
    }
  }

  // 3. Compute union of non-work intervals
  const mergedNonWork = computeIntervalUnion(rawIntervals);

  let totalNonWorkSecs = 0;
  for (const inv of mergedNonWork) {
    totalNonWorkSecs += Math.max(0, Math.floor((inv.endMs - inv.startMs) / 1000));
  }

  return Math.max(0, totalElapsedSecs - totalNonWorkSecs);
}

/**
 * Calculates total paused time in seconds for an array of pauses.
 */
export function calculatePauseDuration(
  pauses: TimeEntryPause[] = [],
  currentTimestampMs?: number
): number {
  const nowMs = currentTimestampMs ?? Date.now();
  const raw: TimeInterval[] = [];

  for (const pause of pauses) {
    const pStart = new Date(pause.pausedAt).getTime();
    if (Number.isNaN(pStart)) continue;

    const pEnd = pause.resumedAt ? new Date(pause.resumedAt).getTime() : nowMs;
    if (!Number.isNaN(pEnd) && pEnd > pStart) {
      raw.push({ startMs: pStart, endMs: pEnd });
    }
  }

  const merged = computeIntervalUnion(raw);
  return merged.reduce((acc, inv) => acc + Math.max(0, Math.floor((inv.endMs - inv.startMs) / 1000)), 0);
}

/**
 * Calculates total idle time in seconds for an array of idle intervals.
 */
export function calculateIdleDuration(
  idles: TimeEntryIdle[] = [],
  currentTimestampMs?: number
): number {
  const nowMs = currentTimestampMs ?? Date.now();
  const raw: TimeInterval[] = [];

  for (const idle of idles) {
    const iStart = new Date(idle.startedAt).getTime();
    if (Number.isNaN(iStart)) continue;

    const iEnd = idle.endedAt ? new Date(idle.endedAt).getTime() : nowMs;
    if (!Number.isNaN(iEnd) && iEnd > iStart) {
      raw.push({ startMs: iStart, endMs: iEnd });
    }
  }

  const merged = computeIntervalUnion(raw);
  return merged.reduce((acc, inv) => acc + Math.max(0, Math.floor((inv.endMs - inv.startMs) / 1000)), 0);
}

/**
 * Formats a duration in seconds into MM:SS or HH:MM:SS format.
 */
export function formatTimerDuration(totalSeconds: number): string {
  const safeSeconds = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const seconds = safeSeconds % 60;

  const mm = minutes.toString().padStart(2, '0');
  const ss = seconds.toString().padStart(2, '0');

  if (hours > 0) {
    const hh = hours.toString().padStart(2, '0');
    return `${hh}:${mm}:${ss}`;
  }

  return `${mm}:${ss}`;
}

/**
 * Checks whether an uncompleted timer has exceeded the stale threshold (default 12 hours).
 * Corresponds to Phase 9 administrative reconciliation threshold.
 */
export function isStaleTimer(
  entry: TimeEntry | null,
  maxAgeHours = 12,
  currentTimestampMs?: number
): boolean {
  if (!entry || entry.state === 'completed' || entry.state === 'quarantined') {
    return false;
  }

  const startMs = new Date(entry.startedAt).getTime();
  if (Number.isNaN(startMs)) return false;

  const nowMs = currentTimestampMs ?? Date.now();
  const ageMs = nowMs - startMs;
  const maxAgeMs = maxAgeHours * 3600 * 1000;

  return ageMs > maxAgeMs;
}

