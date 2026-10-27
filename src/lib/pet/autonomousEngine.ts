/**
 * Kuro Robot Companion — Centralized Autonomous Pet Behaviour Engine
 *
 * Scope: Phase 7.4 Context Awareness, Priority Scheduling & Lifecycle Safety
 *
 * RULES & GUARANTEES:
 * 1. Evaluates on a 5-second cadence with zero expensive AI inference.
 * 2. Deterministic priority resolution:
 *    Urgent Reminders > User Override > Task Events > Focus/IDE Work > Health/Break > Browser Context > Idle Ambient.
 * 3. Anti-chatter safeguards: strict cooldowns based on reactionFrequency (quiet: 3m, balanced: 1m, expressive: 30s).
 * 4. Never interrupts active speech or repeats identical phrases.
 * 5. Respects user opt-in, pausedUntil timestamps, and private domain exclusions.
 * 6. Completely cleaned up on navigation and unmount.
 */

import type {
  PetMood,
  PetMouthStyle,
  PetEyeStyle,
  Task,
  Reminder,
  ReactionFrequency,
} from '../../types';
import type { ClientPetSettings } from '../adapters';
import {
  getMoodDefaultMouthStyle,
  getMoodDefaultEyeStyle,
  calculateSpeechDuration,
  sanitizeSpeechText,
} from './faceLifecycle.ts';
import { classifyDomain, isDomainExcluded } from './browserDomainClassifier.ts';

export interface PetFocusState {
  isActive: boolean;
  mode: 'focus' | 'short_break' | 'long_break';
  remainingSeconds: number;
}

export interface PetCompanionState {
  isTracking: boolean;
  activeIde?: string | null;
  activeProject?: string | null;
}

export interface PetBrowserState {
  hostname?: string;
  title?: string;
  timestamp?: number;
  activeTab?: {
    hostname: string;
    title: string;
    timestamp: number;
  } | null;
  isTracking?: boolean;
}

export interface PetEvaluationContext {
  tasks: readonly Task[];
  reminders: readonly Reminder[];
  focusSession?: PetFocusState | null;
  companionActive?: PetCompanionState | null;
  browserActive?: PetBrowserState | null;
  petSettings: ClientPetSettings;
  manualInteraction?: {
    selectedMood: PetMood;
    timestamp: number;
  } | null;
  isCurrentlySpeaking: boolean;
  previouslyCompletedTaskIds: ReadonlySet<string>;
  lastSpeechText?: string | null;
  lastSpeechTimestamp?: number;
  now?: number; // Optional mock clock for deterministic testing
}

export interface PetEvaluationResult {
  mood: PetMood;
  mouthStyle: PetMouthStyle;
  eyeStyle: PetEyeStyle;
  speechText: string | null;
  speechDurationMs: number;
  ruleTriggered: string;
  shouldSpeak: boolean;
  completedTaskIdToAck?: string;
}

/**
 * Returns minimum speech cooldown in milliseconds based on user reaction frequency preference.
 */
export function getCooldownMsForFrequency(frequency?: ReactionFrequency): number {
  switch (frequency) {
    case 'quiet':
      return 180000; // 3 minutes
    case 'expressive':
      return 30000; // 30 seconds
    case 'balanced':
    default:
      return 60000; // 60 seconds
  }
}

/**
 * Evaluates full contextual environment and produces next pet mood, mouth/eye styles, and optional speech.
 */
export function evaluatePetContext(ctx: PetEvaluationContext): PetEvaluationResult {
  const now = ctx.now !== undefined ? ctx.now : Date.now();
  const settings = ctx.petSettings;
  const isAutonomous = settings.autonomousEnabled !== false;
  const isPaused = Boolean(settings.pausedUntil && now < settings.pausedUntil);
  const cooldownMs = getCooldownMsForFrequency(settings.reactionFrequency);
  const timeSinceLastSpeech = ctx.lastSpeechTimestamp ? now - ctx.lastSpeechTimestamp : Infinity;
  const canSpeak = !ctx.isCurrentlySpeaking && timeSinceLastSpeech >= cooldownMs;

  // Helper to format output
  const makeResult = (
    mood: PetMood,
    rule: string,
    candidateSpeech?: string | null,
    completedTaskId?: string,
    customMouth?: PetMouthStyle,
    customEye?: PetEyeStyle
  ): PetEvaluationResult => {
    let finalSpeech: string | null = null;
    let shouldSpeak = false;

    if (
      canSpeak &&
      candidateSpeech &&
      candidateSpeech.trim().length > 0 &&
      candidateSpeech !== ctx.lastSpeechText
    ) {
      finalSpeech = sanitizeSpeechText(candidateSpeech, 90);
      shouldSpeak = true;
    }

    return {
      mood,
      mouthStyle: customMouth || getMoodDefaultMouthStyle(mood),
      eyeStyle: customEye || getMoodDefaultEyeStyle(mood),
      speechText: finalSpeech,
      speechDurationMs: finalSpeech ? calculateSpeechDuration(finalSpeech) : 0,
      ruleTriggered: rule,
      shouldSpeak,
      completedTaskIdToAck: completedTaskId,
    };
  };

  // If autonomy is disabled or paused, return neutral attentive/idle state
  if (!isAutonomous || isPaused) {
    return makeResult(
      'attentive',
      isPaused ? 'autonomy_paused' : 'autonomy_disabled',
      null
    );
  }

  // --------------------------------------------------------------------------
  // PRIORITY 1: URGENT / OVERDUE REMINDERS & SYSTEM ALERTS (CRITICAL)
  // --------------------------------------------------------------------------
  const overdueReminder = ctx.reminders.find(
    (r) => !r.done && r.priority === 'important'
  );
  if (overdueReminder) {
    return makeResult(
      'worried',
      'urgent_reminder',
      `Reminder: ${overdueReminder.title}!`,
      undefined,
      'worried_curve',
      'squint'
    );
  }

  // --------------------------------------------------------------------------
  // PRIORITY 2: EXPLICIT USER MANUAL INTERACTION (HOLD DURATION: 45 SECONDS)
  // --------------------------------------------------------------------------
  if (ctx.manualInteraction && now - ctx.manualInteraction.timestamp < 45000) {
    return makeResult(
      ctx.manualInteraction.selectedMood,
      'user_manual_override',
      null
    );
  }

  // --------------------------------------------------------------------------
  // PRIORITY 3: NEWLY COMPLETED TASK (CELEBRATION EVENT)
  // --------------------------------------------------------------------------
  const newlyCompleted = ctx.tasks.find(
    (t) => t.completed && !ctx.previouslyCompletedTaskIds.has(t.id)
  );
  if (newlyCompleted) {
    const speech = `Awesome! Completed "${newlyCompleted.title}"! 🎉`;
    return makeResult(
      'proud',
      'task_completed_celebration',
      speech,
      newlyCompleted.id,
      'open_smile',
      'happy_curved'
    );
  }

  // Backlog celebration if all tasks are done
  const pendingCount = ctx.tasks.filter((t) => !t.completed).length;
  if (ctx.tasks.length > 0 && pendingCount === 0) {
    return makeResult(
      'excited',
      'backlog_cleared',
      'All tasks cleared! Great progress! ✨',
      undefined,
      'laugh',
      'happy_curved'
    );
  }

  // --------------------------------------------------------------------------
  // PRIORITY 4: ACTIVE POMODORO FOCUS TIMER OR ACTIVE IDE CODING
  // --------------------------------------------------------------------------
  if (ctx.focusSession?.isActive && ctx.focusSession.mode === 'focus') {
    return makeResult(
      'focused',
      'active_pomodoro_focus',
      'Deep focus active. Let\'s make progress!',
      undefined,
      'focused_line',
      'squint'
    );
  }

  if (ctx.companionActive?.isTracking && ctx.companionActive.activeProject) {
    const ide = ctx.companionActive.activeIde || 'IDE';
    return makeResult(
      'thinking',
      'active_ide_tracking',
      `Coding on ${ctx.companionActive.activeProject} in ${ide}.`,
      undefined,
      'tiny_mouth',
      'gaze_drift'
    );
  }

  // --------------------------------------------------------------------------
  // PRIORITY 5: WELLNESS BREAK & HEALTH CARE
  // --------------------------------------------------------------------------
  if (
    ctx.focusSession?.isActive &&
    (ctx.focusSession.mode === 'short_break' || ctx.focusSession.mode === 'long_break')
  ) {
    return makeResult(
      'caring',
      'focus_break_caring',
      'Break time! Hydrate and rest your eyes.',
      undefined,
      'closed_smile',
      'happy_curved'
    );
  }

  // --------------------------------------------------------------------------
  // PRIORITY 6: BROWSER ACTIVE TAB CONTEXT (OPT-IN, PRIVACY-FILTERED)
  // --------------------------------------------------------------------------
  const browserHostname = ctx.browserActive?.activeTab?.hostname || ctx.browserActive?.hostname;
  const browserTimestamp = ctx.browserActive?.activeTab?.timestamp || ctx.browserActive?.timestamp || 0;

  if (
    settings.browserAwarenessEnabled &&
    browserHostname &&
    now - browserTimestamp < 45000 &&
    !isDomainExcluded(browserHostname, settings.excludedDomains || [])
  ) {
    const category = classifyDomain(
      browserHostname,
      settings.excludedDomains || []
    );

    switch (category) {
      case 'documentation':
        return makeResult(
          'curious',
          'browser_documentation',
          `Checking docs on ${browserHostname}!`,
          undefined,
          'confused_crooked',
          'curious_widened'
        );
      case 'coding':
        return makeResult(
          'focused',
          'browser_coding',
          `Browsing repositories on ${browserHostname}.`,
          undefined,
          'focused_line',
          'squint'
        );
      case 'learning':
        return makeResult(
          'curious',
          'browser_learning',
          `Learning on ${browserHostname}!`,
          undefined,
          'open_smile',
          'curious_widened'
        );
      case 'entertainment':
        return makeResult(
          'surprised',
          'browser_entertainment',
          `Taking a breather on ${browserHostname}?`,
          undefined,
          'surprised_o',
          'curious_widened'
        );
      case 'work':
        return makeResult(
          'attentive',
          'browser_work',
          null
        );
      default:
        break;
    }
  }

  // --------------------------------------------------------------------------
  // PRIORITY 7: IDLE AMBIENT PRESENCE (TIME-OF-DAY SENSITIVE)
  // --------------------------------------------------------------------------
  const currentHour = new Date(now).getHours();
  if (currentHour >= 22 || currentHour < 6) {
    return makeResult(
      'sleepy',
      'idle_late_night',
      null,
      undefined,
      'sleepy_mouth',
      'sleepy_lids'
    );
  }

  // Gentle daytime presence
  return makeResult(
    'attentive',
    'idle_daytime_ambient',
    settings.reactionFrequency === 'expressive' ? 'Standing by ready to help.' : null
  );
}
