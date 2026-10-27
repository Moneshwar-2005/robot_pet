/**
 * Kuro Safe Automation Execution Engine
 *
 * Scope: Phase 5 (Safe User-Controlled Automation)
 *
 * Implements constrained, deterministic automation routines:
 * - Scoped by user ID (or 'demo')
 * - User-controllable global & per-rule toggles
 * - Whitelisted triggers & actions only
 * - Data modifications strictly require user confirmation
 * - Strong idempotency guards against duplicate triggers
 * - Zero shell execution, zero arbitrary code, zero AI-induced unconfirmed writes
 */

import type {
  AutomationRule,
  AutomationExecutionLog,
  AutomationState,
  AutomationActionConfig,
} from './types.ts';
import type { PetMood, Reminder } from '../../types';
import { formatLocalDateString } from '../formatters.ts';
import { dispatchReminderNotification } from '../notifications.ts';

export const DEFAULT_AUTOMATION_RULES: AutomationRule[] = [
  {
    id: 'rule-hydration',
    name: 'Hydration Chime Routine',
    description: 'Prompts you for a water break every 45 minutes during active focus sessions.',
    category: 'wellness',
    trigger: 'focus_interval_reached',
    triggerConfig: { intervalMinutes: 45 },
    action: 'notify_user',
    actionConfig: {
      notificationTitle: 'Hydration Chime',
      notificationBody: 'Time for a quick sip of water! Kuro gentle chime.',
    },
    enabled: true,
    requiresConfirmation: false,
    executionCount: 0,
  },
  {
    id: 'rule-posture',
    name: 'Posture Sentry Routine',
    description: 'Visual head tilt cue and shoulder stretch prompt every 60 minutes of focus.',
    category: 'wellness',
    trigger: 'focus_interval_reached',
    triggerConfig: { intervalMinutes: 60 },
    action: 'notify_user',
    actionConfig: {
      notificationTitle: 'Posture Sentry',
      notificationBody: 'Roll your shoulders, sit tall, and adjust your monitor distance.',
    },
    enabled: true,
    requiresConfirmation: false,
    executionCount: 0,
  },
  {
    id: 'rule-focus-wrapup',
    name: 'Focus Session Wrap-up Routine',
    description: 'Schedules a desk stretch reminder after you complete a focus session.',
    category: 'productivity',
    trigger: 'focus_session_completed',
    action: 'create_reminder',
    actionConfig: {
      reminderTitle: 'Desk stretch & screen break (5 mins)',
      reminderType: 'wellness',
      reminderPriority: 'normal',
    },
    enabled: true,
    requiresConfirmation: true, // Data creation strictly requires user confirmation
    executionCount: 0,
  },
  {
    id: 'rule-daily-debrief',
    name: 'End of Day Debrief Routine',
    description: 'Prompts you at 7:00 PM to review daily focus sessions and generate your daily summary.',
    category: 'productivity',
    trigger: 'daily_schedule',
    triggerConfig: { scheduleTime: '19:00' },
    action: 'prompt_daily_report',
    actionConfig: {
      notificationTitle: 'Daily Debrief Ready',
      notificationBody: 'Review your focus sessions and generate your productivity report.',
    },
    enabled: true,
    requiresConfirmation: true, // Prompts confirmation before redirecting/generating
    executionCount: 0,
  },
  {
    id: 'rule-all-tasks',
    name: 'Task Backlog Celebration Routine',
    description: 'Sets Kuro to happy expression when all pending tasks for the day are complete.',
    category: 'pet',
    trigger: 'all_tasks_completed',
    action: 'set_pet_mood',
    actionConfig: { targetMood: 'happy' },
    enabled: true,
    requiresConfirmation: false,
    executionCount: 0,
  },
];

function getStorageKey(scope: string): string {
  return `kuro_automation_${scope || 'demo'}`;
}

/**
 * Loads automation state from local storage for the specified scope.
 */
export function loadAutomationState(scope = 'demo'): AutomationState {
  try {
    const raw = localStorage.getItem(getStorageKey(scope));
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed.globalEnabled === 'boolean' && Array.isArray(parsed.rules)) {
        return {
          globalEnabled: parsed.globalEnabled,
          rules: parsed.rules,
          logs: Array.isArray(parsed.logs) ? parsed.logs.slice(-50) : [],
        };
      }
    }
  } catch {
    // ignore
  }

  return {
    globalEnabled: true,
    rules: DEFAULT_AUTOMATION_RULES.map((r) => ({ ...r })),
    logs: [],
  };
}

/**
 * Saves automation state to local storage for the specified scope.
 */
export function saveAutomationState(scope: string, state: AutomationState): void {
  try {
    const payload = {
      globalEnabled: state.globalEnabled,
      rules: state.rules,
      logs: state.logs.slice(-50),
    };
    localStorage.setItem(getStorageKey(scope), JSON.stringify(payload));
  } catch {
    // ignore
  }
}

export interface EvaluateContext {
  scope: string;
  focusMinutesToday: number;
  lastSessionDurationMinutes?: number;
  completedTasksCount: number;
  pendingTasksCount: number;
  now?: Date;
  onAddReminder?: (newReminder: Omit<Reminder, 'id'>) => Promise<void> | void;
  onSetPetMood?: (mood: PetMood) => void;
  onInAppAlert?: (title: string, body: string) => void;
  onPromptReport?: (title: string, body: string) => void;
}

/**
 * Core Automation Evaluation Cycle
 * Evaluates triggers deterministically, checks idempotency guards, logs execution,
 * and requests confirmation for data-modifying actions.
 */
export function evaluateAutomations(
  state: AutomationState,
  ctx: EvaluateContext
): {
  updatedState: AutomationState;
  executedLogs: AutomationExecutionLog[];
} {
  if (!state.globalEnabled) {
    return { updatedState: state, executedLogs: [] };
  }

  const now = ctx.now ?? new Date();
  const todayStr = formatLocalDateString(now);
  const currentHour = now.getHours();
  const currentMinute = now.getMinutes();
  const currentTimeMinutes = currentHour * 60 + currentMinute;

  const newLogs: AutomationExecutionLog[] = [];
  const updatedRules = state.rules.map((rule) => {
    if (!rule.enabled) return rule;

    let shouldTrigger = false;
    let triggerReason = '';

    // Check Trigger Conditions
    switch (rule.trigger) {
      case 'focus_interval_reached': {
        const intervalMins = rule.triggerConfig?.intervalMinutes || 45;
        if (ctx.focusMinutesToday >= intervalMins) {
          const lastExec = rule.lastExecutedAt ? new Date(rule.lastExecutedAt).getTime() : 0;
          const elapsedSinceExecMs = now.getTime() - lastExec;
          const intervalMs = intervalMins * 60 * 1000;

          // Idempotency: must have elapsed at least intervalMs since last execution
          if (elapsedSinceExecMs >= intervalMs) {
            shouldTrigger = true;
            triggerReason = `Focus threshold reached (${ctx.focusMinutesToday}m >= ${intervalMins}m)`;
          }
        }
        break;
      }

      case 'daily_schedule': {
        const schedTime = rule.triggerConfig?.scheduleTime || '19:00';
        const [targetHour, targetMinute] = schedTime.split(':').map((v) => parseInt(v, 10));
        const targetTimeMinutes = targetHour * 60 + (targetMinute || 0);

        // Idempotency: runs once per calendar day when current time >= target time
        if (rule.lastExecutionDate !== todayStr && currentTimeMinutes >= targetTimeMinutes) {
          shouldTrigger = true;
          triggerReason = `Daily schedule time reached (${schedTime})`;
        }
        break;
      }

      case 'all_tasks_completed': {
        // Triggers once per day when tasks exist and pending is 0
        if (
          rule.lastExecutionDate !== todayStr &&
          ctx.completedTasksCount > 0 &&
          ctx.pendingTasksCount === 0
        ) {
          shouldTrigger = true;
          triggerReason = `All tasks for today completed (${ctx.completedTasksCount} tasks done)`;
        }
        break;
      }

      case 'focus_session_completed': {
        // Triggered only explicitly via executeTrigger
        break;
      }
    }

    if (!shouldTrigger) {
      return rule;
    }

    const logId = `log-${Date.now()}-${rule.id}`;

    // Path A: Requires User Confirmation (Data modification)
    if (rule.requiresConfirmation) {
      const pendingLog: AutomationExecutionLog = {
        id: logId,
        ruleId: rule.id,
        ruleName: rule.name,
        timestamp: now.toISOString(),
        status: 'pending_confirmation',
        message: `${triggerReason} — Pending confirmation: ${rule.description}`,
        actionType: rule.action,
        actionConfig: rule.actionConfig,
      };

      newLogs.push(pendingLog);

      // Do not update execution count until confirmed
      return {
        ...rule,
        lastExecutionDate: todayStr,
      };
    }

    // Path B: Automatic Safe Action (Non-destructive Notification or Pet Mood)
    try {
      executeSafeAction(rule.action, rule.actionConfig, ctx);

      const successLog: AutomationExecutionLog = {
        id: logId,
        ruleId: rule.id,
        ruleName: rule.name,
        timestamp: now.toISOString(),
        status: 'success',
        message: `${triggerReason} — Executed: ${rule.name}`,
        actionType: rule.action,
        actionConfig: rule.actionConfig,
      };

      newLogs.push(successLog);

      return {
        ...rule,
        lastExecutedAt: now.toISOString(),
        lastExecutionDate: todayStr,
        executionCount: rule.executionCount + 1,
      };
    } catch (err) {
      const failLog: AutomationExecutionLog = {
        id: logId,
        ruleId: rule.id,
        ruleName: rule.name,
        timestamp: now.toISOString(),
        status: 'failed',
        message: `Execution failed: ${err instanceof Error ? err.message : 'Unknown error'}`,
        actionType: rule.action,
        actionConfig: rule.actionConfig,
      };
      newLogs.push(failLog);
      return rule;
    }
  });

  const nextState: AutomationState = {
    ...state,
    rules: updatedRules,
    logs: [...state.logs, ...newLogs].slice(-50),
  };

  saveAutomationState(ctx.scope, nextState);
  return { updatedState: nextState, executedLogs: newLogs };
}

/**
 * Executes explicitly whitelisted safe actions.
 * Never executes arbitrary code, shell commands, or unwhitelisted operations.
 */
export function executeSafeAction(
  action: AutomationRule['action'],
  config: AutomationActionConfig | undefined,
  ctx: EvaluateContext
): void {
  switch (action) {
    case 'notify_user': {
      const title = config?.notificationTitle || 'Kuro Routine Alert';
      const body = config?.notificationBody || 'Time for a planned routine check-in.';

      // Dispatch native notification if granted
      dispatchReminderNotification(
        {
          id: `auto-${Date.now()}`,
          title,
          time: new Date().toISOString(),
          type: 'wellness',
          priority: 'normal',
          done: false,
        },
        () => {
          if (ctx.onInAppAlert) {
            ctx.onInAppAlert(title, body);
          }
        }
      );
      break;
    }

    case 'set_pet_mood': {
      if (config?.targetMood && ctx.onSetPetMood) {
        ctx.onSetPetMood(config.targetMood);
      }
      break;
    }

    case 'create_reminder': {
      if (ctx.onAddReminder) {
        const title = config?.reminderTitle || 'Kuro Routine Reminder';
        const type = config?.reminderType || 'wellness';
        const priority = config?.reminderPriority || 'normal';
        void ctx.onAddReminder({
          title,
          time: new Date().toISOString(),
          type,
          priority,
          done: false,
        });
      }
      break;
    }

    case 'prompt_daily_report': {
      if (ctx.onPromptReport) {
        ctx.onPromptReport(
          config?.notificationTitle || 'Daily Debrief Ready',
          config?.notificationBody || 'Review today’s focus sessions and accomplishments.'
        );
      }
      break;
    }
  }
}
