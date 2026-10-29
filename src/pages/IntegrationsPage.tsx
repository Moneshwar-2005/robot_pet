import React, { useState } from 'react';
import type { PageId, Reminder, Task } from '../types';
import type { ClientWorkSession } from '../lib/adapters';
import { useDesktopCompanion } from '../hooks/useDesktopCompanion';
import { useReminderNotifications } from '../hooks/useReminderNotifications';
import { useAutomation } from '../hooks/useAutomation';
import {
  generateMarkdownDailyReport,
  generateICalendarReminders,
  downloadTextBlob,
} from '../lib/integrations/exportHelpers';
import { formatLocalDateString } from '../lib/formatters';
import {
  Monitor,
  Bell,
  Zap,
  FileText,
  Calendar,
  Download,
  CheckCircle2,
  AlertTriangle,
  Clock,
  Bot,
  Home,
  Music,
  Info,
  ChevronRight,
  ShieldCheck,
  Sparkles,
  Cloud,
} from 'lucide-react';

export interface IntegrationsPageProps {
  reminders?: Reminder[];
  tasks?: Task[];
  sessions?: ClientWorkSession[];
  onNavigate?: (page: PageId) => void;
}

interface IntegrationDetail {
  id: string;
  name: string;
  category: string;
  status: 'connected' | 'configured' | 'unavailable' | 'planned';
  statusLabel: string;
  description: string;
  setupPrerequisites: string[];
  privacyNotes: string;
}

export const IntegrationsPage: React.FC<IntegrationsPageProps> = ({
  reminders = [],
  tasks = [],
  sessions = [],
  onNavigate,
}) => {
  const { connectionState, activeSession } = useDesktopCompanion();
  const { permission, isSupported, requestPermission, testNotification } = useReminderNotifications(reminders);
  const { globalEnabled, rules } = useAutomation();

  const [selectedDetail, setSelectedDetail] = useState<IntegrationDetail | null>(null);
  const [exportMessage, setExportMessage] = useState<string | null>(null);

  // Companion status derivation
  const companionStatus: 'connected' | 'configured' | 'unavailable' =
    connectionState === 'running_paired'
      ? 'connected'
      : connectionState === 'running_unpaired'
      ? 'configured'
      : 'unavailable';

  const companionStatusLabel =
    connectionState === 'running_paired'
      ? activeSession
        ? `Connected (${activeSession.ideName})`
        : 'Connected (Loopback Paired)'
      : connectionState === 'running_unpaired'
      ? 'Configured (Pairing Required)'
      : 'Unavailable (Service Stopped)';

  // Notification status derivation
  const notificationStatus: 'connected' | 'configured' | 'unavailable' =
    permission === 'granted'
      ? 'connected'
      : permission === 'default'
      ? 'configured'
      : 'unavailable';

  const notificationStatusLabel =
    permission === 'granted'
      ? 'Connected (Permission Active)'
      : permission === 'default'
      ? 'Configured (Permission Pending)'
      : permission === 'denied'
      ? 'Unavailable (Blocked by Browser)'
      : 'Unavailable (Browser Unsupported)';

  // Automation status derivation
  const automationStatus: 'connected' | 'configured' = globalEnabled ? 'connected' : 'configured';
  const enabledRulesCount = rules.filter((r) => r.enabled).length;
  const automationStatusLabel = globalEnabled
    ? `Connected (${enabledRulesCount}/${rules.length} Routines Active)`
    : 'Configured (Automation Paused)';

  const handleExportMarkdown = () => {
    const todayStr = formatLocalDateString();
    const md = generateMarkdownDailyReport(todayStr, sessions, tasks);
    downloadTextBlob(`kuro-daily-report-${todayStr}.md`, md, 'text/markdown;charset=utf-8');
    setExportMessage(`Exported daily summary to kuro-daily-report-${todayStr}.md`);
    setTimeout(() => setExportMessage(null), 4000);
  };

  const handleExportICal = () => {
    const todayStr = formatLocalDateString();
    const ics = generateICalendarReminders(reminders);
    downloadTextBlob(`kuro-reminders-${todayStr}.ics`, ics, 'text/calendar;charset=utf-8');
    setExportMessage(`Exported ${reminders.length} scheduled reminders to kuro-reminders-${todayStr}.ics`);
    setTimeout(() => setExportMessage(null), 4000);
  };

  const handleEnableNotifications = async () => {
    const res = await requestPermission();
    if (res === 'granted') {
      testNotification();
      setExportMessage('Browser notifications enabled! Test notification sent.');
    } else if (res === 'denied') {
      setExportMessage('Notifications blocked in browser site settings.');
    }
    setTimeout(() => setExportMessage(null), 4000);
  };

  const renderBadge = (status: 'connected' | 'configured' | 'unavailable' | 'planned', label: string) => {
    switch (status) {
      case 'connected':
        return (
          <span className="badge badge-active" style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
            <CheckCircle2 size={11} /> {label}
          </span>
        );
      case 'configured':
        return (
          <span className="badge badge-warning" style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
            <AlertTriangle size={11} /> {label}
          </span>
        );
      case 'unavailable':
        return (
          <span className="badge" style={{ backgroundColor: 'var(--bg-card-subtle)', color: 'var(--text-muted)', border: '1px solid var(--border-subtle)', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
            <Clock size={11} /> {label}
          </span>
        );
      case 'planned':
      default:
        return (
          <span className="badge badge-neutral" style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
            <Clock size={11} /> {label}
          </span>
        );
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {/* Page Header */}
      <div className="card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h2 style={{ fontSize: '18px', fontWeight: 600, margin: '0 0 4px 0', color: 'var(--text-primary)' }}>
            Integrations &amp; Bridges
          </h2>
          <p style={{ fontSize: '13px', color: 'var(--text-muted)', margin: 0 }}>
            Connect local desktop services, browser capabilities, note vaults, and external tools safely.
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', color: 'var(--text-secondary)' }}>
          <ShieldCheck size={16} style={{ color: 'var(--status-green)' }} />
          <span>Local-first architecture: No external data leakage</span>
        </div>
      </div>

      {exportMessage && (
        <div
          className="card"
          style={{
            backgroundColor: 'rgba(34, 197, 94, 0.1)',
            border: '1px solid var(--status-green)',
            color: 'var(--status-green)',
            fontSize: '13px',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
          }}
        >
          <CheckCircle2 size={16} />
          <span>{exportMessage}</span>
        </div>
      )}

      {/* Grid of All Integrations */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: '20px' }}>
        {/* 1. Windows Desktop Companion */}
        <div className="card" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '12px' }}>
              <div className="brand-icon-wrap" style={{ width: '42px', height: '42px', backgroundColor: 'rgba(99, 102, 241, 0.12)' }}>
                <Monitor size={22} style={{ color: 'var(--accent-primary)' }} />
              </div>
              {renderBadge(companionStatus, companionStatusLabel)}
            </div>

            <h3 style={{ fontSize: '15px', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '4px' }}>
              Windows Desktop Companion
            </h3>
            <span style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'block', marginBottom: '8px' }}>
              Local Loopback Service (127.0.0.1:48199)
            </span>
            <p style={{ fontSize: '12.5px', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
              Detects active IDE workspace titles (Antigravity, VS Code, Visual Studio, Cursor) and records focus intervals without collecting code, keystrokes, or telemetry.
            </p>
          </div>

          <div style={{ marginTop: '16px', paddingTop: '12px', borderTop: '1px solid var(--border-subtle)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <button
              type="button"
              className="btn btn-secondary"
              style={{ fontSize: '11px', padding: '4px 10px' }}
              onClick={() =>
                setSelectedDetail({
                  id: 'companion',
                  name: 'Windows Desktop Companion',
                  category: 'Local Service',
                  status: companionStatus,
                  statusLabel: companionStatusLabel,
                  description:
                    'Runs locally on Windows (Node.js or Python) and binds strictly to 127.0.0.1. Communicates via Bearer session token authentication.',
                  setupPrerequisites: [
                    'Run companion/start-companion.bat on your Windows PC.',
                    'Copy the 32-character pairing token displayed in the console.',
                    'Paste token into Settings -> Desktop Companion to establish trusted bridge.',
                  ],
                  privacyNotes:
                    'Zero telemetry. Process names and safe window title project labels are stored in local .sessions_history.json. Zero network egress.',
                })
              }
            >
              Protocol Spec
            </button>
            {onNavigate && (
              <button
                type="button"
                className="btn btn-primary"
                style={{ fontSize: '11px', padding: '4px 10px' }}
                onClick={() => onNavigate('settings')}
              >
                Configure <ChevronRight size={12} style={{ marginLeft: '2px' }} />
              </button>
            )}
          </div>
        </div>

        {/* 2. Web Notifications & Alarms */}
        <div className="card" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '12px' }}>
              <div className="brand-icon-wrap" style={{ width: '42px', height: '42px', backgroundColor: 'rgba(234, 179, 8, 0.12)' }}>
                <Bell size={22} style={{ color: 'var(--status-amber)' }} />
              </div>
              {renderBadge(notificationStatus, notificationStatusLabel)}
            </div>

            <h3 style={{ fontSize: '15px', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '4px' }}>
              Browser Reminders &amp; Web Alarms
            </h3>
            <span style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'block', marginBottom: '8px' }}>
              Native Web Notification API
            </span>
            <p style={{ fontSize: '12.5px', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
              Delivers timely alerts for scheduled reminders, hydration prompts, and posture check-ins. Runs completely client-side without cloud AI.
            </p>
          </div>

          <div style={{ marginTop: '16px', paddingTop: '12px', borderTop: '1px solid var(--border-subtle)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <button
              type="button"
              className="btn btn-secondary"
              style={{ fontSize: '11px', padding: '4px 10px' }}
              onClick={testNotification}
            >
              Test Alert
            </button>
            {permission !== 'granted' && isSupported ? (
              <button
                type="button"
                className="btn btn-primary"
                style={{ fontSize: '11px', padding: '4px 10px' }}
                onClick={handleEnableNotifications}
              >
                Enable Notifications
              </button>
            ) : (
              <span style={{ fontSize: '11px', color: 'var(--status-green)' }}>Active &amp; Ready</span>
            )}
          </div>
        </div>

        {/* 3. Safe Automation & Routines Engine */}
        <div className="card" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '12px' }}>
              <div className="brand-icon-wrap" style={{ width: '42px', height: '42px', backgroundColor: 'rgba(16, 185, 129, 0.12)' }}>
                <Zap size={22} style={{ color: 'var(--status-green)' }} />
              </div>
              {renderBadge(automationStatus, automationStatusLabel)}
            </div>

            <h3 style={{ fontSize: '15px', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '4px' }}>
              Safe Automation &amp; Routines
            </h3>
            <span style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'block', marginBottom: '8px' }}>
              Local Deterministic Engine
            </span>
            <p style={{ fontSize: '12.5px', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
              Evaluates companion routines, hydration chimes, and debrief prompts safely. Data-modifying triggers strictly require your manual confirmation.
            </p>
          </div>

          <div style={{ marginTop: '16px', paddingTop: '12px', borderTop: '1px solid var(--border-subtle)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
              {enabledRulesCount} rules enabled
            </span>
            {onNavigate && (
              <button
                type="button"
                className="btn btn-secondary"
                style={{ fontSize: '11px', padding: '4px 10px' }}
                onClick={() => onNavigate('reminders')}
              >
                View Routines <ChevronRight size={12} style={{ marginLeft: '2px' }} />
              </button>
            )}
          </div>
        </div>

        {/* 4. Local Markdown Vault Export */}
        <div className="card" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '12px' }}>
              <div className="brand-icon-wrap" style={{ width: '42px', height: '42px', backgroundColor: 'rgba(6, 182, 212, 0.12)' }}>
                <FileText size={22} style={{ color: 'var(--accent-primary)' }} />
              </div>
              {renderBadge('connected', 'Connected (Local Export Ready)')}
            </div>

            <h3 style={{ fontSize: '15px', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '4px' }}>
              Obsidian / Local Markdown Vault
            </h3>
            <span style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'block', marginBottom: '8px' }}>
              Client-side Markdown Document Export
            </span>
            <p style={{ fontSize: '12.5px', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
              Export daily productivity logs, IDE focus sessions, and task completions as formatted Markdown (.md) documents ready to drop into Obsidian or Logseq.
            </p>
          </div>

          <div style={{ marginTop: '16px', paddingTop: '12px', borderTop: '1px solid var(--border-subtle)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Format: Standard .md</span>
            <button
              type="button"
              className="btn btn-primary"
              style={{ fontSize: '11px', padding: '4px 10px', display: 'inline-flex', alignItems: 'center', gap: '4px' }}
              onClick={handleExportMarkdown}
            >
              <Download size={12} /> Export Daily Report
            </button>
          </div>
        </div>

        {/* 5. iCalendar (.ics) Sync Export */}
        <div className="card" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '12px' }}>
              <div className="brand-icon-wrap" style={{ width: '42px', height: '42px', backgroundColor: 'rgba(168, 85, 247, 0.12)' }}>
                <Calendar size={22} style={{ color: 'var(--accent-secondary)' }} />
              </div>
              {renderBadge('connected', 'Connected (Local Export Ready)')}
            </div>

            <h3 style={{ fontSize: '15px', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '4px' }}>
              Calendar (.ics) Export
            </h3>
            <span style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'block', marginBottom: '8px' }}>
              Universal RFC 5545 Calendar File
            </span>
            <p style={{ fontSize: '12.5px', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
              Export scheduled check-ins, routine reminders, and meetings into standard iCalendar (.ics) format compatible with Apple Calendar, Google Calendar, and Outlook.
            </p>
          </div>

          <div style={{ marginTop: '16px', paddingTop: '12px', borderTop: '1px solid var(--border-subtle)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{reminders.length} items</span>
            <button
              type="button"
              className="btn btn-primary"
              style={{ fontSize: '11px', padding: '4px 10px', display: 'inline-flex', alignItems: 'center', gap: '4px' }}
              onClick={handleExportICal}
            >
              <Download size={12} /> Export Calendar (.ics)
            </button>
          </div>
        </div>

        {/* 6. Google Calendar (Planned / External) */}
        <div className="card" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between', opacity: 0.85 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '12px' }}>
              <div className="brand-icon-wrap" style={{ width: '42px', height: '42px' }}>
                <Calendar size={22} style={{ color: 'var(--text-muted)' }} />
              </div>
              {renderBadge('planned', 'Planned (Setup Required)')}
            </div>

            <h3 style={{ fontSize: '15px', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '4px' }}>
              Google Calendar Cloud Sync
            </h3>
            <span style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'block', marginBottom: '8px' }}>
              External Cloud Service
            </span>
            <p style={{ fontSize: '12.5px', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
              Bi-directional cloud synchronization for personal events and focus time blocking. Requires Google Cloud OAuth 2.0 configuration. Use the local .ics export above for offline calendar sync.
            </p>
          </div>

          <div style={{ marginTop: '16px', paddingTop: '12px', borderTop: '1px solid var(--border-subtle)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>OAuth 2.0 Client Required</span>
            <button
              type="button"
              className="btn btn-secondary"
              style={{ fontSize: '11px', padding: '4px 10px' }}
              onClick={() =>
                setSelectedDetail({
                  id: 'google-cal',
                  name: 'Google Calendar Cloud Sync',
                  category: 'Cloud Service',
                  status: 'planned',
                  statusLabel: 'Planned (Setup Required)',
                  description:
                    'Direct bi-directional synchronization with Google Calendar via the Google Calendar REST API v3.',
                  setupPrerequisites: [
                    'Register a Project in Google Cloud Console.',
                    'Enable Google Calendar API.',
                    'Create OAuth 2.0 Client ID for web origins.',
                    'Configure client ID in application environment secrets.',
                  ],
                  privacyNotes:
                    'Requires Google user consent. In this build, offline iCalendar (.ics) export is recommended to maintain zero cloud dependency.',
                })
              }
            >
              Setup Guidance
            </button>
          </div>
        </div>

        {/* 7. Home Assistant (Planned / Smart Home) */}
        <div className="card" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between', opacity: 0.85 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '12px' }}>
              <div className="brand-icon-wrap" style={{ width: '42px', height: '42px' }}>
                <Home size={22} style={{ color: 'var(--text-muted)' }} />
              </div>
              {renderBadge('planned', 'Planned (Setup Required)')}
            </div>

            <h3 style={{ fontSize: '15px', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '4px' }}>
              Home Assistant
            </h3>
            <span style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'block', marginBottom: '8px' }}>
              Local Smart Home Bridge
            </span>
            <p style={{ fontSize: '12.5px', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
              Control desk lighting and ambient mood triggers based on focus sessions and Kuro pet expressions.
            </p>
          </div>

          <div style={{ marginTop: '16px', paddingTop: '12px', borderTop: '1px solid var(--border-subtle)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>LAN Access Token Required</span>
            <button
              type="button"
              className="btn btn-secondary"
              style={{ fontSize: '11px', padding: '4px 10px' }}
              onClick={() =>
                setSelectedDetail({
                  id: 'home-assistant',
                  name: 'Home Assistant',
                  category: 'Smart Home',
                  status: 'planned',
                  statusLabel: 'Planned (Setup Required)',
                  description:
                    'Connects to your local Home Assistant instance via WebSocket / REST API to update ambient lights (e.g. red during focus, green during breaks).',
                  setupPrerequisites: [
                    'Local Home Assistant instance running on your LAN (e.g. http://homeassistant.local:8123).',
                    'Generate Long-Lived Access Token in Home Assistant profile.',
                    'Specify entity IDs for desk lights and indicator switches.',
                  ],
                  privacyNotes:
                    'All commands stay strictly on your local LAN. Zero external cloud relays required.',
                })
              }
            >
              Setup Guidance
            </button>
          </div>
        </div>

        {/* 8. YouTube Music & Visual Dance Party (Phase 7.5) */}
        <div className="card" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '12px' }}>
              <div className="brand-icon-wrap" style={{ width: '42px', height: '42px', backgroundColor: 'rgba(236, 72, 153, 0.12)' }}>
                <Music size={22} style={{ color: 'var(--accent-secondary)' }} />
              </div>
              {renderBadge('connected', 'Connected (Ready to Play)')}
            </div>

            <h3 style={{ fontSize: '15px', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '4px' }}>
              YouTube Music &amp; Visual Dance
            </h3>
            <span style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'block', marginBottom: '8px' }}>
              Interactive Music Reactive Companion
            </span>
            <p style={{ fontSize: '12.5px', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
              Stream focus and study tracks (Lofi Girl, Synthwave, Coffee Ambience) while Kuro reacts with real-time visual dance animations on screen. Screen-only animation, no physical servos or speakers required.
            </p>
          </div>

          <div style={{ marginTop: '16px', paddingTop: '12px', borderTop: '1px solid var(--border-subtle)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>4 Presets + Custom URL</span>
            {onNavigate && (
              <button
                type="button"
                className="btn btn-primary"
                style={{ fontSize: '11px', padding: '4px 10px', display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                onClick={() => onNavigate('activities')}
              >
                <Sparkles size={12} /> Open Dance Party
              </button>
            )}
          </div>
        </div>

        {/* 9. Optional Cloud AI Gateway (Gemini / OpenAI) */}
        <div className="card" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '12px' }}>
              <div className="brand-icon-wrap" style={{ width: '42px', height: '42px', backgroundColor: 'rgba(59, 130, 246, 0.12)' }}>
                <Cloud size={22} style={{ color: 'var(--accent-primary)' }} />
              </div>
              {renderBadge('configured', 'Configured (Opt-in Provider)')}
            </div>

            <h3 style={{ fontSize: '15px', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '4px' }}>
              Optional Cloud AI Gateway
            </h3>
            <span style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'block', marginBottom: '8px' }}>
              Google Gemini &amp; OpenAI API
            </span>
            <p style={{ fontSize: '12.5px', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
              Opt-in cloud intelligence gateway for systems without local GPU compute. Requires explicit privacy consent and your own API key.
            </p>
          </div>

          <div style={{ marginTop: '16px', paddingTop: '12px', borderTop: '1px solid var(--border-subtle)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Gemini 1.5 &amp; GPT-4o</span>
            {onNavigate && (
              <button
                type="button"
                className="btn btn-secondary"
                style={{ fontSize: '11px', padding: '4px 10px', display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                onClick={() => onNavigate('assistant')}
              >
                Configure Cloud AI <ChevronRight size={12} />
              </button>
            )}
          </div>
        </div>

        {/* 10. Spotify (Planned / Media) */}
        <div className="card" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between', opacity: 0.85 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '12px' }}>
              <div className="brand-icon-wrap" style={{ width: '42px', height: '42px' }}>
                <Music size={22} style={{ color: 'var(--text-muted)' }} />
              </div>
              {renderBadge('planned', 'Planned (Setup Required)')}
            </div>

            <h3 style={{ fontSize: '15px', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '4px' }}>
              Spotify Audio
            </h3>
            <span style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'block', marginBottom: '8px' }}>
              Media &amp; Ambience
            </span>
            <p style={{ fontSize: '12.5px', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
              Trigger lofi focus playlists when Kuro enters Focus Companion mode. Requires Spotify Developer account credentials.
            </p>
          </div>

          <div style={{ marginTop: '16px', paddingTop: '12px', borderTop: '1px solid var(--border-subtle)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Developer Client ID Required</span>
            <button
              type="button"
              className="btn btn-secondary"
              style={{ fontSize: '11px', padding: '4px 10px' }}
              onClick={() =>
                setSelectedDetail({
                  id: 'spotify',
                  name: 'Spotify Audio',
                  category: 'Media & Ambience',
                  status: 'planned',
                  statusLabel: 'Planned (Setup Required)',
                  description:
                    'Controls Spotify Web Playback SDK to play designated focus playlists when Pomodoro or focus sessions begin.',
                  setupPrerequisites: [
                    'Spotify Premium subscription.',
                    'Spotify Developer account and registered Client ID.',
                    'Configured OAuth redirect URI for Kuro domain.',
                  ],
                  privacyNotes:
                    'Requires Spotify account authorization. Ambient audio remains local.',
                })
              }
            >
              Setup Guidance
            </button>
          </div>
        </div>

        {/* 9. Kuro Physical Robot (ESP32) */}
        <div className="card" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between', opacity: 0.85 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '12px' }}>
              <div className="brand-icon-wrap" style={{ width: '42px', height: '42px' }}>
                <Bot size={22} style={{ color: 'var(--text-muted)' }} />
              </div>
              {renderBadge('planned', 'Planned (Hardware Radios Inactive)')}
            </div>

            <h3 style={{ fontSize: '15px', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '4px' }}>
              Kuro Physical Robot (ESP32)
            </h3>
            <span style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'block', marginBottom: '8px' }}>
              Hardware Companion (Phase 6)
            </span>
            <p style={{ fontSize: '12.5px', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
              Bi-directional local Wi-Fi protocol for 2.4-inch TFT LCD screen expressions and visual speech text. In accordance with current phase guidelines, physical hardware implementation is deferred (screen-only companion, no motors, no speakers).
            </p>
          </div>

          <div style={{ marginTop: '16px', paddingTop: '12px', borderTop: '1px solid var(--border-subtle)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Phase 7 Hardware Target</span>
            <button
              type="button"
              className="btn btn-secondary"
              style={{ fontSize: '11px', padding: '4px 10px' }}
              onClick={() =>
                setSelectedDetail({
                  id: 'esp32',
                  name: 'Kuro Physical Robot (ESP32)',
                  category: 'Hardware',
                  status: 'planned',
                  statusLabel: 'Planned (Phase 7)',
                  description:
                    'Fixed box-shaped companion enclosure with ESP32 microcontroller, rear USB-C connector, and 2.4-inch TFT LCD (320x240 SPI) for facial expressions and visual speech (screen-only, no motors, no speakers).',
                  setupPrerequisites: [
                    'ESP32 microcontroller flashed with Kuro firmware.',
                    'Local Wi-Fi / WebSocket serial bridge enabled.',
                    'Phase 7 Hardware implementation milestone.',
                  ],
                  privacyNotes:
                    'Zero microphones or cameras on hardware. Radios operate on local peer-to-peer Bluetooth / WiFi only.',
                })
              }
            >
              Hardware Spec
            </button>
          </div>
        </div>
      </div>

      {/* Details & Setup Modal */}
      {selectedDetail && (
        <div
          className="card"
          style={{
            backgroundColor: 'var(--bg-card)',
            border: '1px solid var(--border-strong)',
            display: 'flex',
            flexDirection: 'column',
            gap: '12px',
          }}
        >
          <div className="card-header" style={{ paddingBottom: '8px', borderBottom: '1px solid var(--border-subtle)' }}>
            <div>
              <h3 className="card-title" style={{ fontSize: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Info size={16} style={{ color: 'var(--accent-primary)' }} />
                {selectedDetail.name} — Architecture &amp; Setup Details
              </h3>
              <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                Category: {selectedDetail.category} | Status: {selectedDetail.statusLabel}
              </span>
            </div>
            <button
              type="button"
              className="btn btn-secondary"
              style={{ padding: '4px 10px', fontSize: '11px' }}
              onClick={() => setSelectedDetail(null)}
            >
              Close
            </button>
          </div>

          <p style={{ fontSize: '13px', color: 'var(--text-secondary)', lineHeight: 1.5, margin: 0 }}>
            {selectedDetail.description}
          </p>

          <div>
            <h4 style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '6px' }}>
              Required Setup &amp; Prerequisites:
            </h4>
            <ul style={{ margin: 0, paddingLeft: '18px', fontSize: '12.5px', color: 'var(--text-secondary)', lineHeight: 1.6 }}>
              {selectedDetail.setupPrerequisites.map((p, idx) => (
                <li key={idx}>{p}</li>
              ))}
            </ul>
          </div>

          <div
            style={{
              padding: '10px 12px',
              backgroundColor: 'var(--bg-card-subtle)',
              borderRadius: 'var(--radius-sm)',
              border: '1px solid var(--border-subtle)',
              fontSize: '12px',
              color: 'var(--text-secondary)',
            }}
          >
            <strong style={{ color: 'var(--text-primary)' }}>Privacy &amp; Security: </strong>
            {selectedDetail.privacyNotes}
          </div>
        </div>
      )}
    </div>
  );
};
