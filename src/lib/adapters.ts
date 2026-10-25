import type { Task, Reminder, Theme } from '../types';
import type {
  UserProfileRow,
  TaskRow,
  ReminderRow,
  PetSettingsRow,
  UserPreferencesRow,
  UserMemoryRow,
  WorkSessionRow,
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
}

/**
 * Maps a database pet_settings row to client settings model.
 */
export function petSettingsRowToClient(row: PetSettingsRow): ClientPetSettings {
  return {
    petName: row.pet_name,
    avatarVariant: row.avatar_variant,
    eyeShape: row.eye_shape,
    glowColor: row.glow_color,
    playfulness: row.playfulness,
    focusDiscipline: row.focus_discipline,
  };
}

/**
 * Builds an update payload for pet_settings table.
 */
export function petSettingsToUpdatePayload(
  settings: Partial<ClientPetSettings>
): TablesUpdate<'pet_settings'> {
  const payload: TablesUpdate<'pet_settings'> = {};
  if (settings.petName !== undefined) payload.pet_name = settings.petName.trim();
  if (settings.avatarVariant !== undefined) payload.avatar_variant = settings.avatarVariant;
  if (settings.eyeShape !== undefined) payload.eye_shape = settings.eyeShape;
  if (settings.glowColor !== undefined) payload.glow_color = settings.glowColor;
  if (settings.playfulness !== undefined) payload.playfulness = settings.playfulness;
  if (settings.focusDiscipline !== undefined) payload.focus_discipline = settings.focusDiscipline;
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
 */
export function memoryToInsertPayload(
  memory: { category: string; fact: string; confidence?: number; source?: string },
  userId: string
): TablesInsert<'user_memories'> {
  return {
    user_id: userId,
    category: memory.category.trim(),
    fact: memory.fact.trim(),
    confidence: memory.confidence !== undefined ? memory.confidence : 1.0,
    source: memory.source?.trim() || 'User Manual Entry',
  };
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
 */
export function workSessionToInsertPayload(
  session: {
    title: string;
    sessionType?: 'focus' | 'break' | 'long_break';
    durationMinutes: number;
    startedAt: string;
    completedAt?: string | null;
    taskId?: string | null;
  },
  userId: string
): TablesInsert<'work_sessions'> {
  return {
    user_id: userId,
    title: session.title.trim(),
    session_type: session.sessionType || 'focus',
    duration_minutes: session.durationMinutes,
    started_at: session.startedAt,
    completed_at: session.completedAt || undefined,
    task_id: session.taskId || null,
  };
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
