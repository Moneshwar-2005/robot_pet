/**
 * Kuro Robot Companion — Face & Speech Lifecycle Engine
 *
 * Scope: Expressive Animated Face, Visual Speaking Mouth, and Speech Lifecycle
 *
 * RULES:
 * 1. Screen-only companion: no audio, no speakers, no physical motors.
 * 2. Visual speech text paired with mouth phoneme animation.
 * 3. Safe lifecycle: clean timer cleanup, cancellation, rapid update handling.
 * 4. Respects reduced-motion preferences.
 * 5. Approved display hardware target: 2.4-inch TFT LCD (320x240).
 */

import type { PetMood, PetMouthStyle, PetEyeStyle, ReactionFrequency } from '../../types';

export interface MoodMeta {
  id: PetMood;
  label: string;
  icon: string;
  description: string;
  defaultMouth: PetMouthStyle;
  defaultEye: PetEyeStyle;
}

export const ALL_PET_MOODS: readonly MoodMeta[] = [
  { id: 'idle', label: 'Idle', icon: '💤', description: 'Resting calm presence with soft breathing motion.', defaultMouth: 'tiny_mouth', defaultEye: 'standard' },
  { id: 'attentive', label: 'Attentive', icon: '👀', description: 'Focused alert gaze ready for user commands.', defaultMouth: 'closed_smile', defaultEye: 'standard' },
  { id: 'focused', label: 'Focused', icon: '🎯', description: 'Deep concentration on active tasks and code.', defaultMouth: 'focused_line', defaultEye: 'squint' },
  { id: 'curious', label: 'Curious', icon: '❓', description: 'Quizzical asymmetric gaze exploring workspaces.', defaultMouth: 'confused_crooked', defaultEye: 'curious_widened' },
  { id: 'thinking', label: 'Thinking', icon: '💡', description: 'Contemplative pulsing expression during processing.', defaultMouth: 'tiny_mouth', defaultEye: 'gaze_drift' },
  { id: 'happy', label: 'Happy', icon: '✨', description: 'Warm joyous expression celebrating accomplishments.', defaultMouth: 'open_smile', defaultEye: 'happy_curved' },
  { id: 'excited', label: 'Excited', icon: '🚀', description: 'High-energy celebration and bouncy motivation.', defaultMouth: 'laugh', defaultEye: 'happy_curved' },
  { id: 'sleepy', label: 'Sleepy', icon: '🌙', description: 'Drowsy relaxed slit eyes for restorative downtime.', defaultMouth: 'sleepy_mouth', defaultEye: 'sleepy_lids' },
  { id: 'playful', label: 'Playful', icon: '🐾', description: 'Bouncy animated winks and high-energy encouragement.', defaultMouth: 'open_smile', defaultEye: 'asymmetrical_wink' },
  { id: 'caring', label: 'Caring', icon: '💚', description: 'Gentle supportive presence prompting wellness breaks.', defaultMouth: 'closed_smile', defaultEye: 'happy_curved' },
  { id: 'surprised', label: 'Surprised', icon: '😲', description: 'Wide-eyed surprise at unexpected discoveries.', defaultMouth: 'surprised_o', defaultEye: 'curious_widened' },
  { id: 'confused', label: 'Confused', icon: '🌀', description: 'Puzzled asymmetric reaction to unusual context.', defaultMouth: 'confused_crooked', defaultEye: 'asymmetrical_wink' },
  { id: 'worried', label: 'Worried', icon: '😟', description: 'Concerned caution regarding overdue deadlines.', defaultMouth: 'worried_curve', defaultEye: 'squint' },
  { id: 'proud', label: 'Proud', icon: '🏆', description: 'Deep satisfaction celebrating finished milestones.', defaultMouth: 'open_smile', defaultEye: 'happy_curved' },
  { id: 'listening', label: 'Listening', icon: '📡', description: 'Receptive visual aura listening for user input.', defaultMouth: 'closed_smile', defaultEye: 'curious_widened' },
  { id: 'speaking', label: 'Speaking', icon: '💬', description: 'Active visual speech text with animated mouth phonemes.', defaultMouth: 'speaking', defaultEye: 'standard' },
  { id: 'error', label: 'Alert / Error', icon: '⚠️', description: 'Cautionary hazard chevron gaze indicating obstacles.', defaultMouth: 'worried_curve', defaultEye: 'squint' },
] as const;

export interface MouthStyleMeta {
  id: PetMouthStyle;
  label: string;
  description: string;
}

export const ALL_MOUTH_STYLES: readonly MouthStyleMeta[] = [
  { id: 'closed_smile', label: 'Closed Smile', description: 'Warm subtle curved smile' },
  { id: 'open_smile', label: 'Open Smile', description: 'Friendly open grin' },
  { id: 'laugh', label: 'Laugh', description: 'Joyful wide open laughing mouth' },
  { id: 'tiny_mouth', label: 'Tiny Mouth', description: 'Cute minimalist dot dash' },
  { id: 'surprised_o', label: 'Surprised O', description: 'Rounded open oval mouth' },
  { id: 'worried_curve', label: 'Worried Curve', description: 'Inverted downturned curve' },
  { id: 'confused_crooked', label: 'Confused Crooked', description: 'Asymmetrical wavy line' },
  { id: 'focused_line', label: 'Focused Line', description: 'Concentrated straight line' },
  { id: 'sleepy_mouth', label: 'Sleepy Mouth', description: 'Gentle soft sleeping sigh' },
  { id: 'speaking', label: 'Speaking Shapes', description: 'Dynamic animated speech phonemes' },
] as const;

export function getMoodDefaultMouthStyle(mood: PetMood): PetMouthStyle {
  const match = ALL_PET_MOODS.find((m) => m.id === mood);
  return match ? match.defaultMouth : 'closed_smile';
}

export function getMoodDefaultEyeStyle(mood: PetMood): PetEyeStyle {
  const match = ALL_PET_MOODS.find((m) => m.id === mood);
  return match ? match.defaultEye : 'standard';
}

export type EyeShape = 'curved' | 'round' | 'pixel';
export type GlowColor = 'cyan' | 'emerald' | 'amber' | 'violet';

export interface GlowPaletteConfig {
  id: GlowColor;
  label: string;
  primaryHex: string;
  glowShadow: string;
  subtleBg: string;
  borderStroke: string;
}

export const GLOW_PALETTES: Record<GlowColor, GlowPaletteConfig> = {
  cyan: {
    id: 'cyan',
    label: 'Cyan Glow',
    primaryHex: '#06b6d4',
    glowShadow: 'rgba(6, 182, 212, 0.65)',
    subtleBg: 'rgba(6, 182, 212, 0.10)',
    borderStroke: 'rgba(6, 182, 212, 0.40)',
  },
  emerald: {
    id: 'emerald',
    label: 'Emerald Matrix',
    primaryHex: '#10b981',
    glowShadow: 'rgba(16, 185, 129, 0.65)',
    subtleBg: 'rgba(16, 185, 129, 0.10)',
    borderStroke: 'rgba(16, 185, 129, 0.40)',
  },
  amber: {
    id: 'amber',
    label: 'Warm Amber',
    primaryHex: '#f59e0b',
    glowShadow: 'rgba(245, 158, 11, 0.65)',
    subtleBg: 'rgba(245, 158, 11, 0.10)',
    borderStroke: 'rgba(245, 158, 11, 0.40)',
  },
  violet: {
    id: 'violet',
    label: 'Neon Violet',
    primaryHex: '#a855f7',
    glowShadow: 'rgba(168, 85, 247, 0.65)',
    subtleBg: 'rgba(168, 85, 247, 0.10)',
    borderStroke: 'rgba(168, 85, 247, 0.40)',
  },
};

/**
 * Calculates readable visual reading duration for speech text.
 * - Short phrases (e.g. "Hi!") get a sensible minimum reading time (2.2s).
 * - Longer phrases scale proportionally with word/character length.
 * - Clamped at 10 seconds to prevent indefinite speaking lock.
 */
export function calculateSpeechDuration(text: string | null | undefined): number {
  if (!text || typeof text !== 'string') return 0;
  const trimmed = text.trim();
  if (trimmed.length === 0) return 0;

  // Base 1200ms + 55ms per character; minimum 2200ms, maximum 10000ms
  const computed = trimmed.length * 55 + 1200;
  return Math.max(2200, Math.min(10000, computed));
}

/**
 * Truncates and sanitizes speech text for the constrained visual visor display.
 * Avoids layout breakage on very long responses while keeping them readable.
 */
export function sanitizeSpeechText(text: string | null | undefined, maxLength = 220): string {
  if (!text || typeof text !== 'string') return '';
  const trimmed = text.trim();
  if (trimmed.length <= maxLength) return trimmed;
  return trimmed.slice(0, maxLength - 3).trimEnd() + '...';
}

/**
 * Validates whether a given mood string is one of the 10 supported Kuro moods.
 */
export function isValidPetMood(mood: unknown): mood is PetMood {
  return typeof mood === 'string' && ALL_PET_MOODS.some((m) => m.id === mood);
}

export interface DocumentedPetSettings {
  petName: string;
  avatarVariant: string;
  eyeShape: EyeShape;
  glowColor: GlowColor;
  playfulness: number;
  focusDiscipline: number;
  autonomousEnabled: boolean;
  reactionFrequency: ReactionFrequency;
  browserAwarenessEnabled: boolean;
  excludedDomains: string[];
  pausedUntil: number | null;
}

export const DEFAULT_DOCUMENTED_PET_SETTINGS: DocumentedPetSettings = {
  petName: 'Kuro',
  avatarVariant: 'standard',
  eyeShape: 'curved',
  glowColor: 'cyan',
  playfulness: 70,
  focusDiscipline: 85,
  autonomousEnabled: true,
  reactionFrequency: 'balanced',
  browserAwarenessEnabled: false,
  excludedDomains: ['localhost', '127.0.0.1', 'accounts.google.com', 'bank', 'paypal.com'],
  pausedUntil: null,
};
