import React, { useState } from 'react';
import type { Theme, Task, Reminder, UserPreferences } from '../types';
import { DEFAULT_USER_PREFERENCES } from '../types';
import type { UserProfile, ClientWorkSession, ClientPetSettings } from '../lib/adapters';
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
  Wifi,
  WifiOff,
  HardDrive,
  Smartphone,
  EyeOff,
  Sparkles,
} from 'lucide-react';
import { useAuth } from '../context/useAuth';
import { supabaseEnvErrors } from '../lib/supabase';
import { useNetworkStatus } from '../hooks/useNetworkStatus';
import { usePWAInstall } from '../hooks/usePWAInstall';
import { useSyncStatus } from '../hooks/useSyncStatus';
import { MobileAICompatibilityCard } from '../components/settings/MobileAICompatibilityCard';
import { DesktopCompanionCard } from '../components/settings/DesktopCompanionCard';

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
  preferences?: UserPreferences;
  preferencesLoading?: boolean;
  preferencesSaving?: boolean;
  preferencesError?: string | null;
  onUpdatePreferences?: (updates: Partial<UserPreferences>) => Promise<boolean>;
  onRetryPreferences?: () => void;
  tasks?: Task[];
  reminders?: Reminder[];
  petSettings?: ClientPetSettings;
  sessions?: ClientWorkSession[];
}

const ToggleSwitch: React.FC<{
  id: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  label: string;
}> = ({ id, checked, onChange, disabled = false, label }) => (
  <button
    id={id}
    type="button"
    role="switch"
    aria-checked={checked}
    aria-label={label}
    disabled={disabled}
    onClick={() => !disabled && onChange(!checked)}
    style={{
      position: 'relative',
      width: '44px',
      height: '24px',
      borderRadius: '12px',
      backgroundColor: disabled
        ? 'var(--bg-card-subtle)'
        : checked
          ? 'var(--accent-primary)'
          : 'var(--bg-input)',
      border: `1px solid ${checked && !disabled ? 'var(--accent-primary)' : 'var(--border-subtle)'}`,
      cursor: disabled ? 'not-allowed' : 'pointer',
      opacity: disabled ? 0.45 : 1,
      transition: 'all 0.2s ease',
      padding: 0,
      flexShrink: 0,
    }}
  >
    <span
      style={{
        position: 'absolute',
        top: '2px',
        left: checked ? '22px' : '2px',
        width: '18px',
        height: '18px',
        borderRadius: '50%',
        backgroundColor: checked && !disabled ? '#03070d' : 'var(--text-secondary)',
        transition: 'left 0.2s ease, background-color 0.2s ease',
        boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
      }}
    />
  </button>
);

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
  preferences = DEFAULT_USER_PREFERENCES,
  preferencesLoading = false,
  preferencesSaving = false,
  preferencesError = null,
  onUpdatePreferences,
  onRetryPreferences,
  tasks = [],
  reminders = [],
  petSettings,
  sessions = [],
}) => {
  const { user, signOut, isConfigured } = useAuth();
  const { isOnline } = useNetworkStatus();
  const { isInstallable, isInstalled, promptInstall } = usePWAInstall();
  const { isSyncing, pendingCount, lastSyncedAt, lastError, triggerSync } = useSyncStatus();
  const [fullNameInput, setFullNameInput] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [prefSaveSuccess, setPrefSaveSuccess] = useState(false);

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

  const handleUpdatePreference = async (updates: Partial<UserPreferences>) => {
    if (!onUpdatePreferences) return;
    const ok = await onUpdatePreferences(updates);
    if (ok) {
      setPrefSaveSuccess(true);
      setTimeout(() => setPrefSaveSuccess(false), 2500);
    }
  };

  const handleExportJSON = () => {
    const exportPayload = {
      project: 'Kuro Smart Robot Pet + Personal Assistant',
      exportedAt: new Date().toISOString(),
      account: {
        userId: user?.id || 'demo-user',
        email: user?.email || 'local-demo@kuro.internal',
        fullName: profile?.fullName || null,
        authenticated: Boolean(user),
      },
      petSettings: petSettings || {
        petName: 'Kuro',
        avatarVariant: 'standard',
        eyeShape: 'curved',
        glowColor: 'cyan',
        playfulness: 70,
        focusDiscipline: 85,
      },
      tasks: tasks.map((t) => ({
        id: t.id,
        title: t.title,
        category: t.category,
        priority: t.priority,
        dueDate: t.dueDate,
        dueTime: t.dueTime,
        estimatedMinutes: t.estimatedMinutes,
        completed: t.completed,
        tags: t.tags,
      })),
      reminders: reminders.map((r) => ({
        id: r.id,
        title: r.title,
        time: r.time,
        type: r.type,
        priority: r.priority,
        done: r.done,
      })),
      workSessions: sessions.map((s) => ({
        id: s.id,
        title: s.title,
        sessionType: s.sessionType,
        durationMinutes: s.durationMinutes,
        startedAt: s.startedAt,
        completedAt: s.completedAt,
      })),
    };

    const dataStr =
      'data:text/json;charset=utf-8,' +
      encodeURIComponent(JSON.stringify(exportPayload, null, 2));
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

          {/* Automation & Daily Report Preferences (Phase 9 Milestone 2) */}
          <div className="card">
            <div className="card-header">
              <div className="card-title-group">
                <Sparkles className="card-icon" style={{ color: 'var(--status-amber)' }} />
                <h3 className="card-title">Automation &amp; Daily Report Preferences</h3>
              </div>
              <span className={`badge ${preferences.autoReportsEnabled ? 'badge-active' : 'badge-neutral'}`}>
                {preferences.autoReportsEnabled ? 'Auto-Reports Enabled' : 'Manual Only'}
              </span>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              {/* Feedback banners */}
              {preferencesError && (
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
                    <span>{preferencesError}</span>
                  </div>
                  {onRetryPreferences && (
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={onRetryPreferences}
                      style={{ padding: '2px 8px', fontSize: '11px' }}
                    >
                      <RefreshCw size={10} /> Retry
                    </button>
                  )}
                </div>
              )}

              {preferencesLoading && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', color: 'var(--text-muted)' }}>
                  <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} />
                  <span>Loading user preferences from database...</span>
                </div>
              )}

              {preferencesSaving && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: 'var(--accent-primary)' }}>
                  <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} />
                  <span>Saving preference changes...</span>
                </div>
              )}

              {prefSaveSuccess && !preferencesSaving && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: 'var(--status-green)' }}>
                  <Check size={12} />
                  <span>Preferences saved and synchronized.</span>
                </div>
              )}

              {/* 1. auto_reports_enabled */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ paddingRight: '12px' }}>
                  <strong style={{ fontSize: '13.5px', color: 'var(--text-primary)' }}>Automated Daily Reports</strong>
                  <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: '2px 0 0 0' }}>
                    Synthesizes completed tasks and work sessions into an end-of-day summary.
                  </p>
                  <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontStyle: 'italic' }}>
                    Privacy Default: Disabled. Requires explicit opt-in.
                  </span>
                </div>
                <ToggleSwitch
                  id="pref-auto-reports"
                  label="Automated Daily Reports"
                  checked={preferences.autoReportsEnabled}
                  disabled={preferencesSaving}
                  onChange={(checked) => handleUpdatePreference({ autoReportsEnabled: checked })}
                />
              </div>

              {/* 2. daily_report_time */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: '12px', borderTop: '1px solid var(--border-subtle)' }}>
                <div style={{ paddingRight: '12px' }}>
                  <strong style={{ fontSize: '13.5px', color: 'var(--text-primary)' }}>Daily Report Generation Time</strong>
                  <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: '2px 0 0 0' }}>
                    Scheduled time to generate and deliver daily work summaries.
                  </p>
                </div>
                <input
                  type="time"
                  id="pref-daily-report-time"
                  aria-label="Daily Report Scheduled Time"
                  value={preferences.dailyReportTime}
                  disabled={preferencesSaving}
                  onChange={(e) => handleUpdatePreference({ dailyReportTime: e.target.value })}
                  style={{
                    padding: '6px 10px',
                    background: 'var(--bg-input)',
                    border: '1px solid var(--border-subtle)',
                    borderRadius: 'var(--radius-sm)',
                    color: 'var(--text-primary)',
                    fontSize: '12.5px',
                    cursor: preferencesSaving ? 'not-allowed' : 'pointer',
                  }}
                />
              </div>

              {/* 3. auto_break_reminders */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: '12px', borderTop: '1px solid var(--border-subtle)' }}>
                <div style={{ paddingRight: '12px' }}>
                  <strong style={{ fontSize: '13.5px', color: 'var(--text-primary)' }}>Focus Break &amp; Rest Reminders</strong>
                  <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: '2px 0 0 0' }}>
                    Prompts gentle stretch, posture, and hydration chimes during extended focus sessions.
                  </p>
                </div>
                <ToggleSwitch
                  id="pref-break-reminders"
                  label="Focus Break & Rest Reminders"
                  checked={preferences.autoBreakReminders}
                  disabled={preferencesSaving}
                  onChange={(checked) => handleUpdatePreference({ autoBreakReminders: checked })}
                />
              </div>

              {/* 4. music_reaction_enabled */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: '12px', borderTop: '1px solid var(--border-subtle)' }}>
                <div style={{ paddingRight: '12px' }}>
                  <strong style={{ fontSize: '13.5px', color: 'var(--text-primary)' }}>Media &amp; Music Reactive Moods</strong>
                  <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: '2px 0 0 0' }}>
                    Allows Kuro to react procedurally to desktop media and music playback events.
                  </p>
                  <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontStyle: 'italic' }}>
                    Privacy Default: Disabled. Requires explicit opt-in.
                  </span>
                </div>
                <ToggleSwitch
                  id="pref-music-reactions"
                  label="Media & Music Reactive Moods"
                  checked={preferences.musicReactionEnabled}
                  disabled={preferencesSaving}
                  onChange={(checked) => handleUpdatePreference({ musicReactionEnabled: checked })}
                />
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

          {/* Progressive Web App & Offline Foundation */}
          <div className="card">
            <div className="card-header">
              <div className="card-title-group">
                <HardDrive className="card-icon" style={{ color: 'var(--accent-primary)' }} />
                <h3 className="card-title">PWA &amp; Offline Foundation</h3>
              </div>
              <span className={`badge ${isOnline ? 'badge-active' : 'badge-warning'}`} style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                {isOnline ? <Wifi size={11} /> : <WifiOff size={11} />}
                <span>{isOnline ? 'Network Online' : 'Offline Mode'}</span>
              </span>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', fontSize: '13px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div>
                  <strong style={{ fontSize: '13.5px', color: 'var(--text-primary)' }}>Application Installation</strong>
                  <p style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                    {isInstalled
                      ? 'Running as installed standalone desktop/mobile app'
                      : isInstallable
                        ? 'Ready for desktop or mobile installation'
                        : 'Web browser mode (PWA manifest active)'}
                  </p>
                </div>

                {isInstalled ? (
                  <span className="badge badge-active" style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <Check size={11} /> Installed
                  </span>
                ) : isInstallable ? (
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={promptInstall}
                    style={{ padding: '6px 12px', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '6px' }}
                  >
                    <Smartphone size={13} />
                    <span>Install Kuro</span>
                  </button>
                ) : (
                  <span className="badge badge-neutral">Browser Mode</span>
                )}
              </div>

              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: '10px', borderTop: '1px solid var(--border-subtle)' }}>
                <div>
                  <div style={{ fontWeight: 500, color: 'var(--text-primary)' }}>Service Worker App Shell</div>
                  <div style={{ fontSize: '11.5px', color: 'var(--text-muted)' }}>Cached version: kuro-app-shell-v1</div>
                </div>
                <span className="badge badge-active">Active</span>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: '10px', borderTop: '1px solid var(--border-subtle)' }}>
                <div>
                  <div style={{ fontWeight: 500, color: 'var(--text-primary)' }}>IndexedDB Offline Storage</div>
                  <div style={{ fontSize: '11.5px', color: 'var(--text-muted)' }}>kuro_offline_db v2 initialized with Outbox</div>
                </div>
                <span className="badge badge-active">Ready</span>
              </div>

              {/* Offline Synchronization Status (Step 3.5) */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: '10px', borderTop: '1px solid var(--border-subtle)' }}>
                <div>
                  <div style={{ fontWeight: 500, color: 'var(--text-primary)' }}>Supabase Data Synchronization</div>
                  <div style={{ fontSize: '11.5px', color: 'var(--text-muted)' }}>
                    {user
                      ? pendingCount > 0
                        ? `${pendingCount} operation(s) waiting to synchronize`
                        : lastSyncedAt
                          ? `All changes synchronized (${new Date(lastSyncedAt).toLocaleTimeString()})`
                          : 'Synchronized with Supabase'
                      : 'Local demo mode (no remote sync)'}
                  </div>
                  {lastError && (
                    <div style={{ fontSize: '11px', color: 'var(--status-yellow)', marginTop: '2px' }}>
                      {lastError}
                    </div>
                  )}
                </div>

                {user && (
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => triggerSync()}
                    disabled={isSyncing}
                    style={{ padding: '4px 10px', fontSize: '11.5px', display: 'flex', alignItems: 'center', gap: '5px' }}
                    title="Process pending outbox synchronization immediately"
                  >
                    <RefreshCw size={12} style={{ animation: isSyncing ? 'spin 1s linear infinite' : undefined }} />
                    <span>{isSyncing ? 'Syncing...' : 'Sync Now'}</span>
                  </button>
                )}
              </div>

              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: '10px', borderTop: '1px solid var(--border-subtle)' }}>
                <div>
                  <div style={{ fontWeight: 500, color: 'var(--text-primary)' }}>Offline AI Capability</div>
                  <div style={{ fontSize: '11.5px', color: 'var(--text-muted)' }}>Local Ollama remains functional offline</div>
                </div>
                <span className="badge badge-active">100% On-Device</span>
              </div>

              <p style={{ fontSize: '11.5px', color: 'var(--text-muted)', lineHeight: '1.5', margin: 0 }}>
                Kuro uses a local-first architecture. Tasks and reminders are saved to IndexedDB first for instant responsiveness. When online, pending operations synchronize automatically with Supabase.
              </p>
            </div>
          </div>

          {/* Mobile & On-Device AI Compatibility Probe (Step 3.6.1) */}
          <MobileAICompatibilityCard />

          {/* Windows Desktop Companion Foundation (Step 4.1) */}
          <DesktopCompanionCard />
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

          {/* Activity Tracking & Privacy Controls (Phase 9 Milestone 2) */}
          <div className="card">
            <div className="card-header">
              <div className="card-title-group">
                <Shield className="card-icon" style={{ color: 'var(--accent-primary)' }} />
                <h3 className="card-title">Activity Tracking &amp; Privacy Controls</h3>
              </div>
              <span className={`badge ${preferences.activityTrackingEnabled ? 'badge-active' : 'badge-neutral'}`} style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                {preferences.activityTrackingEnabled ? (
                  <>
                    <Check size={11} /> Tracking Active
                  </>
                ) : (
                  <>
                    <EyeOff size={11} /> Disabled (Default)
                  </>
                )}
              </span>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              {/* Feedback banners */}
              {preferencesError && (
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
                    <span>{preferencesError}</span>
                  </div>
                  {onRetryPreferences && (
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={onRetryPreferences}
                      style={{ padding: '2px 8px', fontSize: '11px' }}
                    >
                      <RefreshCw size={10} /> Retry
                    </button>
                  )}
                </div>
              )}

              {/* 1. activity_tracking_enabled (Master Switch) */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ paddingRight: '12px' }}>
                  <strong style={{ fontSize: '13.5px', color: 'var(--text-primary)' }}>Computer Activity Tracking</strong>
                  <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: '2px 0 0 0' }}>
                    Opt-in telemetry for developer environment focus tracking. Zero data is recorded when disabled.
                  </p>
                  <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontStyle: 'italic' }}>
                    Privacy Default: Disabled. Never enabled automatically.
                  </span>
                </div>
                <ToggleSwitch
                  id="pref-activity-tracking"
                  label="Computer Activity Tracking"
                  checked={preferences.activityTrackingEnabled}
                  disabled={preferencesSaving}
                  onChange={(checked) => handleUpdatePreference({ activityTrackingEnabled: checked })}
                />
              </div>

              {/* 2. tracking_include_window_titles */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: '12px', borderTop: '1px solid var(--border-subtle)' }}>
                <div style={{ paddingRight: '12px' }}>
                  <strong style={{ fontSize: '13.5px', color: preferences.activityTrackingEnabled ? 'var(--text-primary)' : 'var(--text-muted)' }}>
                    Capture Active Window Titles
                  </strong>
                  <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: '2px 0 0 0' }}>
                    Includes foreground window titles in local logs for IDE workspace contextualization.
                  </p>
                  <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontStyle: 'italic' }}>
                    {preferences.activityTrackingEnabled ? 'Privacy Default: Disabled.' : 'Requires Computer Activity Tracking enabled.'}
                  </span>
                </div>
                <ToggleSwitch
                  id="pref-window-titles"
                  label="Capture Active Window Titles"
                  checked={preferences.trackingIncludeWindowTitles}
                  disabled={!preferences.activityTrackingEnabled || preferencesSaving}
                  onChange={(checked) => handleUpdatePreference({ trackingIncludeWindowTitles: checked })}
                />
              </div>

              {/* 3. tracking_include_process_names */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: '12px', borderTop: '1px solid var(--border-subtle)' }}>
                <div style={{ paddingRight: '12px' }}>
                  <strong style={{ fontSize: '13.5px', color: preferences.activityTrackingEnabled ? 'var(--text-primary)' : 'var(--text-muted)' }}>
                    Capture Running Process Names
                  </strong>
                  <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: '2px 0 0 0' }}>
                    Records executable names (e.g. code.exe, windsurf.exe) for tool detection.
                  </p>
                  <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontStyle: 'italic' }}>
                    {preferences.activityTrackingEnabled ? 'Privacy Default: Disabled.' : 'Requires Computer Activity Tracking enabled.'}
                  </span>
                </div>
                <ToggleSwitch
                  id="pref-process-names"
                  label="Capture Running Process Names"
                  checked={preferences.trackingIncludeProcessNames}
                  disabled={!preferences.activityTrackingEnabled || preferencesSaving}
                  onChange={(checked) => handleUpdatePreference({ trackingIncludeProcessNames: checked })}
                />
              </div>

              {/* 4. idle_threshold_seconds */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: '12px', borderTop: '1px solid var(--border-subtle)' }}>
                <div style={{ paddingRight: '12px' }}>
                  <strong style={{ fontSize: '13.5px', color: 'var(--text-primary)' }}>Idle Detection Threshold</strong>
                  <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: '2px 0 0 0' }}>
                    Inactivity duration before Kuro marks a session as idle.
                  </p>
                </div>
                <select
                  id="pref-idle-threshold"
                  aria-label="Idle Detection Threshold"
                  value={preferences.idleThresholdSeconds}
                  disabled={preferencesSaving}
                  onChange={(e) => handleUpdatePreference({ idleThresholdSeconds: Number(e.target.value) })}
                  style={{
                    padding: '6px 10px',
                    background: 'var(--bg-input)',
                    border: '1px solid var(--border-subtle)',
                    borderRadius: 'var(--radius-sm)',
                    color: 'var(--text-primary)',
                    fontSize: '12.5px',
                    cursor: preferencesSaving ? 'not-allowed' : 'pointer',
                  }}
                >
                  <option value={60}>60s (1 min)</option>
                  <option value={180}>180s (3 mins)</option>
                  <option value={300}>300s (5 mins - Default)</option>
                  <option value={600}>600s (10 mins)</option>
                  <option value={900}>900s (15 mins)</option>
                </select>
              </div>

              {/* 5. telemetry_retention_days */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: '12px', borderTop: '1px solid var(--border-subtle)' }}>
                <div style={{ paddingRight: '12px' }}>
                  <strong style={{ fontSize: '13.5px', color: 'var(--text-primary)' }}>Telemetry Retention Window</strong>
                  <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: '2px 0 0 0' }}>
                    Period before historical computer activity records are automatically purged.
                  </p>
                </div>
                <select
                  id="pref-telemetry-retention"
                  aria-label="Telemetry Retention Window"
                  value={preferences.telemetryRetentionDays}
                  disabled={preferencesSaving}
                  onChange={(e) => handleUpdatePreference({ telemetryRetentionDays: Number(e.target.value) })}
                  style={{
                    padding: '6px 10px',
                    background: 'var(--bg-input)',
                    border: '1px solid var(--border-subtle)',
                    borderRadius: 'var(--radius-sm)',
                    color: 'var(--text-primary)',
                    fontSize: '12.5px',
                    cursor: preferencesSaving ? 'not-allowed' : 'pointer',
                  }}
                >
                  <option value={7}>7 days (Minimal)</option>
                  <option value={14}>14 days (2 weeks)</option>
                  <option value={30}>30 days (Standard Default)</option>
                  <option value={60}>60 days (2 months)</option>
                  <option value={90}>90 days (Quarterly)</option>
                </select>
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
                  <div style={{ fontSize: '11.5px', color: 'var(--text-muted)' }}>Provider-independent architecture (Local Ollama active)</div>
                </div>
                <span className="badge badge-active">Active (Ollama)</span>
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
