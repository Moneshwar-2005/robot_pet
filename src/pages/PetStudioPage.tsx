import React, { useState } from 'react';
import type { PetStatus, PetMood } from '../types';
import type { ClientPetSettings } from '../lib/adapters';
import { PetFacePreview } from '../components/pet/PetFacePreview';
import { PlannedFeatureNotice } from '../components/common/PlannedFeatureNotice';
import { Cpu, Sliders, Volume2, Eye, Check, RefreshCw, AlertCircle, Loader2 } from 'lucide-react';

interface PetStudioPageProps {
  petStatus: PetStatus;
  currentMood: PetMood;
  onMoodChange: (mood: PetMood) => void;
  petSettings: ClientPetSettings;
  loading?: boolean;
  saving?: boolean;
  error?: string | null;
  onUpdatePetSettings: (newSettings: Partial<ClientPetSettings>) => Promise<boolean>;
  onRetry?: () => void;
}

export const PetStudioPage: React.FC<PetStudioPageProps> = ({
  petStatus,
  currentMood,
  onMoodChange,
  petSettings,
  loading = false,
  saving = false,
  error = null,
  onUpdatePetSettings,
  onRetry,
}) => {
  const [nameInput, setNameInput] = useState<string | null>(null);
  const [volumeLevel, setVolumeLevel] = useState(65);
  const [saveSuccess, setSaveSuccess] = useState(false);

  const displayedPetName = nameInput ?? petSettings.petName;

  const handleNameBlur = () => {
    if (nameInput !== null && nameInput.trim() && nameInput.trim() !== petSettings.petName) {
      void onUpdatePetSettings({ petName: nameInput.trim() }).then((ok) => {
        if (ok) triggerSuccessBadge();
      });
    }
    setNameInput(null);
  };

  const triggerSuccessBadge = () => {
    setSaveSuccess(true);
    setTimeout(() => setSaveSuccess(false), 2000);
  };

  const handleShapeChange = (shape: 'curved' | 'round' | 'pixel') => {
    void onUpdatePetSettings({ eyeShape: shape }).then((ok) => {
      if (ok) triggerSuccessBadge();
    });
  };

  const handleColorChange = (color: 'cyan' | 'emerald' | 'amber' | 'violet') => {
    void onUpdatePetSettings({ glowColor: color }).then((ok) => {
      if (ok) triggerSuccessBadge();
    });
  };

  const handlePlayfulnessChange = (val: number) => {
    void onUpdatePetSettings({ playfulness: val }).then((ok) => {
      if (ok) triggerSuccessBadge();
    });
  };

  const handleFocusDisciplineChange = (val: number) => {
    void onUpdatePetSettings({ focusDiscipline: val }).then((ok) => {
      if (ok) triggerSuccessBadge();
    });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <PlannedFeatureNotice
        phase="Phase 2: Persistent Settings"
        title="Digital Avatar &amp; Expression Studio"
        description="Configure your robot companion's digital face, colorway, and personality parameters. Settings are persisted to Supabase for your authenticated account."
      />

      {error && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '12px',
            padding: '12px 16px',
            backgroundColor: 'rgba(239, 68, 68, 0.12)',
            border: '1px solid var(--status-red)',
            borderRadius: 'var(--radius-md)',
            color: 'var(--text-primary)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <AlertCircle size={18} style={{ color: 'var(--status-red)', flexShrink: 0 }} />
            <span style={{ fontSize: '13px' }}>{error}</span>
          </div>
          {onRetry && (
            <button
              type="button"
              className="btn btn-secondary"
              onClick={onRetry}
              style={{ padding: '4px 10px', fontSize: '12px' }}
            >
              <RefreshCw size={12} />
              <span>Retry</span>
            </button>
          )}
        </div>
      )}

      <div className="dashboard-grid">
        {/* Left Column: Interactive Face Visor Preview */}
        <div className="col-6">
          <PetFacePreview
            petStatus={{ ...petStatus, name: petSettings.petName }}
            currentMood={currentMood}
            onMoodChange={onMoodChange}
            interactive={true}
          />

          <div className="card" style={{ marginTop: '20px' }}>
            <div className="card-header">
              <div className="card-title-group">
                <Cpu className="card-icon" />
                <div>
                  <h3 className="card-title">Physical Hardware Mapping</h3>
                  <p className="card-subtitle">Pinout &amp; servo configuration preview</p>
                </div>
              </div>
              <span className="badge badge-planned">Planned (Phase 3)</span>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', fontSize: '13px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 10px', background: 'var(--bg-card-subtle)', borderRadius: 'var(--radius-sm)' }}>
                <span style={{ color: 'var(--text-secondary)' }}>Microcontroller</span>
                <span className="mono">ESP32-S3 Dual-Core</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 10px', background: 'var(--bg-card-subtle)', borderRadius: 'var(--radius-sm)' }}>
                <span style={{ color: 'var(--text-secondary)' }}>Display Protocol</span>
                <span className="mono">SSD1306 / SH1106 I2C (128x64)</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 10px', background: 'var(--bg-card-subtle)', borderRadius: 'var(--radius-sm)' }}>
                <span style={{ color: 'var(--text-secondary)' }}>Head Articulation</span>
                <span className="mono">2x SG90 Micro Servos (Pan/Tilt)</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 10px', background: 'var(--bg-card-subtle)', borderRadius: 'var(--radius-sm)' }}>
                <span style={{ color: 'var(--text-secondary)' }}>Audio Transducer</span>
                <span className="mono">Passive Piezo Buzzer / DAC</span>
              </div>
            </div>
          </div>
        </div>

        {/* Right Column: Avatar Customization Controls */}
        <div className="col-6" style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <div className="card">
            <div className="card-header">
              <div className="card-title-group">
                <Eye className="card-icon" />
                <div>
                  <h3 className="card-title">Visor Display Aesthetics</h3>
                  <p className="card-subtitle">Custom eye geometry &amp; pixel styles</p>
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                {saving && (
                  <span className="badge badge-neutral" style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <Loader2 size={11} style={{ animation: 'spin 1s linear infinite' }} /> Saving...
                  </span>
                )}
                {saveSuccess && (
                  <span className="badge badge-active" style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <Check size={11} /> Saved
                  </span>
                )}
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div>
                <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '8px', display: 'block' }}>
                  Companion Name
                </label>
                <input
                  type="text"
                  value={displayedPetName}
                  onChange={(e) => setNameInput(e.target.value)}
                  onBlur={handleNameBlur}
                  placeholder="Companion Name..."
                  disabled={loading}
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    background: 'var(--bg-input)',
                    border: '1px solid var(--border-subtle)',
                    borderRadius: 'var(--radius-sm)',
                    color: 'var(--text-primary)',
                    fontSize: '13px',
                  }}
                />
              </div>

              <div>
                <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '8px', display: 'block' }}>
                  Eye Shape Geometry
                </label>
                <div style={{ display: 'flex', gap: '8px' }}>
                  {(['curved', 'round', 'pixel'] as const).map((shape) => (
                    <button
                      key={shape}
                      type="button"
                      disabled={loading || saving}
                      className={`expression-btn ${petSettings.eyeShape === shape ? 'active' : ''}`}
                      onClick={() => handleShapeChange(shape)}
                      style={{ textTransform: 'capitalize' }}
                    >
                      {shape === 'curved' ? 'Curved OLED' : shape === 'round' ? 'Circular Dome' : 'Retro Pixel'}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '8px', display: 'block' }}>
                  Screen Glow Palette
                </label>
                <div style={{ display: 'flex', gap: '8px' }}>
                  {(['cyan', 'emerald', 'amber', 'violet'] as const).map((color) => (
                    <button
                      key={color}
                      type="button"
                      disabled={loading || saving}
                      className={`expression-btn ${petSettings.glowColor === color ? 'active' : ''}`}
                      onClick={() => handleColorChange(color)}
                      style={{ textTransform: 'capitalize' }}
                    >
                      {color}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Personality & Audio Profile */}
          <div className="card">
            <div className="card-header">
              <div className="card-title-group">
                <Sliders className="card-icon" />
                <div>
                  <h3 className="card-title">Companion Personality Tuning</h3>
                  <p className="card-subtitle">Behavior weighting &amp; sound profile</p>
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', marginBottom: '6px' }}>
                  <span>Focus Discipline</span>
                  <span className="mono">{petSettings.focusDiscipline}%</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="100"
                  disabled={loading || saving}
                  value={petSettings.focusDiscipline}
                  onChange={(e) => handleFocusDisciplineChange(Number(e.target.value))}
                  style={{ width: '100%', accentColor: 'var(--accent-primary)' }}
                />
                <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                  Higher values reduce playful interruptions during active deep work blocks.
                </span>
              </div>

              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', marginBottom: '6px' }}>
                  <span>Playfulness &amp; Reactivity</span>
                  <span className="mono">{petSettings.playfulness}%</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="100"
                  disabled={loading || saving}
                  value={petSettings.playfulness}
                  onChange={(e) => handlePlayfulnessChange(Number(e.target.value))}
                  style={{ width: '100%', accentColor: 'var(--accent-primary)' }}
                />
              </div>

              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', marginBottom: '6px' }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <Volume2 size={14} /> Chime Volume (Local Only)
                  </span>
                  <span className="mono">{volumeLevel}%</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={volumeLevel}
                  onChange={(e) => setVolumeLevel(Number(e.target.value))}
                  style={{ width: '100%', accentColor: 'var(--accent-primary)' }}
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
