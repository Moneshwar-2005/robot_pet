import type { SyncStatus } from './sync';
export type { SyncStatus } from './sync';

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
