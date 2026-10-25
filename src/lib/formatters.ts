/**
 * Safe date and time formatting helpers for Kuro.
 * Handles null, undefined, invalid, and empty values gracefully without throwing.
 */

/**
 * Returns a YYYY-MM-DD string representing a date in the user's local timezone.
 * Avoids UTC date shifting caused by Date.prototype.toISOString().
 */
export function formatLocalDateString(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Formats a PostgreSQL TIME string (e.g. "17:00:00" or "09:30") to 12-hour AM/PM format (e.g. "5:00 PM").
 * Returns an empty string if null, empty, or invalid.
 */
export function formatTimeDisplay(timeStr: string | null | undefined): string {
  if (!timeStr || typeof timeStr !== 'string') return '';
  const trimmed = timeStr.trim();
  if (!trimmed) return '';

  const parts = trimmed.split(':');
  if (parts.length < 2) return trimmed;

  const hours = parseInt(parts[0], 10);
  const minutes = parseInt(parts[1], 10);

  if (isNaN(hours) || isNaN(minutes) || hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    return trimmed;
  }

  const period = hours >= 12 ? 'PM' : 'AM';
  const displayHours = hours % 12 === 0 ? 12 : hours % 12;
  const displayMinutes = minutes.toString().padStart(2, '0');

  return `${displayHours}:${displayMinutes} ${period}`;
}

/**
 * Formats a PostgreSQL DATE string (e.g. "2026-10-23") or relative term to a clean display format.
 * Returns an empty string if null, empty, or invalid.
 */
export function formatDateDisplay(dateStr: string | null | undefined): string {
  if (!dateStr || typeof dateStr !== 'string') return '';
  const trimmed = dateStr.trim();
  if (!trimmed) return '';

  if (trimmed.toLowerCase() === 'today' || trimmed.toLowerCase() === 'tomorrow') {
    return trimmed.charAt(0).toUpperCase() + trimmed.slice(1).toLowerCase();
  }

  // Parse YYYY-MM-DD using local calendar components to prevent UTC date shifting
  let date: Date;
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    const [y, m, d] = trimmed.split('-').map((v) => parseInt(v, 10));
    date = new Date(y, m - 1, d);
  } else {
    date = new Date(trimmed);
  }

  if (isNaN(date.getTime())) {
    return trimmed;
  }

  try {
    const today = new Date();
    const isSameYear = date.getFullYear() === today.getFullYear();
    const isSameMonth = date.getMonth() === today.getMonth();
    const isSameDay = date.getDate() === today.getDate();

    if (isSameYear && isSameMonth && isSameDay) {
      return 'Today';
    }

    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    if (
      date.getFullYear() === tomorrow.getFullYear() &&
      date.getMonth() === tomorrow.getMonth() &&
      date.getDate() === tomorrow.getDate()
    ) {
      return 'Tomorrow';
    }

    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      ...(isSameYear ? {} : { year: 'numeric' }),
    });
  } catch {
    return trimmed;
  }
}

/**
 * Combines task dueDate and dueTime into a concise, safe UI deadline label.
 * Avoids awkward labels like "Due null at null".
 */
export function formatTaskDeadline(
  dueDate: string | null | undefined,
  dueTime: string | null | undefined
): string {
  const formattedDate = formatDateDisplay(dueDate);
  const formattedTime = formatTimeDisplay(dueTime);

  if (!formattedDate && !formattedTime) {
    return 'No deadline';
  }

  if (formattedDate && formattedTime) {
    return `Due ${formattedDate} at ${formattedTime}`;
  }

  if (formattedDate) {
    return `Due ${formattedDate}`;
  }

  return `Due at ${formattedTime}`;
}

/**
 * Formats an ISO / TIMESTAMPTZ timestamp into a human relative time (e.g. "Just now", "2 hours ago").
 */
export function formatRelativeTimestamp(isoStr: string | null | undefined): string {
  if (!isoStr || typeof isoStr !== 'string') return '';
  const date = new Date(isoStr);
  if (isNaN(date.getTime())) return '';

  const diffMs = Date.now() - date.getTime();
  if (diffMs < 0) return 'Just now';

  const diffSecs = Math.floor(diffMs / 1000);
  if (diffSecs < 60) return 'Just now';

  const diffMins = Math.floor(diffSecs / 60);
  if (diffMins < 60) return `${diffMins} min${diffMins === 1 ? '' : 's'} ago`;

  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours} hour${diffHours === 1 ? '' : 's'} ago`;

  const diffDays = Math.floor(diffHours / 24);
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays} days ago`;

  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/**
 * Formats a reminder time for UI display.
 * If the string is an ISO-8601 timestamp, formats it as e.g. "Today at 5:30 PM" or "Oct 26 at 2:00 PM".
 * If it is already a relative display label (e.g. "20 mins left"), returns it unchanged.
 */
export function formatReminderDisplay(timeStr: string | null | undefined): string {
  if (!timeStr || typeof timeStr !== 'string') return '';
  const trimmed = timeStr.trim();
  if (!trimmed) return '';

  const timestamp = Date.parse(trimmed);
  if (isNaN(timestamp) || !trimmed.includes('T')) {
    return trimmed;
  }

  try {
    const date = new Date(timestamp);
    const timeFormatted = date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

    const today = new Date();
    const isSameYear = date.getFullYear() === today.getFullYear();
    const isSameMonth = date.getMonth() === today.getMonth();
    const isSameDay = date.getDate() === today.getDate();

    if (isSameYear && isSameMonth && isSameDay) {
      return `Today at ${timeFormatted}`;
    }

    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    if (
      date.getFullYear() === tomorrow.getFullYear() &&
      date.getMonth() === tomorrow.getMonth() &&
      date.getDate() === tomorrow.getDate()
    ) {
      return `Tomorrow at ${timeFormatted}`;
    }

    const dateFormatted = date.toLocaleDateString([], {
      month: 'short',
      day: 'numeric',
      ...(isSameYear ? {} : { year: 'numeric' }),
    });

    return `${dateFormatted} at ${timeFormatted}`;
  } catch {
    return trimmed;
  }
}

/**
 * Formats a confidence value (number 0.0 - 1.0 or string percentage) for UI display.
 */
export function formatConfidence(conf: number | string | null | undefined): string {
  if (conf === null || conf === undefined) return '100%';
  if (typeof conf === 'string') {
    if (conf.endsWith('%')) return conf;
    const num = parseFloat(conf);
    if (isNaN(num)) return conf;
    return `${Math.round(num <= 1 ? num * 100 : num)}%`;
  }
  return `${Math.round(conf <= 1 ? conf * 100 : conf)}%`;
}

/**
 * Formats session duration in minutes (e.g. 25 -> "25m", 75 -> "1h 15m").
 */
export function formatSessionDuration(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

