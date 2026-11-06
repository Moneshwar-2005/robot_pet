import { createContext } from 'react';
import type { TimeEntry, TimeEntryPause, TimeEntryIdle, TimeEntryTrackingSource, Task, Project } from '../types';

export interface TimerContextValue {
  activeEntry: TimeEntry | null;
  activePauses: TimeEntryPause[];
  activeIdles: TimeEntryIdle[];
  recentEntries: TimeEntry[];
  timerStatus: 'idle' | 'running' | 'paused';
  elapsedSeconds: number;
  activeTask: Task | null;
  activeProject: Project | null;
  loading: boolean;
  error: string | null;
  isStale: boolean;
  startTimer: (options?: {
    taskId?: string | null;
    projectId?: string | null;
    trackingSource?: TimeEntryTrackingSource;
  }) => Promise<boolean>;
  pauseTimer: () => Promise<boolean>;
  resumeTimer: () => Promise<boolean>;
  stopTimer: () => Promise<boolean>;
  deleteEntry: (entryId: string) => Promise<boolean>;
  refresh: () => Promise<void>;
  clearError: () => void;
  isTaskActive: (taskId: string) => boolean;
}

export const TimerContext = createContext<TimerContextValue | null>(null);

