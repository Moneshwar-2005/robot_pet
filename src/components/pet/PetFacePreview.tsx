import React from 'react';
import type { PetMood, PetStatus } from '../../types';
import { Sparkles, Battery, Cpu, Activity } from 'lucide-react';

interface PetFacePreviewProps {
  petStatus: PetStatus;
  currentMood: PetMood;
  onMoodChange?: (mood: PetMood) => void;
  interactive?: boolean;
}

const MOODS: { id: PetMood; label: string; icon: string }[] = [
  { id: 'attentive', label: 'Attentive', icon: '👀' },
  { id: 'happy', label: 'Happy', icon: '✨' },
  { id: 'curious', label: 'Curious', icon: '❓' },
  { id: 'thinking', label: 'Thinking', icon: '💡' },
  { id: 'sleepy', label: 'Sleepy', icon: '💤' },
  { id: 'playful', label: 'Playful', icon: '🐾' },
];

export const PetFacePreview: React.FC<PetFacePreviewProps> = ({
  petStatus,
  currentMood,
  onMoodChange,
  interactive = true,
}) => {
  return (
    <div className="pet-face-card">
      <div className="card-header" style={{ marginBottom: 0 }}>
        <div className="card-title-group">
          <Sparkles className="card-icon" />
          <div>
            <h3 className="card-title">{petStatus.name} — Face Preview</h3>
            <p className="card-subtitle">Simulated 1.5" OLED Head Visor Display</p>
          </div>
        </div>
        <span className="badge badge-phase">Simulated (Phase 1)</span>
      </div>

      {/* OLED Hardware Visor Display */}
      <div className="oled-screen-frame" role="img" aria-label={`Pet face displaying ${currentMood} expression`}>
        <div className="oled-status-bar">
          <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <Activity size={12} /> {petStatus.mode.toUpperCase()}
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <Battery size={12} /> {petStatus.batteryLevel}% VIRTUAL
          </span>
        </div>

        {/* Dynamic Digital Eyes */}
        <div className="oled-eyes-display">
          <div className={`oled-eye eye-left ${currentMood}`} />
          <div className={`oled-eye eye-right ${currentMood}`} />
        </div>

        <div style={{ zIndex: 3, marginTop: '8px', fontSize: '11px', color: 'var(--accent-primary)', opacity: 0.8, fontFamily: 'var(--font-mono)' }}>
          [ MOOD: {currentMood.toUpperCase()} ]
        </div>
      </div>

      {/* Mood Picker */}
      {interactive && onMoodChange && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '11.5px', color: 'var(--text-muted)', fontWeight: 500 }}>
              TEST EXPRESSION STATE
            </span>
            <span style={{ fontSize: '11px', color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>
              Temp: {petStatus.temperatureCelsius}°C
            </span>
          </div>

          <div className="expression-picker-group">
            {MOODS.map((m) => (
              <button
                key={m.id}
                type="button"
                className={`expression-btn ${currentMood === m.id ? 'active' : ''}`}
                onClick={() => onMoodChange(m.id)}
                aria-pressed={currentMood === m.id}
              >
                <span>{m.icon}</span>
                <span>{m.label}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Hardware Link Notice */}
      <div style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '6px', paddingTop: '4px', borderTop: '1px solid var(--border-subtle)' }}>
        <Cpu size={13} style={{ flexShrink: 0, color: 'var(--status-amber)' }} />
        <span>Hardware sync (I2C OLED + dual head servos) scheduled for Phase 3.</span>
      </div>
    </div>
  );
};
