/**
 * Kuro Companion — Unified Normalized Timer Context & Provider
 *
 * Provides a single shared timer state for all components in the Kuro application,
 * guaranteeing consistent elapsed time across page navigation, task list actions,
 * Kanban board cards, and header indicators.
 */

import React, { useMemo } from 'react';
import type { Task, Project } from '../types';
import { useNormalizedTimer } from '../hooks/useNormalizedTimer';
import { useUserPreferences } from '../hooks/useUserPreferences';
import { TimerContext } from './timerContextDef';
import type { TimerContextValue } from './timerContextDef';

interface TimerProviderProps {
  children: React.ReactNode;
  tasks?: Task[];
  projects?: Project[];
}

export const TimerProvider: React.FC<TimerProviderProps> = ({
  children,
  tasks = [],
  projects = [],
}) => {
  const { preferences } = useUserPreferences();

  const timer = useNormalizedTimer({
    activityTrackingEnabled: preferences.activityTrackingEnabled,
    idleThresholdSeconds: preferences.idleThresholdSeconds,
  });

  // Resolve associated task and project
  const activeTask = useMemo(() => {
    if (!timer.activeEntry?.taskId) return null;
    return tasks.find((t) => t.id === timer.activeEntry?.taskId) || null;
  }, [timer.activeEntry?.taskId, tasks]);

  const activeProject = useMemo(() => {
    if (activeTask?.projectId) {
      return projects.find((p) => p.id === activeTask.projectId) || null;
    }
    if (timer.activeEntry?.projectId) {
      return projects.find((p) => p.id === timer.activeEntry?.projectId) || null;
    }
    return null;
  }, [timer.activeEntry?.projectId, activeTask, projects]);

  const isTaskActive = (taskId: string): boolean => {
    return Boolean(
      timer.activeEntry &&
      timer.activeEntry.taskId === taskId &&
      (timer.activeEntry.state === 'running' || timer.activeEntry.state === 'paused')
    );
  };

  const contextValue: TimerContextValue = {
    ...timer,
    activeTask,
    activeProject,
    isTaskActive,
  };

  return <TimerContext.Provider value={contextValue}>{children}</TimerContext.Provider>;
};
