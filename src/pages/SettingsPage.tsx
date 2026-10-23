import React from 'react';
import type { Theme } from '../types';
import { PlannedFeatureNotice } from '../components/common/PlannedFeatureNotice';
import { Settings, Shield, Moon, Sun, Download, RotateCcw, Cpu } from 'lucide-react';

interface SettingsPageProps {
  theme: Theme;
  onToggleTheme: () => void;
  onResetData: () => void;
}

export const SettingsPage: React.FC<SettingsPageProps> = ({
  theme,
  onToggleTheme,
  onResetData,
}) => {
  const handleExportJSON = () => {
    const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(
      JSON.stringify({ project: 'Smart Pet Assistant', phase: 1, exportedAt: new Date().toISOString() }, null, 2)
    );
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute('href', dataStr);
    downloadAnchor.setAttribute('download', 'kuro_assistant_phase1_state.json');
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <PlannedFeatureNotice
        phase="Phase 1: Local Configuration"
        title="Settings &amp; Privacy Dashboard"
        description="Configure display preferences, local storage, and privacy boundaries. Cloud account management and biometric lock will be enabled in Phase 2."
      />

      <div className="dashboard-grid">
        {/* Appearance & Interface */}
        <div className="col-6" style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <div className="card">
            <div className="card-header">
              <div className="card-title-group">
                <Settings className="card-icon" />
                <h3 className="card-title">Appearance &amp; Display</h3>
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div>
                  <strong style={{ fontSize: '13.5px', color: 'var(--text-primary)' }}>Color Theme</strong>
                  <p style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                    Current active theme: <span style={{ textTransform: 'capitalize' }}>{theme} Mode</span>
                  </p>
                </div>

                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={onToggleTheme}
                  style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
                >
                  {theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
                  <span>Switch to {theme === 'dark' ? 'Light' : 'Dark'}</span>
                </button>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: '12px', borderTop: '1px solid var(--border-subtle)' }}>
                <div>
                  <strong style={{ fontSize: '13.5px', color: 'var(--text-primary)' }}>Simulated OLED Screen Frame</strong>
                  <p style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                    Scanlines &amp; bezel styling enabled
                  </p>
                </div>
                <span className="badge badge-active">Active</span>
              </div>
            </div>
          </div>

          {/* Local State & Data Management */}
          <div className="card">
            <div className="card-header">
              <h3 className="card-title">Local Mock Data Management</h3>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <p style={{ fontSize: '12.5px', color: 'var(--text-secondary)' }}>
                Phase 1 uses client-side state for all tasks, reminders, and pet expressions. You can export this mock state or restore original seeds.
              </p>

              <div style={{ display: 'flex', gap: '10px' }}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={handleExportJSON}
                >
                  <Download size={14} />
                  <span>Export State JSON</span>
                </button>

                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={onResetData}
                >
                  <RotateCcw size={14} />
                  <span>Reset Mock Seeds</span>
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Privacy & Hardware Roadmap */}
        <div className="col-6" style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <div className="card">
            <div className="card-header">
              <div className="card-title-group">
                <Shield className="card-icon" style={{ color: 'var(--status-green)' }} />
                <h3 className="card-title">Privacy &amp; Security Policy</h3>
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', fontSize: '13px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px', background: 'var(--bg-card-subtle)', borderRadius: 'var(--radius-sm)' }}>
                <div>
                  <div style={{ fontWeight: 600 }}>Zero External Cloud Telemetry</div>
                  <div style={{ fontSize: '11.5px', color: 'var(--text-muted)' }}>No user tracking or analytics transmitted</div>
                </div>
                <span className="badge badge-active">Enforced</span>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px', background: 'var(--bg-card-subtle)', borderRadius: 'var(--radius-sm)' }}>
                <div>
                  <div style={{ fontWeight: 600 }}>Local-Only AI Processing Mode</div>
                  <div style={{ fontSize: '11.5px', color: 'var(--text-muted)' }}>Configured for local LLM inference</div>
                </div>
                <span className="badge badge-phase">Planned (Phase 2)</span>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px', background: 'var(--bg-card-subtle)', borderRadius: 'var(--radius-sm)' }}>
                <div>
                  <div style={{ fontWeight: 600 }}>Supabase End-to-End Encryption</div>
                  <div style={{ fontSize: '11.5px', color: 'var(--text-muted)' }}>Client-side key derivation</div>
                </div>
                <span className="badge badge-planned">Planned (Phase 2)</span>
              </div>
            </div>
          </div>

          <div className="card">
            <div className="card-header">
              <div className="card-title-group">
                <Cpu className="card-icon" style={{ color: 'var(--status-amber)' }} />
                <h3 className="card-title">Project Roadmap Status</h3>
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', fontSize: '12.5px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span>Phase 1: Web Application Shell &amp; Dashboard</span>
                <span className="badge badge-active">Completed Now</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span>Phase 2: AI Backend, Cloud DB &amp; Sync</span>
                <span className="badge badge-phase">Upcoming</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span>Phase 3: ESP32 Physical Robot Hardware</span>
                <span className="badge badge-planned">Scheduled</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
