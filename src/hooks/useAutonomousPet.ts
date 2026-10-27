/**
 * Kuro Robot Companion — Autonomous Pet Behaviour Hook
 *
 * Scope: Phase 7.4 Context Awareness & Lifecycle Safety
 *
 * Runs on a clean 5-second interval. Compares states deterministically,
 * triggers prioritized expressions and visual speech without expensive AI calls or memory leaks.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import type {
  PetMood,
  PetMouthStyle,
  PetEyeStyle,
  Task,
  Reminder,
} from '../types';
import type { ClientPetSettings } from '../lib/adapters';
import {
  evaluatePetContext,
  type PetFocusState,
  type PetCompanionState,
  type PetBrowserState,
} from '../lib/pet/autonomousEngine';

export interface UseAutonomousPetProps {
  tasks: readonly Task[];
  reminders: readonly Reminder[];
  petSettings: ClientPetSettings;
  updatePetSettings: (newSettings: Partial<ClientPetSettings>) => Promise<boolean>;
  focusSession?: PetFocusState | null;
  companionState?: PetCompanionState | null;
  browserState?: PetBrowserState | null;
  initialMood?: PetMood;
}

export interface UseAutonomousPetReturn {
  currentMood: PetMood;
  mouthStyle: PetMouthStyle;
  eyeStyle: PetEyeStyle;
  speechText: string | null;
  isSpeaking: boolean;
  setMood: (mood: PetMood) => void;
  triggerManualSpeech: (text: string) => void;
  stopSpeech: () => void;
  pauseAutonomy: (minutes?: number) => Promise<boolean>;
  resumeAutonomy: () => Promise<boolean>;
  isPaused: boolean;
  lastRuleTriggered: string;
}

export function useAutonomousPet({
  tasks,
  reminders,
  petSettings,
  updatePetSettings,
  focusSession = null,
  companionState = null,
  browserState = null,
  initialMood = 'attentive',
}: UseAutonomousPetProps): UseAutonomousPetReturn {
  const [currentMood, setCurrentMood] = useState<PetMood>(initialMood);
  const [mouthStyle, setMouthStyle] = useState<PetMouthStyle>('closed_smile');
  const [eyeStyle, setEyeStyle] = useState<PetEyeStyle>('standard');
  const [speechText, setSpeechText] = useState<string | null>(null);
  const [isSpeaking, setIsSpeaking] = useState<boolean>(false);
  const [lastRuleTriggered, setLastRuleTriggered] = useState<string>('initial');

  // Track acknowledged completed tasks to avoid re-celebrating on every tick
  const acknowledgedCompletedTasksRef = useRef<Set<string>>(
    new Set(tasks.filter((t) => t.completed).map((t) => t.id))
  );

  // Manual interaction tracking
  const manualInteractionRef = useRef<{ selectedMood: PetMood; timestamp: number } | null>(null);
  const lastSpeechTextRef = useRef<string | null>(null);
  const lastSpeechTimestampRef = useRef<number>(0);

  // Keep references to dynamic props for stable interval callback
  const propsRef = useRef({
    tasks,
    reminders,
    petSettings,
    focusSession,
    companionState,
    browserState,
    isSpeaking,
  });

  useEffect(() => {
    propsRef.current = {
      tasks,
      reminders,
      petSettings,
      focusSession,
      companionState,
      browserState,
      isSpeaking,
    };
  }, [tasks, reminders, petSettings, focusSession, companionState, browserState, isSpeaking]);

  // Set mood from user interaction
  const setMood = useCallback((mood: PetMood) => {
    manualInteractionRef.current = {
      selectedMood: mood,
      timestamp: Date.now(),
    };
    setCurrentMood(mood);
  }, []);

  const triggerManualSpeech = useCallback((text: string) => {
    if (!text || !text.trim()) return;
    setSpeechText(text.trim());
    setIsSpeaking(true);
    lastSpeechTextRef.current = text.trim();
    lastSpeechTimestampRef.current = Date.now();
  }, []);

  const stopSpeech = useCallback(() => {
    setIsSpeaking(false);
    setSpeechText(null);
  }, []);

  const pauseAutonomy = useCallback(
    async (minutes = 30) => {
      const pausedUntil = Date.now() + minutes * 60 * 1000;
      return updatePetSettings({ pausedUntil });
    },
    [updatePetSettings]
  );

  const resumeAutonomy = useCallback(async () => {
    return updatePetSettings({ pausedUntil: null });
  }, [updatePetSettings]);

  const [currentTimestamp, setCurrentTimestamp] = useState<number>(() => Date.now());

  const isPaused = Boolean(
    petSettings.pausedUntil && currentTimestamp < petSettings.pausedUntil
  );

  // 5-Second Autonomous Cadence
  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setCurrentTimestamp(Date.now());
      const {
        tasks: currentTasks,
        reminders: currentReminders,
        petSettings: currentSettings,
        focusSession: currentFocus,
        companionState: currentCompanion,
        browserState: currentBrowser,
        isSpeaking: currentSpeaking,
      } = propsRef.current;

      const evalResult = evaluatePetContext({
        tasks: currentTasks,
        reminders: currentReminders,
        focusSession: currentFocus,
        companionActive: currentCompanion,
        browserActive: currentBrowser,
        petSettings: currentSettings,
        manualInteraction: manualInteractionRef.current,
        isCurrentlySpeaking: currentSpeaking,
        previouslyCompletedTaskIds: acknowledgedCompletedTasksRef.current,
        lastSpeechText: lastSpeechTextRef.current,
        lastSpeechTimestamp: lastSpeechTimestampRef.current,
      });

      // Update rule tracking
      setLastRuleTriggered(evalResult.ruleTriggered);

      // Acknowledge completed task if celebrated
      if (evalResult.completedTaskIdToAck) {
        acknowledgedCompletedTasksRef.current.add(evalResult.completedTaskIdToAck);
      }

      // Update visual expression state if changed
      setCurrentMood((prev) => (prev !== evalResult.mood ? evalResult.mood : prev));
      setMouthStyle((prev) => (prev !== evalResult.mouthStyle ? evalResult.mouthStyle : prev));
      setEyeStyle((prev) => (prev !== evalResult.eyeStyle ? evalResult.eyeStyle : prev));

      // Trigger speech if scheduled by engine
      if (evalResult.shouldSpeak && evalResult.speechText) {
        setSpeechText(evalResult.speechText);
        setIsSpeaking(true);
        lastSpeechTextRef.current = evalResult.speechText;
        lastSpeechTimestampRef.current = Date.now();
      }
    }, 5000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, []);

  return {
    currentMood,
    mouthStyle,
    eyeStyle,
    speechText,
    isSpeaking,
    setMood,
    triggerManualSpeech,
    stopSpeech,
    pauseAutonomy,
    resumeAutonomy,
    isPaused,
    lastRuleTriggered,
  };
}
