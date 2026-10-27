/**
 * React Hook for Kuro Safe Automation Management
 *
 * Scope: Phase 5
 *
 * Exposes user-controllable toggles, pending confirmations for data-changing actions,
 * logs, and manual triggers.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import type { AutomationRule, AutomationExecutionLog, AutomationState } from '../lib/automation/types';
import {
  loadAutomationState,
  saveAutomationState,
  evaluateAutomations,
  executeSafeAction,
  DEFAULT_AUTOMATION_RULES,
  type EvaluateContext,
} from '../lib/automation/automationEngine';
import { useAuth } from '../context/useAuth';
import type { PetMood, Reminder } from '../types';

export interface UseAutomationOptions {
  focusMinutesToday?: number;
  completedTasksCount?: number;
  pendingTasksCount?: number;
  onAddReminder?: (newReminder: Omit<Reminder, 'id'>) => Promise<void> | void;
  onSetPetMood?: (mood: PetMood) => void;
  onInAppAlert?: (title: string, body: string) => void;
  onNavigate?: (page: 'daily-reports' | 'reminders') => void;
}

export interface UseAutomationReturn {
  globalEnabled: boolean;
  setGlobalEnabled: (enabled: boolean) => void;
  rules: AutomationRule[];
  toggleRule: (ruleId: string) => void;
  resetRules: () => void;
  pendingConfirmations: AutomationExecutionLog[];
  confirmAction: (logId: string) => Promise<void>;
  cancelAction: (logId: string) => void;
  logs: AutomationExecutionLog[];
  clearLogs: () => void;
  triggerManual: (ruleId: string) => Promise<boolean>;
}

export function useAutomation(options: UseAutomationOptions = {}): UseAutomationReturn {
  const { user } = useAuth();
  const scope = user?.id || 'demo';

  const [state, setState] = useState<AutomationState>(() => loadAutomationState(scope));
  const isMountedRef = useRef(true);
  const checkTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const optionsRef = useRef(options);
  useEffect(() => {
    optionsRef.current = options;
  });

  // Switch state cleanly when scope / user changes (Account Isolation)
  useEffect(() => {
    let isCurrent = true;
    queueMicrotask(() => {
      if (isCurrent) {
        setState(loadAutomationState(scope));
      }
    });
    return () => {
      isCurrent = false;
    };
  }, [scope]);

  const pendingConfirmations = state.logs.filter((l) => l.status === 'pending_confirmation');

  const setGlobalEnabled = useCallback(
    (enabled: boolean) => {
      setState((prev) => {
        const next: AutomationState = { ...prev, globalEnabled: enabled };
        saveAutomationState(scope, next);
        return next;
      });
    },
    [scope]
  );

  const toggleRule = useCallback(
    (ruleId: string) => {
      setState((prev) => {
        const nextRules = prev.rules.map((r) =>
          r.id === ruleId ? { ...r, enabled: !r.enabled } : r
        );
        const next: AutomationState = { ...prev, rules: nextRules };
        saveAutomationState(scope, next);
        return next;
      });
    },
    [scope]
  );

  const resetRules = useCallback(() => {
    setState((prev) => {
      const next: AutomationState = {
        ...prev,
        rules: DEFAULT_AUTOMATION_RULES.map((r) => ({ ...r })),
      };
      saveAutomationState(scope, next);
      return next;
    });
  }, [scope]);

  const clearLogs = useCallback(() => {
    setState((prev) => {
      const next: AutomationState = { ...prev, logs: [] };
      saveAutomationState(scope, next);
      return next;
    });
  }, [scope]);

  const confirmAction = useCallback(
    async (logId: string) => {
      const targetLog = state.logs.find((l) => l.id === logId);
      if (!targetLog || targetLog.status !== 'pending_confirmation') return;

      const ctx: EvaluateContext = {
        scope,
        focusMinutesToday: options.focusMinutesToday || 0,
        completedTasksCount: options.completedTasksCount || 0,
        pendingTasksCount: options.pendingTasksCount || 0,
        onAddReminder: options.onAddReminder,
        onSetPetMood: options.onSetPetMood,
        onInAppAlert: options.onInAppAlert,
        onPromptReport: (_t, _b) => {
          if (options.onNavigate) options.onNavigate('daily-reports');
        },
      };

      try {
        executeSafeAction(targetLog.actionType, targetLog.actionConfig, ctx);

        setState((prev) => {
          const updatedLogs = prev.logs.map((l) =>
            l.id === logId
              ? {
                  ...l,
                  status: 'confirmed' as const,
                  message: `User confirmed: ${l.ruleName}`,
                }
              : l
          );

          const updatedRules = prev.rules.map((r) =>
            r.id === targetLog.ruleId
              ? {
                  ...r,
                  lastExecutedAt: new Date().toISOString(),
                  executionCount: r.executionCount + 1,
                }
              : r
          );

          const next: AutomationState = { ...prev, rules: updatedRules, logs: updatedLogs };
          saveAutomationState(scope, next);
          return next;
        });
      } catch (err) {
        setState((prev) => {
          const updatedLogs = prev.logs.map((l) =>
            l.id === logId
              ? {
                  ...l,
                  status: 'failed' as const,
                  message: `Execution failed: ${err instanceof Error ? err.message : 'Unknown error'}`,
                }
              : l
          );
          const next: AutomationState = { ...prev, logs: updatedLogs };
          saveAutomationState(scope, next);
          return next;
        });
      }
    },
    [state.logs, scope, options]
  );

  const cancelAction = useCallback(
    (logId: string) => {
      setState((prev) => {
        const updatedLogs = prev.logs.map((l) =>
          l.id === logId
            ? { ...l, status: 'cancelled' as const, message: `User cancelled action: ${l.ruleName}` }
            : l
        );
        const next: AutomationState = { ...prev, logs: updatedLogs };
        saveAutomationState(scope, next);
        return next;
      });
    },
    [scope]
  );

  const triggerManual = useCallback(
    async (ruleId: string): Promise<boolean> => {
      const rule = state.rules.find((r) => r.id === ruleId);
      if (!rule) return false;

      const ctx: EvaluateContext = {
        scope,
        focusMinutesToday: options.focusMinutesToday || 0,
        completedTasksCount: options.completedTasksCount || 0,
        pendingTasksCount: options.pendingTasksCount || 0,
        onAddReminder: options.onAddReminder,
        onSetPetMood: options.onSetPetMood,
        onInAppAlert: options.onInAppAlert,
        onPromptReport: (_t, _b) => {
          if (options.onNavigate) options.onNavigate('daily-reports');
        },
      };

      try {
        executeSafeAction(rule.action, rule.actionConfig, ctx);

        setState((prev) => {
          const newLog: AutomationExecutionLog = {
            id: `manual-${Date.now()}-${rule.id}`,
            ruleId: rule.id,
            ruleName: rule.name,
            timestamp: new Date().toISOString(),
            status: 'success',
            message: `Manually triggered: ${rule.name}`,
            actionType: rule.action,
            actionConfig: rule.actionConfig,
          };

          const updatedRules = prev.rules.map((r) =>
            r.id === rule.id
              ? {
                  ...r,
                  lastExecutedAt: new Date().toISOString(),
                  executionCount: r.executionCount + 1,
                }
              : r
          );

          const next: AutomationState = {
            ...prev,
            rules: updatedRules,
            logs: [...prev.logs, newLog].slice(-50),
          };
          saveAutomationState(scope, next);
          return next;
        });

        return true;
      } catch {
        return false;
      }
    },
    [state.rules, scope, options]
  );

  // Periodic automation evaluator tick (every 30 seconds)
  useEffect(() => {
    isMountedRef.current = true;

    const runEval = () => {
      if (!isMountedRef.current) return;
      const currentOpts = optionsRef.current;

      const ctx: EvaluateContext = {
        scope,
        focusMinutesToday: currentOpts.focusMinutesToday || 0,
        completedTasksCount: currentOpts.completedTasksCount || 0,
        pendingTasksCount: currentOpts.pendingTasksCount || 0,
        onAddReminder: currentOpts.onAddReminder,
        onSetPetMood: currentOpts.onSetPetMood,
        onInAppAlert: currentOpts.onInAppAlert,
        onPromptReport: (_t, _b) => {
          if (currentOpts.onNavigate) currentOpts.onNavigate('daily-reports');
        },
      };

      setState((currentState) => {
        const { updatedState } = evaluateAutomations(currentState, ctx);
        return updatedState;
      });
    };

    runEval();
    checkTimerRef.current = setInterval(runEval, 30000);

    return () => {
      isMountedRef.current = false;
      if (checkTimerRef.current) {
        clearInterval(checkTimerRef.current);
        checkTimerRef.current = null;
      }
    };
  }, [scope]);

  return {
    globalEnabled: state.globalEnabled,
    setGlobalEnabled,
    rules: state.rules,
    toggleRule,
    resetRules,
    pendingConfirmations,
    confirmAction,
    cancelAction,
    logs: state.logs,
    clearLogs,
    triggerManual,
  };
}
