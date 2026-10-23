import React, { useState } from 'react';
import type { Reminder } from '../types';
import { PlannedFeatureNotice } from '../components/common/PlannedFeatureNotice';
import { CalendarClock, Plus, Check, Heart, Coffee, Users, Bell, AlertCircle } from 'lucide-react';

interface RemindersPageProps {
  reminders: Reminder[];
  onToggleReminder: (reminderId: string) => void;
  onAddReminder: (newReminder: Omit<Reminder, 'id'>) => void;
}

export const RemindersPage: React.FC<RemindersPageProps> = ({
  reminders,
  onToggleReminder,
  onAddReminder,
}) => {
  const [showAdd, setShowAdd] = useState(false);
  const [title, setTitle] = useState('');
  const [time, setTime] = useState('5:30 PM');
  const [type, setType] = useState<Reminder['type']>('wellness');

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;

    onAddReminder({
      title: title.trim(),
      time,
      type,
      priority: 'normal',
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
        phase="Phase 1: Local Reminders Shell"
        title="Reminders &amp; Routine Calendar"
        description="Schedule reminders and wellness check-ins. Background system push notifications and Google Calendar sync will be integrated in Phase 2."
      />

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
            style={{
              padding: '8px 12px',
              background: 'var(--bg-input)',
              border: '1px solid var(--border-subtle)',
              borderRadius: 'var(--radius-sm)',
              color: 'var(--text-primary)',
            }}
          />
          <div style={{ display: 'flex', gap: '10px' }}>
            <input
              type="text"
              placeholder="Time (e.g. 6:00 PM)"
              value={time}
              onChange={(e) => setTime(e.target.value)}
              style={{
                flex: 1,
                padding: '8px 12px',
                background: 'var(--bg-input)',
                border: '1px solid var(--border-subtle)',
                borderRadius: 'var(--radius-sm)',
                color: 'var(--text-primary)',
              }}
            />
            <select
              value={type}
              onChange={(e) => setType(e.target.value as Reminder['type'])}
              style={{
                flex: 1,
                padding: '8px 12px',
                background: 'var(--bg-input)',
                border: '1px solid var(--border-subtle)',
                borderRadius: 'var(--radius-sm)',
                color: 'var(--text-primary)',
              }}
            >
              <option value="wellness">Wellness Alert</option>
              <option value="pet-routine">Pet Routine</option>
              <option value="task">Task Reminder</option>
              <option value="meeting">Meeting Sync</option>
            </select>
            <button type="submit" className="btn btn-primary" disabled={!title.trim()}>
              Save
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
                        {r.time} • <span style={{ textTransform: 'capitalize' }}>{r.type.replace('-', ' ')}</span>
                      </div>
                    </div>
                  </div>

                  <button
                    type="button"
                    className="reminder-action-btn"
                    onClick={() => onToggleReminder(r.id)}
                  >
                    <Check size={13} />
                    <span>{r.done ? 'Restore' : 'Acknowledge'}</span>
                  </button>
                </div>
              ))}
            </div>
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
