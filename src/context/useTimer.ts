import { useContext } from 'react';
import { TimerContext } from './timerContextDef';
import type { TimerContextValue } from './timerContextDef';

export function useTimer(): TimerContextValue {
  const context = useContext(TimerContext);
  if (!context) {
    throw new Error('useTimer must be used within a TimerProvider');
  }
  return context;
}

export type { TimerContextValue };

