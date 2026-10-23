import React, { useState } from 'react';
import type { PetStatus, PetMood } from '../types';
import { PetFacePreview } from '../components/pet/PetFacePreview';
import { PlannedFeatureNotice } from '../components/common/PlannedFeatureNotice';
import { Cpu, Sliders, Volume2, Eye } from 'lucide-react';

interface PetStudioPageProps {
  petStatus: PetStatus;
  currentMood: PetMood;
  onMoodChange: (mood: PetMood) => void;
}

export const PetStudioPage: React.FC<PetStudioPageProps> = ({
  petStatus,
  currentMood,
  onMoodChange,
}) => {
  const [selectedEyeShape, setSelectedEyeShape] = useState<'curved' | 'round' | 'pixel'>('curved');
  const [selectedColor, setSelectedColor] = useState<'cyan' | 'emerald' | 'amber' | 'violet'>('cyan');
  const [volumeLevel, setVolumeLevel] = useState(65);
  const [playfulness, setPlayfulness] = useState(70);
  const [focusDiscipline, setFocusDiscipline] = useState(85);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <PlannedFeatureNotice
        phase="Phase 1: Visual Studio Preview"
        title="Digital Avatar & Expression Studio"
        description="Configure your robot companion's digital face, colorway, and personality parameters. Physical ESP32 servo motor calibration and hardware OLED flashing will be activated in Phase 3."
      />

      <div className="dashboard-grid">
        {/* Left Column: Interactive Face Visor Preview */}
        <div className="col-6">
          <PetFacePreview
            petStatus={petStatus}
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
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div>
                <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '8px', display: 'block' }}>
                  Eye Shape Geometry
                </label>
                <div style={{ display: 'flex', gap: '8px' }}>
                  {(['curved', 'round', 'pixel'] as const).map((shape) => (
                    <button
                      key={shape}
                      type="button"
                      className={`expression-btn ${selectedEyeShape === shape ? 'active' : ''}`}
                      onClick={() => setSelectedEyeShape(shape)}
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
                      className={`expression-btn ${selectedColor === color ? 'active' : ''}`}
                      onClick={() => setSelectedColor(color)}
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
                  <span className="mono">{focusDiscipline}%</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={focusDiscipline}
                  onChange={(e) => setFocusDiscipline(Number(e.target.value))}
                  style={{ width: '100%', accentColor: 'var(--accent-primary)' }}
                />
                <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                  Higher values reduce playful interruptions during active deep work blocks.
                </span>
              </div>

              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', marginBottom: '6px' }}>
                  <span>Playfulness &amp; Reactivity</span>
                  <span className="mono">{playfulness}%</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={playfulness}
                  onChange={(e) => setPlayfulness(Number(e.target.value))}
                  style={{ width: '100%', accentColor: 'var(--accent-primary)' }}
                />
              </div>

              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', marginBottom: '6px' }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <Volume2 size={14} /> Chime Volume
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
