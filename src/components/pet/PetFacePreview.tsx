import React, { useState } from 'react';
import type { PetMood, PetStatus, PetMouthStyle, PetEyeStyle } from '../../types';
import { type EyeShape, type GlowColor, ALL_PET_MOODS } from '../../lib/pet/faceLifecycle';
import { KuroAnimatedFace } from './KuroAnimatedFace';
import { Sparkles, Battery, Cpu, Activity, Square, Play, Zap } from 'lucide-react';

export interface PetFacePreviewProps {
  petStatus: PetStatus;
  currentMood: PetMood;
  onMoodChange?: (mood: PetMood) => void;
  eyeShape?: EyeShape;
  glowColor?: GlowColor;
  mouthStyle?: PetMouthStyle;
  eyeStyle?: PetEyeStyle;
  interactive?: boolean;
  speechText?: string | null;
  isSpeaking?: boolean;
  onSpeechEnd?: () => void;
  onCancelSpeech?: () => void;
  showSpeechControls?: boolean;
  onTriggerSpeechPreview?: (text: string) => void;
}

export const PetFacePreview: React.FC<PetFacePreviewProps> = ({
  petStatus,
  currentMood,
  onMoodChange,
  eyeShape = 'curved',
  glowColor = 'cyan',
  mouthStyle,
  eyeStyle,
  interactive = true,
  speechText = null,
  isSpeaking = false,
  onSpeechEnd,
  onCancelSpeech,
  showSpeechControls = false,
  onTriggerSpeechPreview,
}) => {
  const [localSpeechInput, setLocalSpeechInput] = useState('');
  const [activeSpeech, setActiveSpeech] = useState<string | null>(speechText);

  // Synchronize external speechText prop
  const effectiveSpeechText = speechText !== null ? speechText : activeSpeech;

  const handleSpeakSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!localSpeechInput.trim()) return;

    const textToSpeak = localSpeechInput.trim();
    if (onTriggerSpeechPreview) {
      onTriggerSpeechPreview(textToSpeak);
    } else {
      setActiveSpeech(textToSpeak);
      if (onMoodChange) {
        onMoodChange('speaking');
      }
    }
  };

  const handleStopSpeech = () => {
    setActiveSpeech(null);
    if (onCancelSpeech) {
      onCancelSpeech();
    }
    if (onMoodChange && (currentMood === 'speaking' || isSpeaking)) {
      onMoodChange('attentive');
    }
  };

  const handleLocalSpeechEnd = () => {
    setActiveSpeech(null);
    if (onSpeechEnd) {
      onSpeechEnd();
    }
    if (onMoodChange && currentMood === 'speaking') {
      onMoodChange('attentive');
    }
  };

  return (
    <div className="pet-face-card">
      <div className="card-header" style={{ marginBottom: 0 }}>
        <div className="card-title-group">
          <Sparkles className="card-icon" />
          <div>
            <h3 className="card-title">{petStatus.name} — Face Visor</h3>
            <p className="card-subtitle">Simulated 2.4" TFT Head Visor Display (320x240)</p>
          </div>
        </div>
        <span className="badge badge-phase">Simulated (Phase 1)</span>
      </div>

      {/* 2.4-inch TFT Visor Display Frame */}
      <div className="oled-screen-frame" role="region" aria-label={`${petStatus.name} head display visor`}>
        {/* Hardware Status Header */}
        <div className="oled-status-bar">
          <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <Activity size={12} /> {petStatus.mode.toUpperCase()}
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            {petStatus.hardwareConnected && petStatus.hasPhysicalBattery && petStatus.batteryLevel !== null ? (
              <>
                <Battery size={12} /> {petStatus.batteryLevel}%
              </>
            ) : petStatus.hardwareConnected ? (
              <>
                <Zap size={12} style={{ color: 'var(--status-amber)' }} /> USB POWER
              </>
            ) : (
              <>
                <Zap size={12} style={{ color: 'var(--status-cyan)' }} /> SIMULATED
              </>
            )}
          </span>
        </div>

        {/* Expressive Kuro Face Component */}
        <KuroAnimatedFace
          currentMood={currentMood}
          eyeShape={eyeShape}
          glowColor={glowColor}
          mouthStyle={mouthStyle}
          eyeStyle={eyeStyle}
          speechText={effectiveSpeechText}
          isSpeaking={isSpeaking || Boolean(activeSpeech)}
          onSpeechEnd={handleLocalSpeechEnd}
          onCancelSpeech={handleStopSpeech}
          size="md"
        />

        {/* Status Mode Badge */}
        <div
          style={{
            zIndex: 3,
            marginTop: '8px',
            fontSize: '11px',
            color: 'var(--accent-primary)',
            opacity: 0.85,
            fontFamily: 'var(--font-mono)',
          }}
        >
          [ STATE: {currentMood.toUpperCase()} ]
        </div>
      </div>

      {/* Speech Preview Controls (When enabled in Pet Studio or standalone) */}
      {showSpeechControls && (
        <form
          onSubmit={handleSpeakSubmit}
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
            padding: '12px',
            background: 'var(--bg-card-subtle)',
            borderRadius: 'var(--radius-md)',
            border: '1px solid var(--border-subtle)',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '11.5px', color: 'var(--text-muted)', fontWeight: 600 }}>
              VISUAL SPEECH SIMULATOR
            </span>
            <span style={{ fontSize: '10.5px', color: 'var(--text-secondary)' }}>
              Screen-only text &amp; mouth animation
            </span>
          </div>

          <div style={{ display: 'flex', gap: '8px' }}>
            <input
              type="text"
              value={localSpeechInput}
              onChange={(e) => setLocalSpeechInput(e.target.value)}
              placeholder='Type phrase (e.g. "Hi, ready to focus?")...'
              aria-label="Speech preview phrase input"
              style={{
                flex: 1,
                padding: '6px 10px',
                background: 'var(--bg-input)',
                border: '1px solid var(--border-subtle)',
                borderRadius: 'var(--radius-sm)',
                color: 'var(--text-primary)',
                fontSize: '12.5px',
              }}
            />

            <button
              type="submit"
              className="btn btn-primary"
              disabled={!localSpeechInput.trim()}
              style={{ padding: '6px 12px', fontSize: '12px', gap: '4px' }}
              title="Animate mouth and speak text on face display"
            >
              <Play size={12} />
              <span>Speak Preview</span>
            </button>

            {(isSpeaking || activeSpeech) && (
              <button
                type="button"
                className="btn btn-secondary"
                onClick={handleStopSpeech}
                style={{ padding: '6px 10px', fontSize: '12px', color: 'var(--status-red)' }}
                title="Stop speaking animation"
                aria-label="Stop speaking animation"
              >
                <Square size={12} />
                <span>Stop</span>
              </button>
            )}
          </div>

          {/* Quick preset chips */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '2px' }}>
            {[
              'Hi! Ready to focus?',
              'Time for a quick water break!',
              'All tasks completed today. Great work!',
              'Deep work sprint starting now.',
            ].map((preset) => (
              <button
                key={preset}
                type="button"
                onClick={() => setLocalSpeechInput(preset)}
                className="btn btn-secondary"
                style={{ padding: '2px 8px', fontSize: '10.5px', borderRadius: 'var(--radius-pill)' }}
              >
                {preset}
              </button>
            ))}
          </div>
        </form>
      )}

      {/* Interactive Expression State Picker (All 10 Moods) */}
      {interactive && onMoodChange && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '11.5px', color: 'var(--text-muted)', fontWeight: 600 }}>
              TEST EXPRESSION STATE
            </span>
            <span style={{ fontSize: '11px', color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>
              {petStatus.temperatureCelsius !== null ? `Temp: ${petStatus.temperatureCelsius}°C` : 'Temp: Simulated'}
            </span>
          </div>

          <div
            className="expression-picker-group"
            style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '6px' }}
          >
            {ALL_PET_MOODS.map((m) => (
              <button
                key={m.id}
                type="button"
                className={`expression-btn ${currentMood === m.id ? 'active' : ''}`}
                onClick={() => onMoodChange(m.id)}
                aria-pressed={currentMood === m.id}
                title={m.description}
                style={{ padding: '6px 4px', fontSize: '11px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px' }}
              >
                <span style={{ fontSize: '14px' }}>{m.icon}</span>
                <span style={{ fontSize: '10.5px', textTransform: 'capitalize' }}>{m.label}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Hardware Link Notice */}
      <div
        style={{
          fontSize: '11px',
          color: 'var(--text-muted)',
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          paddingTop: '6px',
          borderTop: '1px solid var(--border-subtle)',
        }}
      >
        <Cpu size={13} style={{ flexShrink: 0, color: 'var(--status-amber)' }} />
        <span>Hardware sync (2.4" TFT LCD SPI) scheduled for future phase. Screen-only companion (no motors, no speakers).</span>
      </div>
    </div>
  );
};
