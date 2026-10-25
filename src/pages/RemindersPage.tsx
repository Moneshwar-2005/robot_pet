import React, { useState } from 'react';
import type { Reminder } from '../types';
import { PlannedFeatureNotice } from '../components/common/PlannedFeatureNotice';
import { formatReminderDisplay, formatLocalDateString } from '../lib/formatters';
import {
  CalendarClock,
  Plus,
  Check,
  Heart,
  Coffee,
  Users,
  Bell,
  AlertCircle,
  Trash2,
  RefreshCw,
  Loader2,
} from 'lucide-react';

interface RemindersPageProps {
  reminders: Reminder[];
  loading?: boolean;
  error?: string | null;
  onToggleReminder: (reminderId: string) => void;
  onAddReminder: (newReminder: Omit<Reminder, 'id'>) => void;
  onDeleteReminder?: (reminderId: string) => void;
  onRetry?: () => void;
}

export const RemindersPage: React.FC<RemindersPageProps> = ({
  reminders,
  loading = false,
  error = null,
  onToggleReminder,
  onAddReminder,
  onDeleteReminder,
  onRetry,
}) => {
  const [showAdd, setShowAdd] = useState(false);
  const [title, setTitle] = useState('');
  const [date, setDate] = useState(() => formatLocalDateString());
  const [time, setTime] = useState('17:30');
  const [type, setType] = useState<Reminder['type']>('wellness');
  const [priority, setPriority] = useState<Reminder['priority']>('normal');

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

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <PlannedFeatureNotice
        phase="Phase 2: Persistent Reminders"
        title="Reminders &amp; Routine Calendar"
        description="Schedule reminders and wellness check-ins. Authenticated records are stored in Supabase; local demo mode is active when signed out."
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
                        <div className="reminder-time">
                          {formatReminderDisplay(r.time)} • <span style={{ textTransform: 'capitalize' }}>{r.type.replace('-', ' ')}</span>
                          {r.priority === 'important' && (
                            <span style={{ color: 'var(--status-amber)', marginLeft: '6px', fontWeight: 600 }}>• Important</span>
                          )}
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

        <div className="col-4">
          <div className="card">
            <div className="card-header">
              <h3 className="card-title">Companion Routines</h3>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', fontSize: '13px' }}>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-start' }}>
                <Coffee size={16} style={{ color: 'var(--accent-primary)', flexShrink: 0, marginTop: '2px' }} />
                <div>
                  <strong>Hydration Chime</strong>
                  <p style={{ fontSize: '12px' }}>Triggers every 45 mins during focus mode.</p>
                </div>
              </div>

              <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-start' }}>
                <Heart size={16} style={{ color: 'var(--status-green)', flexShrink: 0, marginTop: '2px' }} />
                <div>
                  <strong>Posture Sentry</strong>
                  <p style={{ fontSize: '12px' }}>Visual head tilt cue every 60 mins.</p>
                </div>
              </div>

              <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-start' }}>
                <AlertCircle size={16} style={{ color: 'var(--status-amber)', flexShrink: 0, marginTop: '2px' }} />
                <div>
                  <strong>End of Day Debrief</strong>
                  <p style={{ fontSize: '12px' }}>Prompt to generate daily productivity report at 7:00 PM.</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
