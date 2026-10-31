import type { Task, Reminder, Theme } from '../types';
import type {
  UserProfileRow,
  TaskRow,
  ReminderRow,
  PetSettingsRow,
  UserPreferencesRow,
  UserMemoryRow,
  WorkSessionRow,
  RoutineRow,
  TablesInsert,
  TablesUpdate,
} from '../types/database';

/**
 * Maps a database task row (snake_case) to application Task model (camelCase).
 * Preserves nullable due_date and due_time without fabricating fallback values.
 */
export function taskRowToTask(row: TaskRow): Task {
  return {
    id: row.id,
    title: row.title,
    category: row.category,
    priority: row.priority,
    dueDate: row.due_date,
    dueTime: row.due_time,
    estimatedMinutes: row.estimated_minutes,
    completed: row.completed,
    tags: Array.isArray(row.tags) ? [...row.tags] : [],
    description: row.description ?? undefined,
  };
}

function formatLocalDateString(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function parseDateForPostgres(dateStr: string | null | undefined): string | null {
  if (!dateStr) return null;
  const trimmed = dateStr.trim();
  if (!trimmed) return null;

  if (trimmed.toLowerCase() === 'today') {
    return formatLocalDateString(new Date());
  }
  if (trimmed.toLowerCase() === 'tomorrow') {
    const tm = new Date();
    tm.setDate(tm.getDate() + 1);
    return formatLocalDateString(tm);
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return trimmed;
  }

  const parsed = Date.parse(trimmed);
  if (!isNaN(parsed)) {
    return formatLocalDateString(new Date(parsed));
  }

  return null;
}

function parseTimeForPostgres(timeStr: string | null | undefined): string | null {
  if (!timeStr) return null;
  const trimmed = timeStr.trim();
  if (!trimmed) return null;

  if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(trimmed)) {
    const parts = trimmed.split(':');
    const h = parts[0].padStart(2, '0');
    const m = parts[1];
    const s = parts[2] || '00';
    return `${h}:${m}:${s}`;
  }

  const match12 = trimmed.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (match12) {
    let hours = parseInt(match12[1], 10);
    const minutes = match12[2];
    const period = match12[3].toUpperCase();
    if (period === 'PM' && hours < 12) hours += 12;
    if (period === 'AM' && hours === 12) hours = 0;
    return `${hours.toString().padStart(2, '0')}:${minutes}:00`;
  }

  return null;
}

/**
 * Maps application Task input to a database Insert payload.
 * Preserves nullable fields explicitly and safely converts dates/times.
 * Preserves client-generated UUID when provided for offline idempotency.
 */
export function taskToInsertPayload(
  task: Omit<Task, 'id'> & { id?: string },
  userId: string
): TablesInsert<'tasks'> {
  const payload: TablesInsert<'tasks'> = {
    user_id: userId,
    title: task.title.trim(),
    category: task.category,
    priority: task.priority,
    due_date: parseDateForPostgres(task.dueDate),
    due_time: parseTimeForPostgres(task.dueTime),
    estimated_minutes: task.estimatedMinutes,
    completed: task.completed,
    tags: Array.isArray(task.tags) ? [...task.tags] : [],
    description: task.description ? task.description.trim() : null,
  };

  if (task.id) {
    payload.id = task.id;
  }

  return payload;
}

/**
 * Maps a database reminder row to the application Reminder model.
 * Maps PostgreSQL TIMESTAMPTZ remind_at directly to the client time field.
 */
export function reminderRowToReminder(row: ReminderRow): Reminder {
  return {
    id: row.id,
    title: row.title,
    time: row.remind_at,
    type: row.reminder_type,
    priority: row.priority,
    done: row.done,
  };
}

/**
 * Maps application Reminder input to a database Insert payload.
 * Requires a valid ISO-8601 timestamp string for remind_at.
 * Rejects UI-only relative strings (e.g. "20 mins left", "In 45 mins") rather than fabricating dates.
 * Preserves client-generated UUID when provided for offline idempotency.
 */
export function reminderToInsertPayload(
  reminder: Omit<Reminder, 'id'> & { id?: string },
  userId: string
): TablesInsert<'reminders'> {
  const rawTime = reminder.time?.trim();
  const timestamp = Date.parse(rawTime);

  if (isNaN(timestamp)) {
    throw new Error(
      `Cannot persist reminder with unparsed time value: "${reminder.time}". A valid ISO-8601 timestamp string is required for database column remind_at.`
    );
  }

  const payload: TablesInsert<'reminders'> = {
    user_id: userId,
    title: reminder.title.trim(),
    remind_at: new Date(timestamp).toISOString(),
    reminder_type: reminder.type,
    priority: reminder.priority,
    done: reminder.done,
  };

  if (reminder.id) {
    payload.id = reminder.id;
  }

  return payload;
}

export interface ClientPetSettings {
  petName: string;
  avatarVariant: string;
  eyeShape: 'curved' | 'round' | 'pixel';
  glowColor: 'cyan' | 'emerald' | 'amber' | 'violet';
  playfulness: number;
  focusDiscipline: number;
  autonomousEnabled?: boolean;
  reactionFrequency?: 'quiet' | 'balanced' | 'expressive';
  browserAwarenessEnabled?: boolean;
  excludedDomains?: string[];
  pausedUntil?: number | null;
}

/**
 * Normalizes a pet setting numeric value (playfulness / focusDiscipline) to an integer in [0, 100].
 * - In the Kuro UI contract, the slider range is integers 0 to 100, where 1 represents 1% and 100 represents 100%.
 * - If given a decimal strictly in (0, 1.0) (such as 0.01, 0.5, 0.85, 0.99), scales to percentage (1, 50, 85, 99).
 * - If given 1 or an integer/float >= 1, treats it as already in the [1, 100] percentage domain (e.g. 1 -> 1%, 50 -> 50%, 100 -> 100%), clamped to [0, 100] and rounded.
 * - If given 0 or negative values (e.g. -10), clamps to 0.
 * - If given values > 100 (e.g. 150), clamps to 100.
 * - If given null, undefined, NaN, or non-numeric values, returns the documented fallback.
 */
export function normalizePetSettingInt(val: unknown, fallback = 70): number {
  if (val === undefined || val === null) return fallback;
  let num: number;
  if (typeof val === 'number') {
    num = val;
  } else if (typeof val === 'string' && val.trim() !== '') {
    num = Number(val);
  } else {
    return fallback;
  }
  if (isNaN(num)) return fallback;
  if (num > 0 && num < 1.0) {
    return Math.min(100, Math.max(0, Math.round(num * 100)));
  }
  return Math.min(100, Math.max(0, Math.round(num)));
}

/**
 * Maps a database pet_settings row to client settings model.
 * Enforces integer percentages (0-100) for playfulness and focus_discipline.
 */
export function petSettingsRowToClient(row: PetSettingsRow): ClientPetSettings {
  return {
    petName: row.pet_name,
    avatarVariant: row.avatar_variant,
    eyeShape: row.eye_shape,
    glowColor: row.glow_color,
    playfulness: normalizePetSettingInt(row.playfulness, 70),
    focusDiscipline: normalizePetSettingInt(row.focus_discipline, 85),
  };
}

/**
 * Builds an update payload for pet_settings table.
 * Ensures playfulness and focus_discipline are integers matching PostgreSQL column types.
 */
export function petSettingsToUpdatePayload(
  settings: Partial<ClientPetSettings>
): TablesUpdate<'pet_settings'> {
  const payload: TablesUpdate<'pet_settings'> = {};
  if (settings.petName !== undefined) payload.pet_name = settings.petName.trim();
  if (settings.avatarVariant !== undefined) payload.avatar_variant = settings.avatarVariant;
  if (settings.eyeShape !== undefined) payload.eye_shape = settings.eyeShape;
  if (settings.glowColor !== undefined) payload.glow_color = settings.glowColor;
  if (settings.playfulness !== undefined) {
    payload.playfulness = normalizePetSettingInt(settings.playfulness, 70);
  }
  if (settings.focusDiscipline !== undefined) {
    payload.focus_discipline = normalizePetSettingInt(settings.focusDiscipline, 85);
  }
  return payload;
}

export interface ClientMemory {
  id: string;
  category: string;
  fact: string;
  confidence: number;
  source: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Maps a database user_memories row to ClientMemory.
 */
export function memoryRowToClient(row: UserMemoryRow): ClientMemory {
  return {
    id: row.id,
    category: row.category,
    fact: row.fact,
    confidence: typeof row.confidence === 'number' ? row.confidence : parseFloat(String(row.confidence)) || 1.0,
    source: row.source,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Maps application Memory input to a database Insert payload.
 * Preserves client-generated UUID when provided for offline idempotency.
 */
export function memoryToInsertPayload(
  memory: { id?: string; category: string; fact: string; confidence?: number; source?: string },
  userId: string
): TablesInsert<'user_memories'> {
  const payload: TablesInsert<'user_memories'> = {
    user_id: userId,
    category: memory.category.trim(),
    fact: memory.fact.trim(),
    confidence: memory.confidence !== undefined ? memory.confidence : 1.0,
    source: memory.source?.trim() || 'User Manual Entry',
  };

  if (memory.id) {
    payload.id = memory.id;
  }

  return payload;
}

export interface ClientWorkSession {
  id: string;
  title: string;
  sessionType: 'focus' | 'break' | 'long_break';
  durationMinutes: number;
  startedAt: string;
  completedAt: string | null;
  taskId: string | null;
  createdAt: string;
}

/**
 * Maps a database work_sessions row to ClientWorkSession.
 */
export function workSessionRowToClient(row: WorkSessionRow): ClientWorkSession {
  return {
    id: row.id,
    title: row.title,
    sessionType: row.session_type,
    durationMinutes: row.duration_minutes,
    startedAt: row.started_at,
    completedAt: row.completed_at || null,
    taskId: row.task_id,
    createdAt: row.created_at,
  };
}

/**
 * Maps application WorkSession input to a database Insert payload.
 * Preserves client-generated UUID when provided for offline idempotency.
 */
export function workSessionToInsertPayload(
  session: {
    id?: string;
    title: string;
    sessionType?: 'focus' | 'break' | 'long_break';
    durationMinutes: number;
    startedAt: string;
    completedAt?: string | null;
    taskId?: string | null;
  },
  userId: string
): TablesInsert<'work_sessions'> {
  const payload: TablesInsert<'work_sessions'> = {
    user_id: userId,
    title: session.title.trim(),
    session_type: session.sessionType || 'focus',
    duration_minutes: session.durationMinutes,
    started_at: session.startedAt,
    completed_at: session.completedAt || undefined,
    task_id: session.taskId || null,
  };

  if (session.id) {
    payload.id = session.id;
  }

  return payload;
}

export interface ClientRoutine {
  id: string;
  title: string;
  scheduleType: 'interval' | 'daily' | 'weekly' | 'custom';
  intervalMinutes: number | null;
  scheduleTime: string | null;
  daysOfWeek: number[] | null;
  timezone: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

/**
 * Maps a database routines row to ClientRoutine.
 */
export function routineRowToClient(row: RoutineRow): ClientRoutine {
  return {
    id: row.id,
    title: row.title,
    scheduleType: row.schedule_type,
    intervalMinutes: row.interval_minutes,
    scheduleTime: row.schedule_time,
    daysOfWeek: row.days_of_week,
    timezone: row.timezone,
    enabled: row.enabled,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Maps application Routine input to a database Insert payload.
 */
export function routineToInsertPayload(
  routine: {
    id?: string;
    title: string;
    scheduleType: 'interval' | 'daily' | 'weekly' | 'custom';
    intervalMinutes?: number | null;
    scheduleTime?: string | null;
    daysOfWeek?: number[] | null;
    timezone?: string;
    enabled?: boolean;
  },
  userId: string
): TablesInsert<'routines'> {
  const payload: TablesInsert<'routines'> = {
    user_id: userId,
    title: routine.title.trim(),
    schedule_type: routine.scheduleType,
    interval_minutes: routine.intervalMinutes ?? null,
    schedule_time: routine.scheduleTime ?? null,
    days_of_week: routine.daysOfWeek ?? null,
    timezone: routine.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
    enabled: routine.enabled !== undefined ? routine.enabled : true,
  };

  if (routine.id) {
    payload.id = routine.id;
  }

  return payload;
}

/**
 * Extracts client theme from user_preferences row.
 */
export function userPreferencesRowToTheme(row: UserPreferencesRow): Theme {
  return row.theme;
}

export interface UserProfile {
  id: string;
  email: string | null;
  fullName: string | null;
  avatarUrl: string | null;
}

/**
 * Maps a database public.users row to UserProfile.
 */
export function userProfileRowToClient(row: UserProfileRow): UserProfile {
  return {
    id: row.id,
    email: row.email,
    fullName: row.full_name,
    avatarUrl: row.avatar_url,
  };
}
