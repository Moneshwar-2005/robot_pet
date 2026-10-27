/**
 * Kuro Safe Automation Framework Types
 *
 * Scope: Phase 5 (Safe User-Controlled Automation)
 *
 * SAFETY PRINCIPLES:
 * 1. Explicitly whitelisted triggers and actions only.
 * 2. Zero arbitrary shell commands, code execution, or unrestricted scripts.
 * 3. Data-changing or destructive actions strictly require user confirmation.
 * 4. Idempotency guarantees prevent duplicate executions.
 * 5. Fully offline and user-controllable.
 */

import type { PetMood, Reminder } from '../../types';

export type AutomationTrigger =
  | 'focus_session_completed'
  | 'focus_interval_reached'
  | 'daily_schedule'
  | 'all_tasks_completed';

export type AutomationAction =
  | 'notify_user'
  | 'create_reminder'
  | 'prompt_daily_report'
  | 'set_pet_mood';

export interface AutomationTriggerConfig {
  intervalMinutes?: number; // e.g. 45 for hydration, 60 for posture
  scheduleTime?: string; // e.g. "19:00" for daily debrief
}

export interface AutomationActionConfig {
  notificationTitle?: string;
  notificationBody?: string;
  reminderTitle?: string;
  reminderType?: Reminder['type'];
  reminderPriority?: Reminder['priority'];
  targetMood?: PetMood;
}

export interface AutomationRule {
  id: string;
  name: string;
  description: string;
  category: 'wellness' | 'productivity' | 'pet';
  trigger: AutomationTrigger;
  triggerConfig?: AutomationTriggerConfig;
  action: AutomationAction;
  actionConfig?: AutomationActionConfig;
  enabled: boolean;
  requiresConfirmation: boolean;
  lastExecutedAt?: string | null;
  lastExecutionDate?: string | null; // "YYYY-MM-DD" for daily idempotency
  executionCount: number;
}

export interface AutomationExecutionLog {
  id: string;
  ruleId: string;
  ruleName: string;
  timestamp: string;
  status: 'success' | 'pending_confirmation' | 'confirmed' | 'cancelled' | 'skipped' | 'failed';
  message: string;
  actionType: AutomationAction;
  actionConfig?: AutomationActionConfig;
}

export interface AutomationState {
  globalEnabled: boolean;
  rules: AutomationRule[];
  logs: AutomationExecutionLog[];
}
