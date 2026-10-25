export type PageId =
  | 'dashboard'
  | 'pet-studio'
  | 'assistant'
  | 'tasks'
  | 'reminders'
  | 'work-tracking'
  | 'daily-reports'
  | 'ai-memory'
  | 'integrations'
  | 'settings';

export type PetMood = 'happy' | 'attentive' | 'curious' | 'sleepy' | 'thinking' | 'playful';

export interface PetStatus {
  name: string;
  model: string;
  avatarVariant: string;
  batteryLevel: number;
  isCharging: boolean;
  hardwareConnected: boolean; // false in Phase 1 (Virtual simulator only)
  currentMood: PetMood;
  mode: 'Focus Companion' | 'Idle Patrol' | 'Rest Mode' | 'Desk Sentry';
  lastSynced: string;
  temperatureCelsius: number;
  virtualUptime: string;
}

export type TaskPriority = 'low' | 'medium' | 'high' | 'urgent';
export type TaskCategory = 'work' | 'personal' | 'robot' | 'learning';

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
}

export interface Reminder {
  id: string;
  title: string;
  time: string;
  type: 'wellness' | 'task' | 'meeting' | 'pet-routine';
  priority: 'normal' | 'important';
  done: boolean;
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
