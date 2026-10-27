import React, { useState } from 'react';
import type { PageId, PetMood, Reminder } from '../types';
import { PlannedFeatureNotice } from '../components/common/PlannedFeatureNotice';
import { formatReminderDisplay, formatLocalDateString } from '../lib/formatters';
import { useReminderNotifications } from '../hooks/useReminderNotifications';
import { useAutomation } from '../hooks/useAutomation';
import {
  CalendarClock,
  Plus,
  Check,
  Heart,
  Coffee,
  Users,
  Bell,
  BellRing,
  AlertCircle,
  Trash2,
  RefreshCw,
  Loader2,
  Zap,
  Play,
  ShieldCheck,
  X,
} from 'lucide-react';

interface RemindersPageProps {
  reminders: Reminder[];
  loading?: boolean;
  error?: string | null;
  onToggleReminder: (reminderId: string) => void;
  onAddReminder: (newReminder: Omit<Reminder, 'id'>) => void;
  onDeleteReminder?: (reminderId: string) => void;
  onRetry?: () => void;
  focusMinutesToday?: number;
  onSetPetMood?: (mood: PetMood) => void;
  onNavigate?: (page: PageId) => void;
}

export const RemindersPage: React.FC<RemindersPageProps> = ({
  reminders,
  loading = false,
  error = null,
  onToggleReminder,
  onAddReminder,
  onDeleteReminder,
  onRetry,
  focusMinutesToday = 0,
  onSetPetMood,
  onNavigate,
}) => {
  const [showAdd, setShowAdd] = useState(false);
  const [title, setTitle] = useState('');
  const [date, setDate] = useState(() => formatLocalDateString());
  const [time, setTime] = useState('17:30');
  const [type, setType] = useState<Reminder['type']>('wellness');
  const [priority, setPriority] = useState<Reminder['priority']>('normal');
  const [notificationMsg, setNotificationMsg] = useState<string | null>(null);

  const { permission, isSupported, requestPermission, testNotification } = useReminderNotifications(
    reminders,
    onToggleReminder
  );

  const {
    globalEnabled: autoEnabled,
    setGlobalEnabled: setAutoEnabled,
    rules: autoRules,
    toggleRule: toggleAutoRule,
    pendingConfirmations,
    confirmAction,
    cancelAction,
    triggerManual,
  } = useAutomation({
    focusMinutesToday,
    onAddReminder,
    onSetPetMood,
    onNavigate,
  });

  const handleRequestPermission = async () => {
    const res = await requestPermission();
    if (res === 'granted') {
      testNotification();
      setNotificationMsg('Browser notifications active! Test alert dispatched.');
    } else if (res === 'denied') {
      setNotificationMsg('Notifications blocked in browser. Using in-app alert cards.');
    }
    setTimeout(() => setNotificationMsg(null), 4000);
  };

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;

    let remindAtISO: string;
    try {
      const parsedDate = new Date(`${date}T${time}:00`);
      remindAtISO = isNaN(parsedDate.getTime()) ? new Date().toISOString() : parsedDate.toISOString();
    } catch {
      remindAtISO = new Date().toISOString();
    }

    onAddReminder({
      title: title.trim(),
      time: remindAtISO,
      type,
      priority,
      done: false,
    });

    setTitle('');
    setShowAdd(false);
  };

  const getReminderIcon = (reminderType: Reminder['type']) => {
    switch (reminderType) {
      case 'wellness':
        return <div className="reminder-icon-wrap reminder-wellness"><Heart size={14} /></div>;
      case 'pet-routine':
        return <div className="reminder-icon-wrap reminder-routine"><Coffee size={14} /></div>;
      case 'meeting':
        return <div className="reminder-icon-wrap reminder-meeting"><Users size={14} /></div>;
      case 'task':
      default:
        return <div className="reminder-icon-wrap reminder-task"><Bell size={14} /></div>;
    }
  };

  const renderSyncBadge = (syncStatus?: Reminder['syncStatus']) => {
    if (!syncStatus || syncStatus === 'local-only') {
      return (
        <span
          className="badge"
          style={{
            fontSize: '10px',
            padding: '1px 6px',
            backgroundColor: 'var(--bg-card-subtle)',
            color: 'var(--text-muted)',
            border: '1px solid var(--border-subtle)',
          }}
          title="Saved locally on this device (Local Companion Mode)"
        >
          Device Only
        </span>
      );
    }
    if (syncStatus === 'pending-sync') {
      return (
        <span
          className="badge"
          style={{
            fontSize: '10px',
            padding: '1px 6px',
            backgroundColor: 'rgba(234, 179, 8, 0.15)',
            color: 'var(--status-yellow)',
            border: '1px solid rgba(234, 179, 8, 0.35)',
          }}
          title="Saved locally on this device. Waiting to synchronize with Supabase."
        >
          Waiting to sync
        </span>
      );
    }
    if (syncStatus === 'synced') {
      return (
        <span
          className="badge"
          style={{
            fontSize: '10px',
            padding: '1px 6px',
            backgroundColor: 'rgba(34, 197, 94, 0.12)',
            color: 'var(--status-green)',
            border: '1px solid rgba(34, 197, 94, 0.35)',
          }}
          title="Synchronized and persisted in Supabase database."
        >
          Synced
        </span>
      );
    }
    if (syncStatus === 'sync-error') {
      return (
        <span
          className="badge"
          style={{
            fontSize: '10px',
            padding: '1px 6px',
            backgroundColor: 'rgba(239, 68, 68, 0.15)',
            color: 'var(--status-red)',
            border: '1px solid rgba(239, 68, 68, 0.35)',
          }}
          title="Synchronization error. Will retry when connection is restored."
        >
          Sync Error
        </span>
      );
    }
    return null;
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <PlannedFeatureNotice
        phase="Phase 5: Reminders, Browser Notifications &amp; Safe Automation"
        title="Reminders &amp; User-Controlled Routines"
        description="Schedule reminders, enable browser alerts, and manage user-controlled companion routines. All operations execute strictly on your device without cloud AI."
      />

      {/* Browser Notification Bar */}
      <div
        className="card"
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '10px',
          padding: '12px 16px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div
            className="brand-icon-wrap"
            style={{
              width: '34px',
              height: '34px',
              backgroundColor: permission === 'granted' ? 'rgba(34, 197, 94, 0.15)' : 'rgba(234, 179, 8, 0.15)',
            }}
          >
            {permission === 'granted' ? (
              <BellRing size={16} style={{ color: 'var(--status-green)' }} />
            ) : (
              <Bell size={16} style={{ color: 'var(--status-amber)' }} />
            )}
          </div>
          <div>
            <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>
              {permission === 'granted'
                ? 'Browser Notifications Active'
                : permission === 'denied'
                ? 'Browser Notifications Blocked'
                : 'Browser Notifications Not Enabled'}
            </div>
            <div style={{ fontSize: '11.5px', color: 'var(--text-muted)' }}>
              {permission === 'granted'
                ? 'Desktop chimes and alerts will trigger when scheduled reminders are due.'
                : permission === 'denied'
                ? 'Notifications are blocked in your browser. Reminders will show as in-app cards.'
                : 'Click enable to receive desktop alerts for scheduled check-ins and hydration prompts.'}
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {permission !== 'granted' && isSupported ? (
            <button
              type="button"
              className="btn btn-primary"
              style={{ fontSize: '11px', padding: '5px 12px' }}
              onClick={handleRequestPermission}
            >
              Enable Notifications
            </button>
          ) : (
            <button
              type="button"
              className="btn btn-secondary"
              style={{ fontSize: '11px', padding: '5px 10px' }}
              onClick={testNotification}
            >
              Test Alert
            </button>
          )}
        </div>
      </div>

      {notificationMsg && (
        <div
          className="card"
          style={{
            backgroundColor: 'rgba(99, 102, 241, 0.1)',
            border: '1px solid var(--accent-primary)',
            color: 'var(--accent-primary)',
            fontSize: '12.5px',
            padding: '8px 12px',
          }}
        >
          {notificationMsg}
        </div>
      )}

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

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2 style={{ fontSize: '18px', fontWeight: 600 }}>Scheduled Reminders &amp; Routines</h2>
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => setShowAdd(!showAdd)}
        >
          <Plus size={15} />
          <span>Add Reminder</span>
        </button>
      </div>

      {showAdd && (
        <form
          onSubmit={handleCreate}
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '10px',
            padding: '16px',
            backgroundColor: 'var(--bg-card)',
            border: '1px solid var(--accent-border)',
            borderRadius: 'var(--radius-md)',
          }}
        >
          <input
            type="text"
            placeholder="Reminder text (e.g., Eye relief exercise)..."
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            autoFocus
            style={{
              padding: '8px 12px',
              background: 'var(--bg-input)',
              border: '1px solid var(--border-subtle)',
              borderRadius: 'var(--radius-sm)',
              color: 'var(--text-primary)',
            }}
          />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '10px' }}>
            <div>
              <label style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'block', marginBottom: '3px' }}>
                Date
              </label>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
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
              <label style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'block', marginBottom: '3px' }}>
                Time
              </label>
              <input
                type="time"
                value={time}
                onChange={(e) => setTime(e.target.value)}
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
              <label style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'block', marginBottom: '3px' }}>
                Category
              </label>
              <select
                value={type}
                onChange={(e) => setType(e.target.value as Reminder['type'])}
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  background: 'var(--bg-input)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: 'var(--radius-sm)',
                  color: 'var(--text-primary)',
                  fontSize: '13px',
                }}
              >
                <option value="wellness">Wellness Alert</option>
                <option value="pet-routine">Pet Routine</option>
                <option value="task">Task Reminder</option>
                <option value="meeting">Meeting Sync</option>
              </select>
            </div>
            <div>
              <label style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'block', marginBottom: '3px' }}>
                Priority
              </label>
              <select
                value={priority}
                onChange={(e) => setPriority(e.target.value as Reminder['priority'])}
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  background: 'var(--bg-input)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: 'var(--radius-sm)',
                  color: 'var(--text-primary)',
                  fontSize: '13px',
                }}
              >
                <option value="normal">Normal</option>
                <option value="important">Important</option>
              </select>
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '6px' }}>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setShowAdd(false)}
            >
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={!title.trim()}>
              Save Reminder
            </button>
          </div>
        </form>
      )}

      <div className="dashboard-grid">
        <div className="col-8">
          <div className="card">
            <div className="card-header">
              <div className="card-title-group">
                <CalendarClock className="card-icon" />
                <h3 className="card-title">Today's Agenda &amp; Check-ins</h3>
              </div>
              <span className="badge badge-neutral">{reminders.length} scheduled</span>
            </div>

            {loading ? (
              <div className="empty-state">
                <Loader2 className="empty-state-icon" style={{ animation: 'spin 1s linear infinite' }} />
                <div className="empty-state-title">Loading reminders...</div>
                <p className="empty-state-desc">Fetching scheduled reminders from your database.</p>
              </div>
            ) : reminders.length === 0 ? (
              <div className="empty-state">
                <CalendarClock className="empty-state-icon" />
                <div className="empty-state-title">No reminders scheduled</div>
                <p className="empty-state-desc">Click "Add Reminder" above to create alerts, routines, and check-ins.</p>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {reminders.map((r) => (
                  <div key={r.id} className="reminder-item" style={{ opacity: r.done ? 0.6 : 1 }}>
                    <div className="reminder-left">
                      {getReminderIcon(r.type)}
                      <div>
                        <div className="reminder-title" style={{ textDecoration: r.done ? 'line-through' : undefined }}>
                          {r.title}
                        </div>
                        <div className="reminder-time" style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                          <span>{formatReminderDisplay(r.time)}</span>
                          <span>•</span>
                          <span style={{ textTransform: 'capitalize' }}>{r.type.replace('-', ' ')}</span>
                          {r.priority === 'important' && (
                            <span style={{ color: 'var(--status-amber)', fontWeight: 600 }}>• Important</span>
                          )}
                          {renderSyncBadge(r.syncStatus)}
                        </div>
                      </div>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <button
                        type="button"
                        className="reminder-action-btn"
                        onClick={() => onToggleReminder(r.id)}
                        title={r.done ? 'Mark active' : 'Mark acknowledged'}
                      >
                        <Check size={13} />
                        <span>{r.done ? 'Restore' : 'Acknowledge'}</span>
                      </button>
                      {onDeleteReminder && (
                        <button
                          type="button"
                          className="reminder-action-btn"
                          onClick={() => onDeleteReminder(r.id)}
                          title="Delete reminder"
                          style={{ color: 'var(--status-red)' }}
                        >
                          <Trash2 size={13} />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="col-4" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {/* Pending Confirmations for Data Modification Actions */}
          {pendingConfirmations.length > 0 && (
            <div
              className="card"
              style={{
                border: '1px solid var(--accent-primary)',
                backgroundColor: 'rgba(99, 102, 241, 0.08)',
                display: 'flex',
                flexDirection: 'column',
                gap: '10px',
              }}
            >
              <div className="card-header" style={{ paddingBottom: '6px' }}>
                <h3 className="card-title" style={{ fontSize: '13px', color: 'var(--accent-primary)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <Zap size={14} /> Action Confirmation Required
                </h3>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {pendingConfirmations.map((conf) => (
                  <div
                    key={conf.id}
                    style={{
                      fontSize: '12px',
                      padding: '10px',
                      backgroundColor: 'var(--bg-card)',
                      borderRadius: 'var(--radius-sm)',
                      border: '1px solid var(--border-subtle)',
                    }}
                  >
                    <p style={{ margin: '0 0 8px 0', color: 'var(--text-primary)', lineHeight: 1.4 }}>
                      {conf.message}
                    </p>
                    <div style={{ display: 'flex', gap: '6px', justifyContent: 'flex-end' }}>
                      <button
                        type="button"
                        className="btn btn-secondary"
                        style={{ fontSize: '11px', padding: '3px 8px' }}
                        onClick={() => cancelAction(conf.id)}
                      >
                        <X size={11} style={{ marginRight: '3px' }} /> Cancel
                      </button>
                      <button
                        type="button"
                        className="btn btn-primary"
                        style={{ fontSize: '11px', padding: '3px 8px' }}
                        onClick={() => void confirmAction(conf.id)}
                      >
                        <Check size={11} style={{ marginRight: '3px' }} /> Confirm Action
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Interactive Companion Routines */}
          <div className="card">
            <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <Zap size={16} style={{ color: 'var(--accent-primary)' }} />
                <h3 className="card-title" style={{ fontSize: '14px' }}>Companion Routines</h3>
              </div>
              <button
                type="button"
                className={`btn ${autoEnabled ? 'btn-secondary' : 'btn-primary'}`}
                style={{ fontSize: '10px', padding: '2px 8px' }}
                onClick={() => setAutoEnabled(!autoEnabled)}
                title="Toggle all automation routines"
              >
                {autoEnabled ? 'Automation: ON' : 'Automation: OFF'}
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', fontSize: '13px' }}>
              {autoRules.map((rule) => {
                const getRuleIcon = () => {
                  if (rule.id.includes('hydration')) return <Coffee size={15} style={{ color: 'var(--accent-primary)' }} />;
                  if (rule.id.includes('posture')) return <Heart size={15} style={{ color: 'var(--status-green)' }} />;
                  if (rule.id.includes('debrief')) return <CalendarClock size={15} style={{ color: 'var(--status-amber)' }} />;
                  return <Zap size={15} style={{ color: 'var(--accent-secondary)' }} />;
                };

                return (
                  <div
                    key={rule.id}
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '4px',
                      padding: '8px 10px',
                      backgroundColor: rule.enabled && autoEnabled ? 'var(--bg-card-subtle)' : 'transparent',
                      borderRadius: 'var(--radius-sm)',
                      border: '1px solid var(--border-subtle)',
                      opacity: autoEnabled && rule.enabled ? 1 : 0.6,
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '6px' }}>
                      <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-start' }}>
                        <div style={{ marginTop: '2px' }}>{getRuleIcon()}</div>
                        <div>
                          <strong style={{ fontSize: '12.5px', color: 'var(--text-primary)' }}>{rule.name}</strong>
                          <p style={{ fontSize: '11.5px', color: 'var(--text-muted)', margin: '2px 0 0 0', lineHeight: 1.3 }}>
                            {rule.description}
                          </p>
                        </div>
                      </div>
                      <input
                        type="checkbox"
                        checked={rule.enabled}
                        onChange={() => toggleAutoRule(rule.id)}
                        disabled={!autoEnabled}
                        title={rule.enabled ? 'Disable routine' : 'Enable routine'}
                        style={{ cursor: 'pointer', marginTop: '3px' }}
                      />
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '4px', fontSize: '10.5px', color: 'var(--text-muted)' }}>
                      <span>Runs: {rule.executionCount}</span>
                      <button
                        type="button"
                        className="btn btn-secondary"
                        style={{ fontSize: '10px', padding: '1px 6px' }}
                        onClick={() => void triggerManual(rule.id)}
                        disabled={!autoEnabled}
                        title="Test run routine now"
                      >
                        <Play size={9} style={{ marginRight: '2px' }} /> Run Now
                      </button>
                    </div>
                  </div>
                );
              })}

              <div
                style={{
                  marginTop: '8px',
                  paddingTop: '8px',
                  borderTop: '1px solid var(--border-subtle)',
                  fontSize: '11px',
                  color: 'var(--text-muted)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                }}
              >
                <ShieldCheck size={13} style={{ color: 'var(--status-green)', flexShrink: 0 }} />
                <span>Runs deterministically on device. Zero shell commands.</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
