import type {
  Task,
  Reminder,
  Theme,
  UserPreferences,
  Project,
  ProjectBoard,
  BoardColumn,
  TimeEntry,
  TimeEntryPause,
  TimeEntryIdle,
  DailyReport,
  DailyReportProjectBreakdown,
  DailyReportTaskBreakdown,
  DailyReportSessionItem,
} from '../types';
import type {
  UserProfileRow,
  TaskRow,
  ReminderRow,
  PetSettingsRow,
  UserPreferencesRow,
  UserMemoryRow,
  WorkSessionRow,
  RoutineRow,
  ProjectRow,
  ProjectBoardRow,
  BoardColumnRow,
  TimeEntryRow,
  TimeEntryPauseRow,
  TimeEntryIdleRow,
  DailyReportRow,
  TablesInsert,
  TablesUpdate,
  Json,
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
    projectId: row.project_id ?? null,
    boardId: row.board_id ?? null,
    columnId: row.column_id ?? null,
    status: (row.status as Task['status']) ?? 'todo',
    position: row.position ?? 0,
    parentTaskId: row.parent_task_id ?? null,
    actualDurationMinutes: row.actual_duration_minutes ?? 0,
    startedAt: row.started_at ?? null,
    completedAt: row.completed_at ?? null,
    statusUpdatedAt: row.status_updated_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
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
  if (task.projectId) {
    payload.project_id = task.projectId;
  }
  if (task.boardId) {
    payload.board_id = task.boardId;
  }
  if (task.columnId) {
    payload.column_id = task.columnId;
  }
  if (task.status) {
    payload.status = task.status;
  }
  if (task.position !== undefined) {
    payload.position = task.position;
  }
  if (task.parentTaskId) {
    payload.parent_task_id = task.parentTaskId;
  }
  if (task.completedAt !== undefined) {
    payload.completed_at = task.completedAt;
  }
  if (task.createdAt) {
    payload.created_at = task.createdAt;
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
  isNormalized?: boolean;
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
    isNormalized: false,
  };
}

/**
 * Converts a normalized TimeEntry into a ClientWorkSession for unified historical display.
 */
export function timeEntryToWorkSession(entry: TimeEntry, taskTitle?: string): ClientWorkSession {
  const durationMinutes = Math.max(1, Math.round(entry.activeDurationSeconds / 60));
  return {
    id: entry.id,
    title: taskTitle || (entry.taskId ? 'Task Focus Session' : 'Deep Work Session'),
    sessionType: entry.trackingSource === 'manual' ? 'focus' : 'focus',
    durationMinutes,
    startedAt: entry.startedAt,
    completedAt: entry.endedAt,
    taskId: entry.taskId,
    createdAt: entry.createdAt,
    isNormalized: true,
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

/**
 * Maps a database public.user_preferences row to the application UserPreferences domain model.
 * Enforces boolean casting, safe numeric conversions, and standard 24h HH:MM format for daily_report_time.
 */
export function userPreferencesRowToClient(row: UserPreferencesRow): UserPreferences {
  const timeRaw = row.daily_report_time ? String(row.daily_report_time).trim() : '18:00';
  const dailyReportTime = timeRaw.length >= 5 ? timeRaw.slice(0, 5) : '18:00';

  return {
    theme: row.theme === 'light' ? 'light' : 'dark',
    activityTrackingEnabled: Boolean(row.activity_tracking_enabled),
    idleThresholdSeconds:
      typeof row.idle_threshold_seconds === 'number' && Number.isFinite(row.idle_threshold_seconds)
        ? Math.max(30, Math.min(3600, row.idle_threshold_seconds))
        : 300,
    autoReportsEnabled: Boolean(row.auto_reports_enabled),
    dailyReportTime,
    telemetryRetentionDays:
      typeof row.telemetry_retention_days === 'number' && Number.isFinite(row.telemetry_retention_days)
        ? Math.max(1, Math.min(365, row.telemetry_retention_days))
        : 30,
    trackingIncludeWindowTitles: Boolean(row.tracking_include_window_titles),
    trackingIncludeProcessNames: Boolean(row.tracking_include_process_names),
    musicReactionEnabled: Boolean(row.music_reaction_enabled),
    autoBreakReminders:
      row.auto_break_reminders !== undefined && row.auto_break_reminders !== null
        ? Boolean(row.auto_break_reminders)
        : true,
  };
}

/**
 * Maps partial client UserPreferences to a database update payload for public.user_preferences.
 */
export function clientPreferencesToDbPayload(
  prefs: Partial<UserPreferences>
): TablesUpdate<'user_preferences'> {
  const payload: TablesUpdate<'user_preferences'> = {};

  if (prefs.theme !== undefined) {
    payload.theme = prefs.theme;
  }
  if (prefs.activityTrackingEnabled !== undefined) {
    payload.activity_tracking_enabled = Boolean(prefs.activityTrackingEnabled);
  }
  if (prefs.idleThresholdSeconds !== undefined) {
    payload.idle_threshold_seconds = Math.max(30, Math.min(3600, Number(prefs.idleThresholdSeconds)));
  }
  if (prefs.autoReportsEnabled !== undefined) {
    payload.auto_reports_enabled = Boolean(prefs.autoReportsEnabled);
  }
  if (prefs.dailyReportTime !== undefined) {
    const raw = prefs.dailyReportTime.trim();
    payload.daily_report_time = raw.length === 5 ? `${raw}:00` : raw;
  }
  if (prefs.telemetryRetentionDays !== undefined) {
    payload.telemetry_retention_days = Math.max(1, Math.min(365, Number(prefs.telemetryRetentionDays)));
  }
  if (prefs.trackingIncludeWindowTitles !== undefined) {
    payload.tracking_include_window_titles = Boolean(prefs.trackingIncludeWindowTitles);
  }
  if (prefs.trackingIncludeProcessNames !== undefined) {
    payload.tracking_include_process_names = Boolean(prefs.trackingIncludeProcessNames);
  }
  if (prefs.musicReactionEnabled !== undefined) {
    payload.music_reaction_enabled = Boolean(prefs.musicReactionEnabled);
  }
  if (prefs.autoBreakReminders !== undefined) {
    payload.auto_break_reminders = Boolean(prefs.autoBreakReminders);
  }

  return payload;
}

/**
 * Maps partial client UserPreferences to a database insert payload for public.user_preferences.
 */
export function clientPreferencesToInsertPayload(
  prefs: Partial<UserPreferences>,
  userId: string
): TablesInsert<'user_preferences'> {
  return {
    user_id: userId,
    ...clientPreferencesToDbPayload(prefs),
  };
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

/**
 * Maps a database public.projects row to the client Project domain model.
 */
export function projectRowToProject(row: ProjectRow): Project {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    description: row.description,
    color: row.color,
    icon: row.icon,
    isArchived: row.is_archived,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Maps application Project input to a database Insert payload.
 */
export function projectToInsertPayload(
  project: { id?: string; name: string; description?: string | null; color?: string; icon?: string; isArchived?: boolean },
  userId: string
): TablesInsert<'projects'> {
  const payload: TablesInsert<'projects'> = {
    user_id: userId,
    name: project.name.trim(),
    description: project.description ? project.description.trim() : null,
    color: project.color || 'cyan',
    icon: project.icon || 'folder',
    is_archived: Boolean(project.isArchived),
  };
  if (project.id) {
    payload.id = project.id;
  }
  return payload;
}

/**
 * Maps partial client Project updates to a database Update payload.
 */
export function projectToUpdatePayload(
  updates: Partial<Pick<Project, 'name' | 'description' | 'color' | 'icon' | 'isArchived'>>
): TablesUpdate<'projects'> {
  const payload: TablesUpdate<'projects'> = {};
  if (updates.name !== undefined) payload.name = updates.name.trim();
  if (updates.description !== undefined) payload.description = updates.description ? updates.description.trim() : null;
  if (updates.color !== undefined) payload.color = updates.color;
  if (updates.icon !== undefined) payload.icon = updates.icon;
  if (updates.isArchived !== undefined) payload.is_archived = updates.isArchived;
  return payload;
}

/**
 * Maps a database public.project_boards row to the client ProjectBoard domain model.
 */
export function projectBoardRowToProjectBoard(row: ProjectBoardRow): ProjectBoard {
  return {
    id: row.id,
    userId: row.user_id,
    projectId: row.project_id,
    name: row.name,
    description: row.description,
    boardType: row.board_type,
    position: row.position,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Maps application ProjectBoard input to a database Insert payload.
 */
export function projectBoardToInsertPayload(
  board: { id?: string; projectId: string; name: string; description?: string | null; boardType?: 'kanban' | 'scrum'; position?: number },
  userId: string
): TablesInsert<'project_boards'> {
  const payload: TablesInsert<'project_boards'> = {
    user_id: userId,
    project_id: board.projectId,
    name: board.name.trim(),
    description: board.description ? board.description.trim() : null,
    board_type: board.boardType || 'kanban',
    position: board.position ?? 0,
  };
  if (board.id) {
    payload.id = board.id;
  }
  return payload;
}

/**
 * Maps a database public.board_columns row to the client BoardColumn domain model.
 */
export function boardColumnRowToBoardColumn(row: BoardColumnRow): BoardColumn {
  return {
    id: row.id,
    userId: row.user_id,
    boardId: row.board_id,
    name: row.name,
    statusCategory: row.status_category,
    position: row.position,
    wipLimit: row.wip_limit,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Maps application BoardColumn input to a database Insert payload.
 */
export function boardColumnToInsertPayload(
  col: { id?: string; boardId: string; name: string; statusCategory: BoardColumn['statusCategory']; position?: number; wipLimit?: number },
  userId: string
): TablesInsert<'board_columns'> {
  const payload: TablesInsert<'board_columns'> = {
    user_id: userId,
    board_id: col.boardId,
    name: col.name.trim(),
    status_category: col.statusCategory,
    position: col.position ?? 0,
    wip_limit: col.wipLimit ?? 0,
  };
  if (col.id) {
    payload.id = col.id;
  }
  return payload;
}

// =============================================================================
// Time Entry Adapters (Phase 9 & Phase 10 Milestone 4)
// =============================================================================

export function timeEntryRowToTimeEntry(row: TimeEntryRow): TimeEntry {
  return {
    id: row.id,
    userId: row.user_id,
    taskId: row.task_id,
    projectId: row.project_id,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    activeDurationSeconds: row.active_duration_seconds,
    idleDurationSeconds: row.idle_duration_seconds,
    trackingSource: row.tracking_source,
    state: row.state,
    isRecovered: row.is_recovered,
    recoveryReason: row.recovery_reason,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function timeEntryToInsertPayload(
  entry: Partial<TimeEntry> & { userId: string; startedAt: string },
  userId?: string
): TablesInsert<'time_entries'> {
  const finalUserId = userId || entry.userId;
  const payload: TablesInsert<'time_entries'> = {
    user_id: finalUserId,
    task_id: entry.taskId ?? null,
    project_id: entry.projectId ?? null,
    started_at: entry.startedAt,
    ended_at: entry.endedAt ?? null,
    active_duration_seconds: entry.activeDurationSeconds ?? 0,
    idle_duration_seconds: entry.idleDurationSeconds ?? 0,
    tracking_source: entry.trackingSource ?? 'manual',
    state: entry.state ?? 'running',
    is_recovered: entry.isRecovered ?? false,
    recovery_reason: entry.recoveryReason ?? null,
  };
  if (entry.id) {
    payload.id = entry.id;
  }
  return payload;
}

export function timeEntryToUpdatePayload(
  updates: Partial<TimeEntry>
): TablesUpdate<'time_entries'> {
  const payload: TablesUpdate<'time_entries'> = {};
  if (updates.taskId !== undefined) payload.task_id = updates.taskId;
  if (updates.projectId !== undefined) payload.project_id = updates.projectId;
  if (updates.startedAt !== undefined) payload.started_at = updates.startedAt;
  if (updates.endedAt !== undefined) payload.ended_at = updates.endedAt;
  if (updates.activeDurationSeconds !== undefined) payload.active_duration_seconds = updates.activeDurationSeconds;
  if (updates.idleDurationSeconds !== undefined) payload.idle_duration_seconds = updates.idleDurationSeconds;
  if (updates.trackingSource !== undefined) payload.tracking_source = updates.trackingSource;
  if (updates.state !== undefined) payload.state = updates.state;
  if (updates.isRecovered !== undefined) payload.is_recovered = updates.isRecovered;
  if (updates.recoveryReason !== undefined) payload.recovery_reason = updates.recoveryReason;
  return payload;
}

export function timeEntryPauseRowToPause(row: TimeEntryPauseRow): TimeEntryPause {
  return {
    id: row.id,
    userId: row.user_id,
    timeEntryId: row.time_entry_id,
    pausedAt: row.paused_at,
    resumedAt: row.resumed_at,
    createdAt: row.created_at,
  };
}

export function timeEntryPauseToInsertPayload(
  pause: Partial<TimeEntryPause> & { userId: string; timeEntryId: string; pausedAt: string },
  userId?: string
): TablesInsert<'time_entry_pauses'> {
  const payload: TablesInsert<'time_entry_pauses'> = {
    user_id: userId || pause.userId,
    time_entry_id: pause.timeEntryId,
    paused_at: pause.pausedAt,
    resumed_at: pause.resumedAt ?? null,
  };
  if (pause.id) {
    payload.id = pause.id;
  }
  return payload;
}

export function timeEntryPauseToUpdatePayload(
  updates: Partial<TimeEntryPause>
): TablesUpdate<'time_entry_pauses'> {
  const payload: TablesUpdate<'time_entry_pauses'> = {};
  if (updates.resumedAt !== undefined) payload.resumed_at = updates.resumedAt;
  if (updates.pausedAt !== undefined) payload.paused_at = updates.pausedAt;
  return payload;
}

export function timeEntryIdleRowToIdle(row: TimeEntryIdleRow): TimeEntryIdle {
  return {
    id: row.id,
    userId: row.user_id,
    timeEntryId: row.time_entry_id,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    createdAt: row.created_at,
  };
}

export function timeEntryIdleToInsertPayload(
  idle: Partial<TimeEntryIdle> & { userId: string; timeEntryId: string; startedAt: string },
  userId?: string
): TablesInsert<'time_entry_idles'> {
  const payload: TablesInsert<'time_entry_idles'> = {
    user_id: userId || idle.userId,
    time_entry_id: idle.timeEntryId,
    started_at: idle.startedAt,
    ended_at: idle.endedAt ?? null,
  };
  if (idle.id) {
    payload.id = idle.id;
  }
  return payload;
}

export function timeEntryIdleToUpdatePayload(
  updates: Partial<TimeEntryIdle>
): TablesUpdate<'time_entry_idles'> {
  const payload: TablesUpdate<'time_entry_idles'> = {};
  if (updates.endedAt !== undefined) payload.ended_at = updates.endedAt;
  if (updates.startedAt !== undefined) payload.started_at = updates.startedAt;
  return payload;
}

/**
 * Maps a database public.daily_reports row to the client DailyReport domain model.
 */
export function dailyReportRowToDailyReport(row: DailyReportRow): DailyReport {
  const appBreakdown = (row.application_breakdown && typeof row.application_breakdown === 'object')
    ? (row.application_breakdown as Record<string, unknown>)
    : {};

  const taskBreakdown: DailyReportTaskBreakdown[] = Array.isArray(appBreakdown.taskBreakdown)
    ? (appBreakdown.taskBreakdown as DailyReportTaskBreakdown[])
    : [];

  const sessions: DailyReportSessionItem[] = Array.isArray(appBreakdown.sessions)
    ? (appBreakdown.sessions as DailyReportSessionItem[])
    : [];

  const totalPausedSeconds = typeof appBreakdown.totalPausedSeconds === 'number'
    ? appBreakdown.totalPausedSeconds
    : 0;

  const sessionCount = typeof appBreakdown.sessionCount === 'number'
    ? appBreakdown.sessionCount
    : sessions.length;

  const totalTrackedSeconds = typeof appBreakdown.totalTrackedSeconds === 'number'
    ? appBreakdown.totalTrackedSeconds
    : row.total_focus_seconds + row.total_idle_seconds + totalPausedSeconds;

  const projectBreakdown: DailyReportProjectBreakdown[] = Array.isArray(row.project_breakdown)
    ? (row.project_breakdown as unknown as DailyReportProjectBreakdown[])
    : [];

  const actionableSuggestions: string[] = Array.isArray(row.actionable_suggestions)
    ? (row.actionable_suggestions as unknown as string[])
    : [];

  return {
    id: row.id,
    userId: row.user_id,
    reportDate: row.report_date,
    totalFocusSeconds: row.total_focus_seconds,
    totalPausedSeconds,
    totalIdleSeconds: row.total_idle_seconds,
    totalTrackedSeconds,
    sessionCount,
    tasksCompletedCount: row.tasks_completed_count,
    tasksCreatedCount: row.tasks_created_count,
    projectBreakdown,
    taskBreakdown,
    sessions,
    aiNarrative: row.ai_narrative,
    actionableSuggestions,
    generationStatus: row.generation_status,
    reportingTimeZone: typeof appBreakdown.reportingTimeZone === 'string' ? appBreakdown.reportingTimeZone : undefined,
    outstandingTasksCount: typeof appBreakdown.outstandingTasksCount === 'number' ? appBreakdown.outstandingTasksCount : undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Maps a client DailyReport to a database insert payload for public.daily_reports.
 */
export function dailyReportToInsertPayload(
  report: DailyReport,
  userId?: string
): TablesInsert<'daily_reports'> {
  const payload: TablesInsert<'daily_reports'> = {
    user_id: userId || report.userId,
    report_date: report.reportDate,
    total_focus_seconds: report.totalFocusSeconds,
    total_idle_seconds: report.totalIdleSeconds,
    tasks_completed_count: report.tasksCompletedCount,
    tasks_created_count: report.tasksCreatedCount,
    project_breakdown: report.projectBreakdown as unknown as Json,
    application_breakdown: {
      taskBreakdown: report.taskBreakdown,
      sessions: report.sessions,
      totalPausedSeconds: report.totalPausedSeconds,
      totalTrackedSeconds: report.totalTrackedSeconds,
      sessionCount: report.sessionCount,
      reportingTimeZone: report.reportingTimeZone,
      outstandingTasksCount: report.outstandingTasksCount,
    } as unknown as Json,
    ai_narrative: report.aiNarrative,
    actionable_suggestions: report.actionableSuggestions as unknown as Json,
    generation_status: report.generationStatus,
  };

  if (report.id) {
    payload.id = report.id;
  }

  return payload;
}

/**
 * Maps partial DailyReport updates to a database update payload.
 */
export function dailyReportToUpdatePayload(
  updates: Partial<DailyReport>
): TablesUpdate<'daily_reports'> {
  const payload: TablesUpdate<'daily_reports'> = {};

  if (updates.totalFocusSeconds !== undefined) payload.total_focus_seconds = updates.totalFocusSeconds;
  if (updates.totalIdleSeconds !== undefined) payload.total_idle_seconds = updates.totalIdleSeconds;
  if (updates.tasksCompletedCount !== undefined) payload.tasks_completed_count = updates.tasksCompletedCount;
  if (updates.tasksCreatedCount !== undefined) payload.tasks_created_count = updates.tasksCreatedCount;
  if (updates.projectBreakdown !== undefined) payload.project_breakdown = updates.projectBreakdown as unknown as Json;
  if (updates.aiNarrative !== undefined) payload.ai_narrative = updates.aiNarrative;
  if (updates.actionableSuggestions !== undefined) payload.actionable_suggestions = updates.actionableSuggestions as unknown as Json;
  if (updates.generationStatus !== undefined) payload.generation_status = updates.generationStatus;

  if (
    updates.taskBreakdown !== undefined ||
    updates.sessions !== undefined ||
    updates.totalPausedSeconds !== undefined ||
    updates.totalTrackedSeconds !== undefined ||
    updates.sessionCount !== undefined
  ) {
    payload.application_breakdown = {
      taskBreakdown: updates.taskBreakdown ?? [],
      sessions: updates.sessions ?? [],
      totalPausedSeconds: updates.totalPausedSeconds ?? 0,
      totalTrackedSeconds: updates.totalTrackedSeconds ?? 0,
      sessionCount: updates.sessionCount ?? 0,
    } as unknown as Json;
  }

  return payload;
}
