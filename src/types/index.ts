import type { SyncStatus } from './sync';
export type { SyncStatus } from './sync';

export type PageId =
  | 'dashboard'
  | 'pet-studio'
  | 'activities'
  | 'assistant'
  | 'tasks'
  | 'reminders'
  | 'work-tracking'
  | 'daily-reports'
  | 'ai-memory'
  | 'integrations'
  | 'settings';

export type PetMood =
  | 'idle'
  | 'attentive'
  | 'focused'
  | 'curious'
  | 'thinking'
  | 'happy'
  | 'excited'
  | 'sleepy'
  | 'playful'
  | 'caring'
  | 'surprised'
  | 'confused'
  | 'worried'
  | 'proud'
  | 'listening'
  | 'speaking'
  | 'error';

export type PetMouthStyle =
  | 'closed_smile'
  | 'open_smile'
  | 'laugh'
  | 'tiny_mouth'
  | 'surprised_o'
  | 'worried_curve'
  | 'confused_crooked'
  | 'focused_line'
  | 'sleepy_mouth'
  | 'speaking';

export type PetEyeStyle =
  | 'standard'
  | 'blink'
  | 'squint'
  | 'happy_curved'
  | 'curious_widened'
  | 'sleepy_lids'
  | 'asymmetrical_wink'
  | 'gaze_drift';

export type PowerSource = 'usb_power' | 'battery' | 'simulated' | 'offline';

export type ReactionFrequency = 'quiet' | 'balanced' | 'expressive';

export type BrowserDomainCategory =
  | 'coding'
  | 'documentation'
  | 'work'
  | 'learning'
  | 'communication'
  | 'entertainment'
  | 'private_excluded';

export interface AutonomousPetSettings {
  autonomousEnabled: boolean;
  reactionFrequency: ReactionFrequency;
  browserAwarenessEnabled: boolean;
  excludedDomains: string[];
  pausedUntil: number | null;
}

export interface PetStatus {
  name: string;
  model: string;
  avatarVariant: string;
  hardwareConnected: boolean; // false until physical robot hardware is paired
  powerSource: PowerSource;
  hasPhysicalBattery: boolean; // false on desktop box companion (USB powered)
  batteryLevel: number | null; // null when no physical battery sensor is connected/validated
  isCharging?: boolean;
  currentMood: PetMood;
  mode: 'Focus Companion' | 'Idle Patrol' | 'Rest Mode' | 'Desk Sentry';
  lastSynced: string;
  temperatureCelsius: number | null;
  virtualUptime: string;
}

export type TaskPriority = 'low' | 'medium' | 'high' | 'urgent';
export type TaskCategory = 'work' | 'personal' | 'robot' | 'learning';
export type TaskStatusCategory = 'backlog' | 'todo' | 'in_progress' | 'done' | 'cancelled';

export interface Task {
  id: string;
  title: string;
  category: TaskCategory;
  priority: TaskPriority;
  dueDate: string | null;
  dueTime: string | null;
  estimatedMinutes: number;
  completed: boolean;
  tags: string[];
  description?: string;
  syncStatus?: SyncStatus;
  projectId?: string | null;
  boardId?: string | null;
  columnId?: string | null;
  status?: TaskStatusCategory;
  position?: number;
  parentTaskId?: string | null;
  actualDurationMinutes?: number;
  startedAt?: string | null;
  completedAt?: string | null;
  statusUpdatedAt?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface Project {
  id: string;
  userId: string;
  name: string;
  description?: string | null;
  color: string;
  icon: string;
  isArchived: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectBoard {
  id: string;
  userId: string;
  projectId: string;
  name: string;
  description?: string | null;
  boardType: 'kanban' | 'scrum';
  position: number;
  createdAt: string;
  updatedAt: string;
}

export interface BoardColumn {
  id: string;
  userId: string;
  boardId: string;
  name: string;
  statusCategory: TaskStatusCategory;
  position: number;
  wipLimit: number;
  createdAt: string;
  updatedAt: string;
}

export interface TaskLabel {
  id: string;
  userId: string;
  projectId?: string | null;
  name: string;
  color: string;
  createdAt: string;
}

export interface Reminder {
  id: string;
  title: string;
  time: string;
  type: 'wellness' | 'task' | 'meeting' | 'pet-routine';
  priority: 'normal' | 'important';
  done: boolean;
  syncStatus?: SyncStatus;
}

export interface WorkSummary {
  focusMinutesToday: number;
  focusGoalMinutes: number;
  completedTasksToday: number;
  totalTasksToday: number;
  streakDays: number;
  productivityScore: number;
  dailyDistribution: Array<{ day: string; hours: number }>;
}

export interface NavigationItem {
  id: PageId;
  label: string;
  description: string;
  badge?: string;
}

export type Theme = 'dark' | 'light';

export interface UserPreferences {
  theme: Theme;
  activityTrackingEnabled: boolean;
  idleThresholdSeconds: number;
  autoReportsEnabled: boolean;
  dailyReportTime: string;
  telemetryRetentionDays: number;
  trackingIncludeWindowTitles: boolean;
  trackingIncludeProcessNames: boolean;
  musicReactionEnabled: boolean;
  autoBreakReminders: boolean;
}

export const DEFAULT_USER_PREFERENCES: Readonly<UserPreferences> = {
  theme: 'dark',
  activityTrackingEnabled: false,
  idleThresholdSeconds: 300,
  autoReportsEnabled: false,
  dailyReportTime: '18:00',
  telemetryRetentionDays: 30,
  trackingIncludeWindowTitles: false,
  trackingIncludeProcessNames: false,
  musicReactionEnabled: false,
  autoBreakReminders: true,
};

// =============================================================================
// Kuro Normalized Time Entries & Timer Types (Phase 9 & Phase 10 Milestone 4)
// =============================================================================

export type TimeEntryState = 'running' | 'paused' | 'completed' | 'quarantined';
export type TimeEntryTrackingSource = 'manual' | 'companion' | 'pomodoro';

export interface TimeEntry {
  id: string;
  userId: string;
  taskId: string | null;
  projectId: string | null;
  startedAt: string;
  endedAt: string | null;
  activeDurationSeconds: number;
  idleDurationSeconds: number;
  trackingSource: TimeEntryTrackingSource;
  state: TimeEntryState;
  isRecovered: boolean;
  recoveryReason: string | null;
  createdAt: string;
  updatedAt: string;
  syncStatus?: SyncStatus;
}

export interface TimeEntryPause {
  id: string;
  userId: string;
  timeEntryId: string;
  pausedAt: string;
  resumedAt: string | null;
  createdAt: string;
  syncStatus?: SyncStatus;
}

export interface TimeEntryIdle {
  id: string;
  userId: string;
  timeEntryId: string;
  startedAt: string;
  endedAt: string | null;
  createdAt: string;
  syncStatus?: SyncStatus;
}

export interface ActiveTimerState {
  activeEntry: TimeEntry | null;
  activePauses: TimeEntryPause[];
  activeIdles: TimeEntryIdle[];
  timerStatus: 'idle' | 'running' | 'paused';
  elapsedSeconds: number;
  activeTask: Task | null;
  activeProject: Project | null;
}

// =============================================================================
// Kuro Daily Reports & Work Summaries (Phase 9 & Phase 10 Milestone 5)
// =============================================================================

export interface DailyReportProjectBreakdown {
  projectId: string | null;
  project: string;
  minutes: number;
  activeSeconds: number;
  sessionCount: number;
  completedTasksCount: number;
}

export interface DailyReportTaskBreakdown {
  taskId: string;
  title: string;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  completed: boolean;
  projectId: string | null;
  projectName: string;
  timeSpentSeconds: number;
}

export interface DailyReportSessionItem {
  id: string;
  title: string;
  startedAt: string;
  endedAt: string | null;
  activeSeconds: number;
  pausedSeconds: number;
  idleSeconds: number;
  projectId: string | null;
  projectName: string;
  taskId: string | null;
  taskTitle: string | null;
  source: 'normalized' | 'legacy';
}

export interface DailyReport {
  id: string;
  userId: string;
  reportDate: string; // YYYY-MM-DD
  totalFocusSeconds: number;
  totalPausedSeconds: number;
  totalIdleSeconds: number;
  totalTrackedSeconds: number;
  sessionCount: number;
  tasksCompletedCount: number;
  tasksCreatedCount: number;
  projectBreakdown: DailyReportProjectBreakdown[];
  taskBreakdown: DailyReportTaskBreakdown[];
  sessions: DailyReportSessionItem[];
  aiNarrative: string | null;
  actionableSuggestions: string[];
  generationStatus: 'pending' | 'generating' | 'completed' | 'failed';
  hasPendingSync?: boolean;
  reportingTimeZone?: string;
  outstandingTasksCount?: number;
  createdAt: string;
  updatedAt: string;
}
