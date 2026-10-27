/**
 * Kuro Browser Notifications & Reminder Alert Service
 *
 * Scope: Phase 4.4 + Phase 5
 *
 * GUARANTEES:
 * 1. Permission requested strictly on explicit user action (never on mount).
 * 2. Handles unsupported browsers, denied permissions, and offline mode cleanly.
 * 3. Graceful fallback to in-app foreground alerts / banners.
 * 4. Durable duplicate prevention via localStorage tracking.
 * 5. Timezone-aware parsing (ISO-8601, 12h/24h local time, relative offsets).
 * 6. Zero cloud AI requirements; 100% deterministic local notifications.
 */

import type { Reminder } from '../types';
import { formatReminderDisplay } from './formatters.ts';

export type NotificationPermissionStatus = 'granted' | 'denied' | 'default' | 'unsupported';

export interface ReminderNotificationAlert {
  id: string;
  reminderId: string;
  title: string;
  timeDisplay: string;
  type: Reminder['type'];
  priority: Reminder['priority'];
  timestamp: string;
}

const NOTIFIED_STORAGE_KEY = 'kuro_notified_reminders_v1';

/**
 * Checks if the browser supports the Web Notification API.
 */
export function isNotificationSupported(): boolean {
  try {
    return typeof window !== 'undefined' && 'Notification' in window && Boolean(window.Notification);
  } catch {
    return false;
  }
}

/**
 * Returns current browser notification permission status.
 */
export function getNotificationPermission(): NotificationPermissionStatus {
  if (!isNotificationSupported()) {
    return 'unsupported';
  }
  return Notification.permission as NotificationPermissionStatus;
}

/**
 * Requests notification permission from user. Must only be invoked from user-driven action.
 */
export async function requestNotificationPermission(): Promise<NotificationPermissionStatus> {
  if (!isNotificationSupported()) {
    return 'unsupported';
  }

  try {
    const perm = await Notification.requestPermission();
    return perm as NotificationPermissionStatus;
  } catch {
    return 'denied';
  }
}

/**
 * Retrieves the set of reminder IDs that have already triggered a notification.
 */
export function getNotifiedReminderIds(): Set<string> {
  try {
    const raw = localStorage.getItem(NOTIFIED_STORAGE_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return new Set(parsed);
    }
  } catch {
    // ignore local storage errors
  }
  return new Set();
}

/**
 * Records that a reminder has been notified to prevent duplicate alerts.
 */
export function markReminderNotified(reminderId: string): void {
  try {
    const ids = getNotifiedReminderIds();
    ids.add(reminderId);
    // Limit storage retention to latest 200 notified reminders
    const arr = Array.from(ids);
    const capped = arr.slice(-200);
    localStorage.setItem(NOTIFIED_STORAGE_KEY, JSON.stringify(capped));
  } catch {
    // ignore
  }
}

/**
 * Clears the notified reminders history cache (e.g. for demo reset or testing).
 */
export function clearNotifiedReminders(): void {
  try {
    localStorage.removeItem(NOTIFIED_STORAGE_KEY);
  } catch {
    // ignore
  }
}

/**
 * Unmarks a reminder so it can be re-notified if scheduled again.
 */
export function unmarkReminderNotified(reminderId: string): void {
  try {
    const ids = getNotifiedReminderIds();
    if (ids.delete(reminderId)) {
      localStorage.setItem(NOTIFIED_STORAGE_KEY, JSON.stringify(Array.from(ids)));
    }
  } catch {
    // ignore
  }
}

/**
 * Safely parses a reminder time string into an epoch timestamp in milliseconds.
 * Handles ISO-8601 strings, "HH:MM", "h:mm A", and relative offsets.
 */
export function parseReminderTriggerTime(timeStr: string | null | undefined, referenceNow = Date.now()): number | null {
  if (!timeStr || typeof timeStr !== 'string') return null;
  const trimmed = timeStr.trim();
  if (!trimmed) return null;

  // 1. ISO 8601 timestamp (e.g. "2026-10-27T17:30:00.000Z" or "2026-10-27T17:30:00")
  if (trimmed.includes('T')) {
    const parsed = Date.parse(trimmed);
    if (!isNaN(parsed)) return parsed;
  }

  // 2. 12-hour or 24-hour time string (e.g. "4:30 PM", "04:30 PM", "16:30")
  const clock12Match = trimmed.match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM)?$/i);
  if (clock12Match) {
    let hours = parseInt(clock12Match[1], 10);
    const minutes = parseInt(clock12Match[2], 10);
    const period = clock12Match[3]?.toUpperCase();

    if (period === 'PM' && hours < 12) hours += 12;
    if (period === 'AM' && hours === 12) hours = 0;

    if (hours >= 0 && hours < 24 && minutes >= 0 && minutes < 60) {
      const target = new Date(referenceNow);
      target.setHours(hours, minutes, 0, 0);
      return target.getTime();
    }
  }

  // 3. Relative minute offsets (e.g. "20 mins left", "In 45 mins", "in 10 min")
  const relativeMatch = trimmed.match(/(?:in\s+)?(\d+)\s*mins?(?:\s+left)?/i);
  if (relativeMatch) {
    const mins = parseInt(relativeMatch[1], 10);
    if (!isNaN(mins)) {
      return referenceNow + mins * 60 * 1000;
    }
  }

  // 4. Fallback Date.parse
  const directParse = Date.parse(trimmed);
  if (!isNaN(directParse)) {
    return directParse;
  }

  return null;
}

/**
 * Checks which reminders are currently due and have not been previously notified.
 * A reminder is due if:
 * - It is not marked done
 * - It has not been notified yet
 * - Its scheduled time is <= now + lookaheadMs (default 30 seconds)
 * - Its scheduled time is >= now - maxPastMs (default 15 minutes, prevents ancient backlogs)
 */
export function checkRemindersToNotify(
  reminders: Reminder[],
  options: {
    now?: number;
    lookaheadMs?: number;
    maxPastMs?: number;
    notifiedIds?: Set<string>;
  } = {}
): Reminder[] {
  const now = options.now ?? Date.now();
  const lookaheadMs = options.lookaheadMs ?? 30000; // 30 seconds ahead
  const maxPastMs = options.maxPastMs ?? 15 * 60 * 1000; // 15 mins past max
  const notifiedIds = options.notifiedIds ?? getNotifiedReminderIds();

  const dueList: Reminder[] = [];

  for (const reminder of reminders) {
    if (reminder.done) continue;
    if (notifiedIds.has(reminder.id)) continue;

    const triggerEpoch = parseReminderTriggerTime(reminder.time, now);
    if (triggerEpoch === null) continue;

    const diff = triggerEpoch - now;

    // Due if trigger is within lookahead window and not older than maxPastMs
    if (diff <= lookaheadMs && diff >= -maxPastMs) {
      dueList.push(reminder);
    }
  }

  return dueList;
}

/**
 * Dispatches a notification for a reminder:
 * 1. Emits native browser Notification if permission is granted.
 * 2. Invokes in-app alert handler for foreground / fallback display.
 * 3. Records reminder in durable notified storage to avoid duplicates.
 */
export function dispatchReminderNotification(
  reminder: Reminder,
  onInAppAlert?: (alert: ReminderNotificationAlert) => void
): boolean {
  markReminderNotified(reminder.id);

  const timeFormatted = formatReminderDisplay(reminder.time);
  const bodyText = `Scheduled: ${timeFormatted || 'Now'}`;

  // 1. Native browser notification if permitted
  if (isNotificationSupported() && Notification.permission === 'granted') {
    try {
      new Notification(`Kuro: ${reminder.title}`, {
        body: bodyText,
        icon: '/favicon.ico',
        tag: `kuro-rem-${reminder.id}`,
      });
    } catch {
      // In some sandboxed iframe environments, Notification constructor may fail
    }
  }

  // 2. Foreground / In-App Alert Fallback
  if (onInAppAlert) {
    onInAppAlert({
      id: `alert-${Date.now()}-${reminder.id}`,
      reminderId: reminder.id,
      title: reminder.title,
      timeDisplay: timeFormatted,
      type: reminder.type,
      priority: reminder.priority,
      timestamp: new Date().toISOString(),
    });
  }

  return true;
}
