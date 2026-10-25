import React, { useState } from 'react';
import type { Theme } from '../types';
import type { UserProfile } from '../lib/adapters';
import { PlannedFeatureNotice } from '../components/common/PlannedFeatureNotice';
import {
  Settings,
  Shield,
  Moon,
  Sun,
  Download,
  RotateCcw,
  Cpu,
  User as UserIcon,
  LogIn,
  LogOut,
  Check,
  AlertCircle,
  RefreshCw,
  Loader2,
} from 'lucide-react';
import { useAuth } from '../context/useAuth';
import { supabaseEnvErrors } from '../lib/supabase';

interface SettingsPageProps {
  theme: Theme;
  onToggleTheme: () => void;
  onResetData: () => void;
  onOpenAuthModal?: () => void;
  profile?: UserProfile | null;
  profileLoading?: boolean;
  profileSaving?: boolean;
  profileError?: string | null;
  onUpdateFullName?: (newFullName: string) => Promise<boolean>;
  onRetryProfile?: () => void;
}

export const SettingsPage: React.FC<SettingsPageProps> = ({
  theme,
  onToggleTheme,
  onResetData,
  onOpenAuthModal,
  profile = null,
  profileLoading = false,
  profileSaving = false,
  profileError = null,
  onUpdateFullName,
  onRetryProfile,
}) => {
  const { user, signOut, isConfigured } = useAuth();
  const [fullNameInput, setFullNameInput] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);

  const displayedFullName = fullNameInput ?? (profile?.fullName || '');
  const isSaveDisabled =
    fullNameInput === null || fullNameInput.trim() === (profile?.fullName || '');

  const handleSaveFullName = async () => {
    if (!onUpdateFullName || fullNameInput === null) return;
    const ok = await onUpdateFullName(fullNameInput.trim());
    if (ok) {
      setFullNameInput(null);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 2500);
    }
  };

  const handleExportJSON = () => {
    const dataStr =
      'data:text/json;charset=utf-8,' +
      encodeURIComponent(
        JSON.stringify(
          { project: 'Smart Pet Assistant', phase: 2, exportedAt: new Date().toISOString() },
          null,
          2
        )
      );
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute('href', dataStr);
    downloadAnchor.setAttribute('download', 'kuro_assistant_state.json');
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <PlannedFeatureNotice
        phase="Phase 2: User Account &amp; Profiles"
        title="Settings &amp; Privacy Dashboard"
        description="Configure display preferences, profile information, and cloud sync. User profiles are stored in your public.users table."
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
                  style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
                >
                  <Download size={14} />
                  <span>Export JSON</span>
                </button>

                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={onResetData}
                  style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
                >
                  <RotateCcw size={14} />
                  <span>Reset Demo Seeds</span>
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Right Column: Account Management & Privacy */}
        <div className="col-6" style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          {/* Account & Cloud Authentication */}
          <div className="card">
            <div className="card-header">
              <div className="card-title-group">
                <UserIcon className="card-icon" />
                <h3 className="card-title">Account &amp; User Profile</h3>
              </div>
              <span className={`badge ${user ? 'badge-active' : 'badge-phase'}`}>
                {user ? 'Authenticated' : 'Local Companion Mode'}
              </span>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              {user ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div>
                      <strong style={{ fontSize: '13.5px', color: 'var(--text-primary)' }}>Active Account</strong>
                      <p style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                        {user.email}
                      </p>
                    </div>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={() => signOut()}
                      style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
                    >
                      <LogOut size={14} />
                      <span>Sign Out</span>
                    </button>
                  </div>

                  {profileError && (
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: '8px',
                        padding: '8px 12px',
                        backgroundColor: 'rgba(239, 68, 68, 0.12)',
                        border: '1px solid var(--status-red)',
                        borderRadius: 'var(--radius-sm)',
                        fontSize: '12px',
                        color: 'var(--text-primary)',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <AlertCircle size={14} style={{ color: 'var(--status-red)', flexShrink: 0 }} />
                        <span>{profileError}</span>
                      </div>
                      {onRetryProfile && (
                        <button
                          type="button"
                          className="btn btn-secondary"
                          onClick={onRetryProfile}
                          style={{ padding: '2px 8px', fontSize: '11px' }}
                        >
                          <RefreshCw size={10} /> Retry
                        </button>
                      )}
                    </div>
                  )}

                  {profileLoading ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '12px 0', fontSize: '12.5px', color: 'var(--text-muted)' }}>
                      <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} />
                      <span>Loading profile from database...</span>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', paddingTop: '8px', borderTop: '1px solid var(--border-subtle)' }}>
                      <div>
                        <label style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>
                          Account Email (Read-only)
                        </label>
                        <input
                          type="text"
                          value={user.email || profile?.email || ''}
                          readOnly
                          disabled
                          style={{
                            width: '100%',
                            padding: '7px 10px',
                            background: 'var(--bg-input)',
                            border: '1px solid var(--border-subtle)',
                            borderRadius: 'var(--radius-sm)',
                            color: 'var(--text-muted)',
                            fontSize: '12.5px',
                            cursor: 'not-allowed',
                          }}
                        />
                      </div>

                      <div>
                        <label style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>
                          Full Name / Display Name
                        </label>
                        <div style={{ display: 'flex', gap: '8px' }}>
                          <input
                            type="text"
                            value={displayedFullName}
                            onChange={(e) => setFullNameInput(e.target.value)}
                            placeholder="e.g. User"
                            disabled={profileSaving}
                            style={{
                              flex: 1,
                              padding: '7px 10px',
                              background: 'var(--bg-input)',
                              border: '1px solid var(--border-subtle)',
                              borderRadius: 'var(--radius-sm)',
                              color: 'var(--text-primary)',
                              fontSize: '12.5px',
                            }}
                          />
                          <button
                            type="button"
                            className="btn btn-primary"
                            onClick={handleSaveFullName}
                            disabled={profileSaving || isSaveDisabled}
                            style={{ padding: '6px 12px', fontSize: '12px' }}
                          >
                            {profileSaving ? (
                              <>
                                <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} />
                                <span>Saving...</span>
                              </>
                            ) : (
                              <>
                                <Check size={12} />
                                <span>Save</span>
                              </>
                            )}
                          </button>
                        </div>
                        {saveSuccess && (
                          <div style={{ fontSize: '11px', color: 'var(--status-green)', marginTop: '4px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                            <Check size={12} />
                            <span>Profile name saved to database.</span>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div>
                    <strong style={{ fontSize: '13.5px', color: 'var(--text-primary)' }}>Sign In / Register</strong>
                    <p style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                      Sync preferences across sessions
                    </p>
                  </div>
                  {onOpenAuthModal && (
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={onOpenAuthModal}
                      style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
                    >
                      <LogIn size={14} />
                      <span>Sign In</span>
                    </button>
                  )}
                </div>
              )}

              {/* Environment / Configuration Status */}
              <div style={{ paddingTop: '12px', borderTop: '1px solid var(--border-subtle)', fontSize: '12.5px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                  <span style={{ color: 'var(--text-secondary)' }}>Supabase Configuration</span>
                  <span className={`badge ${isConfigured ? 'badge-neutral' : 'badge-warning'}`}>
                    {isConfigured ? 'Environment Keys Present' : 'Missing Configuration'}
                  </span>
                </div>
                <p style={{ fontSize: '11.5px', color: 'var(--text-muted)' }}>
                  {isConfigured
                    ? 'Publishable key configured. Connected to Supabase backend.'
                    : 'Configure VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY to activate cloud sync.'}
                </p>
                {supabaseEnvErrors.length > 0 && (
                  <div style={{ marginTop: '8px', color: 'var(--status-red)', fontSize: '11.5px' }}>
                    {supabaseEnvErrors.map((err, i) => (
                      <div key={i}>• {err}</div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

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
                <span className="badge badge-phase">In Progress (Persistence)</span>
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
