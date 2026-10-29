import React, { useEffect, useRef, useState, useMemo } from 'react';
import type { PetMood, PetMouthStyle, PetEyeStyle } from '../../types';
import {
  type EyeShape,
  type GlowColor,
  GLOW_PALETTES,
  calculateSpeechDuration,
  sanitizeSpeechText,
  getMoodDefaultMouthStyle,
  getMoodDefaultEyeStyle,
} from '../../lib/pet/faceLifecycle';

export type DanceStyle = 'sway' | 'bounce' | 'disco' | 'headbob';
export type DanceIntensity = 'subtle' | 'normal' | 'energetic';

export interface KuroAnimatedFaceProps {
  currentMood: PetMood;
  eyeShape?: EyeShape;
  glowColor?: GlowColor;
  mouthStyle?: PetMouthStyle;
  eyeStyle?: PetEyeStyle;
  speechText?: string | null;
  isSpeaking?: boolean;
  onSpeechEnd?: () => void;
  onCancelSpeech?: () => void;
  size?: 'sm' | 'md' | 'lg';
  showSpeechRibbon?: boolean;
  className?: string;
  isDancing?: boolean;
  danceStyle?: DanceStyle;
  danceIntensity?: DanceIntensity;
}

export const KuroAnimatedFace: React.FC<KuroAnimatedFaceProps> = ({
  currentMood,
  eyeShape = 'curved',
  glowColor = 'cyan',
  mouthStyle: explicitMouthStyle,
  eyeStyle: explicitEyeStyle,
  speechText = null,
  isSpeaking: controlledIsSpeaking,
  onSpeechEnd,
  onCancelSpeech,
  size = 'md',
  showSpeechRibbon = true,
  className = '',
  isDancing = false,
  danceStyle = 'sway',
  danceIntensity = 'normal',
}) => {
  // Palette settings
  const palette = GLOW_PALETTES[glowColor] || GLOW_PALETTES.cyan;

  // Internal speaking state if not controlled externally
  const [internalSpeaking, setInternalSpeaking] = useState(false);
  const isSpeaking = controlledIsSpeaking !== undefined ? controlledIsSpeaking : internalSpeaking;

  const timerRef = useRef<number | null>(null);
  const activeTextRef = useRef<string | null>(speechText);

  // Clear timer on unmount or cancellation
  const clearTimer = () => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  useEffect(() => {
    return () => {
      clearTimer();
    };
  }, []);

  // Handle speech trigger and text changes safely
  useEffect(() => {
    let isCurrent = true;
    const text = speechText ? speechText.trim() : null;
    activeTextRef.current = text;

    if (text && text.length > 0) {
      clearTimer();
      queueMicrotask(() => {
        if (isCurrent) setInternalSpeaking(true);
      });

      const duration = calculateSpeechDuration(text);
      timerRef.current = window.setTimeout(() => {
        if (isCurrent) {
          setInternalSpeaking(false);
          if (onSpeechEnd) {
            onSpeechEnd();
          }
        }
      }, duration);
    } else {
      clearTimer();
      queueMicrotask(() => {
        if (isCurrent) setInternalSpeaking(false);
      });
    }

    return () => {
      isCurrent = false;
    };
  }, [speechText, onSpeechEnd]);

  // Handle explicit cancellation
  const handleCancel = () => {
    clearTimer();
    setInternalSpeaking(false);
    if (onCancelSpeech) {
      onCancelSpeech();
    }
  };

  // Determine effective emotion & styles
  const effectiveMood: PetMood = isSpeaking ? 'speaking' : currentMood;
  const effectiveMouthStyle: PetMouthStyle = isSpeaking
    ? 'speaking'
    : explicitMouthStyle || getMoodDefaultMouthStyle(effectiveMood);
  const effectiveEyeStyle: PetEyeStyle = explicitEyeStyle || getMoodDefaultEyeStyle(effectiveMood);

  // Scale multipliers for responsiveness
  const dimensions = useMemo(() => {
    switch (size) {
      case 'sm':
        return { eyeW: 32, eyeH: 36, gap: 24, mouthW: 36, mouthH: 14, scale: 0.75 };
      case 'lg':
        return { eyeW: 52, eyeH: 58, gap: 44, mouthW: 54, mouthH: 22, scale: 1.15 };
      case 'md':
      default:
        return { eyeW: 44, eyeH: 48, gap: 36, mouthW: 48, mouthH: 18, scale: 1.0 };
    }
  }, [size]);

  // Eye shape styling
  const eyeBorderRadius = useMemo(() => {
    if (eyeShape === 'round') return '50%';
    if (eyeShape === 'pixel') return '0px';
    // curved: default smooth organic pill
    return '14px';
  }, [eyeShape]);

  // CSS custom properties applied inline for dynamic palette scoping
  const styleVars: React.CSSProperties = {
    '--kuro-glow-color': palette.primaryHex,
    '--kuro-glow-shadow': palette.glowShadow,
    '--kuro-subtle-bg': palette.subtleBg,
    '--kuro-border-stroke': palette.borderStroke,
  } as React.CSSProperties;

  const sanitizedDisplaySpeech = speechText ? sanitizeSpeechText(speechText) : '';

  return (
    <div
      className={`kuro-animated-face-container size-${size} ${className}`}
      style={styleVars}
      role="img"
      aria-label={`Kuro robot companion visor face. Mood: ${effectiveMood}, Expression: ${effectiveMouthStyle}${isSpeaking ? `, speaking: "${sanitizedDisplaySpeech}"` : ''}`}
    >
      {/* 2.4-inch TFT Visor Display Screen */}
      <div
        className={`kuro-visor-screen palette-${glowColor} shape-${eyeShape} mood-${effectiveMood} mouth-style-${effectiveMouthStyle} eye-style-${effectiveEyeStyle}${
          isDancing ? ` is-dancing dance-style-${danceStyle} dance-intensity-${danceIntensity}` : ''
        }`}
      >
        {/* Subtle hardware scanlines overlay */}
        <div className="kuro-visor-scanlines" aria-hidden="true" />

        {/* Eyes Display Area */}
        <div
          className={`kuro-eyes-area mood-${effectiveMood} eye-style-${effectiveEyeStyle}`}
          style={{ gap: `${dimensions.gap}px` }}
          aria-hidden="true"
        >
          {/* Left Eye */}
          <div
            className={`kuro-eye eye-left mood-${effectiveMood} shape-${eyeShape} eye-style-${effectiveEyeStyle}`}
            style={{
              width: `${dimensions.eyeW}px`,
              height: `${dimensions.eyeH}px`,
              borderRadius: eyeBorderRadius,
            }}
          />

          {/* Right Eye */}
          <div
            className={`kuro-eye eye-right mood-${effectiveMood} shape-${eyeShape} eye-style-${effectiveEyeStyle}`}
            style={{
              width: `${dimensions.eyeW}px`,
              height: `${dimensions.eyeH}px`,
              borderRadius: eyeBorderRadius,
            }}
          />
        </div>

        {/* Expressive Mouth Display */}
        <div
          className={`kuro-mouth-area mood-${effectiveMood} mouth-style-${effectiveMouthStyle}`}
          style={{
            width: `${dimensions.mouthW}px`,
            height: `${dimensions.mouthH}px`,
          }}
          aria-hidden="true"
        >
          <KuroMouthVisual mouthStyle={effectiveMouthStyle} palette={palette} />
        </div>

        {/* Visible Speech Text Ribbon */}
        {showSpeechRibbon && isSpeaking && sanitizedDisplaySpeech && (
          <div className="kuro-speech-ribbon" role="status" aria-live="polite">
            <div className="kuro-speech-indicator" />
            <span className="kuro-speech-text">"{sanitizedDisplaySpeech}"</span>
            {onCancelSpeech && (
              <button
                type="button"
                className="kuro-speech-stop-btn"
                onClick={handleCancel}
                title="Stop speech animation"
                aria-label="Stop speech animation"
              >
                ✕
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

interface KuroMouthVisualProps {
  mouthStyle: PetMouthStyle;
  palette: typeof GLOW_PALETTES['cyan'];
}

/**
 * Renders distinct expressive SVG mouths for all 10 styles,
 * featuring dynamic speaking phoneme morphing while active.
 */
const KuroMouthVisual: React.FC<KuroMouthVisualProps> = ({ mouthStyle, palette }) => {
  const strokeColor = palette.primaryHex;
  const glowFilter = `drop-shadow(0 0 5px ${palette.glowShadow})`;

  switch (mouthStyle) {
    case 'speaking':
      return (
        <svg
          viewBox="0 0 48 20"
          className="kuro-mouth-svg speaking"
          style={{ filter: glowFilter, width: '100%', height: '100%' }}
        >
          {/* Animated speaking mouth wave / phoneme cycle */}
          <path
            className="kuro-speaking-path"
            d="M 8 10 Q 24 14 40 10 Q 24 18 8 10 Z"
            fill={palette.primaryHex}
            fillOpacity={0.8}
            stroke={strokeColor}
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      );

    case 'open_smile':
      return (
        <svg viewBox="0 0 48 20" className="kuro-mouth-svg open-smile" style={{ filter: glowFilter, width: '100%', height: '100%' }}>
          {/* Warm open smile grin */}
          <path
            d="M 10 9 Q 24 21 38 9 Q 24 13 10 9 Z"
            fill={palette.primaryHex}
            fillOpacity={0.25}
            stroke={strokeColor}
            strokeWidth="2.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      );

    case 'laugh':
      return (
        <svg viewBox="0 0 48 20" className="kuro-mouth-svg laugh" style={{ filter: glowFilter, width: '100%', height: '100%' }}>
          {/* Joyful wide laughing mouth with tongue arch */}
          <path
            d="M 8 7 Q 24 24 40 7 Q 24 12 8 7 Z"
            fill={palette.primaryHex}
            fillOpacity={0.4}
            stroke={strokeColor}
            strokeWidth="2.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      );

    case 'tiny_mouth':
      return (
        <svg viewBox="0 0 48 20" className="kuro-mouth-svg tiny-mouth" style={{ filter: glowFilter, width: '100%', height: '100%' }}>
          {/* Cute minimalist dot dash */}
          <path
            d="M 20 11 Q 24 13 28 11"
            fill="none"
            stroke={strokeColor}
            strokeWidth="2.8"
            strokeLinecap="round"
          />
        </svg>
      );

    case 'surprised_o':
      return (
        <svg viewBox="0 0 48 20" className="kuro-mouth-svg surprised-o" style={{ filter: glowFilter, width: '100%', height: '100%' }}>
          {/* Surprised round vertical oval O */}
          <ellipse
            cx="24"
            cy="11"
            rx="6.5"
            ry="7.5"
            fill="none"
            stroke={strokeColor}
            strokeWidth="2.6"
          />
        </svg>
      );

    case 'worried_curve':
      return (
        <svg viewBox="0 0 48 20" className="kuro-mouth-svg worried-curve" style={{ filter: glowFilter, width: '100%', height: '100%' }}>
          {/* Inverted downturned curve */}
          <path
            d="M 10 14 Q 24 7 38 14"
            fill="none"
            stroke={strokeColor}
            strokeWidth="2.6"
            strokeLinecap="round"
          />
        </svg>
      );

    case 'confused_crooked':
      return (
        <svg viewBox="0 0 48 20" className="kuro-mouth-svg confused-crooked" style={{ filter: glowFilter, width: '100%', height: '100%' }}>
          {/* Asymmetrical crooked zig-zag wave */}
          <path
            d="M 10 13 Q 18 8 26 14 Q 34 10 38 12"
            fill="none"
            stroke={strokeColor}
            strokeWidth="2.6"
            strokeLinecap="round"
          />
        </svg>
      );

    case 'focused_line':
      return (
        <svg viewBox="0 0 48 20" className="kuro-mouth-svg focused-line" style={{ filter: glowFilter, width: '100%', height: '100%' }}>
          {/* Firm straight focused line */}
          <line
            x1="12"
            y1="11"
            x2="36"
            y2="11"
            stroke={strokeColor}
            strokeWidth="2.8"
            strokeLinecap="round"
          />
        </svg>
      );

    case 'sleepy_mouth':
      return (
        <svg viewBox="0 0 48 20" className="kuro-mouth-svg sleepy-mouth" style={{ filter: glowFilter, width: '100%', height: '100%', opacity: 0.7 }}>
          {/* Soft small sleeping sigh */}
          <line
            x1="16"
            y1="11"
            x2="32"
            y2="11"
            stroke={strokeColor}
            strokeWidth="2.4"
            strokeLinecap="round"
          />
        </svg>
      );

    case 'closed_smile':
    default:
      return (
        <svg viewBox="0 0 48 20" className="kuro-mouth-svg closed-smile" style={{ filter: glowFilter, width: '100%', height: '100%' }}>
          {/* Gentle closed smile curve */}
          <path
            d="M 10 10 Q 24 16 38 10"
            fill="none"
            stroke={strokeColor}
            strokeWidth="2.6"
            strokeLinecap="round"
          />
        </svg>
      );
  }
};
