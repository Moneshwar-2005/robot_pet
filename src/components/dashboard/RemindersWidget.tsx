import React from 'react';
import type { Reminder } from '../../types';
import { formatReminderDisplay } from '../../lib/formatters';
import { CalendarClock, Bell, Heart, Coffee, Users, Check, AlertCircle, RefreshCw, Loader2 } from 'lucide-react';

interface RemindersWidgetProps {
  reminders: Reminder[];
  loading?: boolean;
  error?: string | null;
  onToggleReminder: (reminderId: string) => void;
  onViewAll?: () => void;
  onRetry?: () => void;
}

export const RemindersWidget: React.FC<RemindersWidgetProps> = ({
  reminders,
  loading = false,
  error = null,
  onToggleReminder,
  onViewAll,
  onRetry,
}) => {
  const getReminderIcon = (type: Reminder['type']) => {
    switch (type) {
      case 'wellness':
        return (
          <div className="reminder-icon-wrap reminder-wellness" title="Wellness Alert">
            <Heart size={14} />
          </div>
        );
      case 'pet-routine':
        return (
          <div className="reminder-icon-wrap reminder-routine" title="Kuro Companion Routine">
            <Coffee size={14} />
          </div>
        );
      case 'meeting':
        return (
          <div className="reminder-icon-wrap reminder-meeting" title="Meeting">
            <Users size={14} />
          </div>
        );
      case 'task':
      default:
        return (
          <div className="reminder-icon-wrap reminder-task" title="Scheduled Task">
            <Bell size={14} />
          </div>
        );
    }
  };

  const activeReminders = reminders.filter((r) => !r.done);

  return (
    <div className="card">
      <div className="card-header">
        <div className="card-title-group">
          <CalendarClock className="card-icon" />
          <div>
            <h3 className="card-title">Upcoming Reminders &amp; Routine</h3>
            <p className="card-subtitle">Scheduled health breaks and sync alerts</p>
          </div>
        </div>

        {onViewAll && (
          <button
            type="button"
            className="btn btn-secondary"
            style={{ padding: '5px 10px', fontSize: '12px' }}
            onClick={onViewAll}
          >
            Agenda
          </button>
        )}
      </div>

      {error && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '8px',
            padding: '8px 12px',
            marginBottom: '12px',
            backgroundColor: 'rgba(239, 68, 68, 0.12)',
            border: '1px solid var(--status-red)',
            borderRadius: 'var(--radius-sm)',
            fontSize: '12px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <AlertCircle size={14} style={{ color: 'var(--status-red)', flexShrink: 0 }} />
            <span>{error}</span>
          </div>
          {onRetry && (
            <button
              type="button"
              className="btn btn-secondary"
              onClick={onRetry}
              style={{ padding: '2px 8px', fontSize: '11px' }}
            >
              <RefreshCw size={10} /> Retry
            </button>
          )}
        </div>
      )}

      <div className="reminder-list">
        {loading ? (
          <div className="empty-state">
            <Loader2 className="empty-state-icon" style={{ animation: 'spin 1s linear infinite' }} />
            <div className="empty-state-title">Loading reminders...</div>
            <p className="empty-state-desc">Connecting to your scheduled alerts.</p>
          </div>
        ) : activeReminders.length === 0 ? (
          <div className="empty-state">
            <Bell className="empty-state-icon" />
            <div className="empty-state-title">No upcoming reminders</div>
            <p className="empty-state-desc">All routines and alerts for today have been acknowledged.</p>
          </div>
        ) : (
          activeReminders.map((reminder) => (
            <div key={reminder.id} className="reminder-item">
              <div className="reminder-left">
                {getReminderIcon(reminder.type)}
                <div>
                  <div className="reminder-title">{reminder.title}</div>
                  <div className="reminder-time">{formatReminderDisplay(reminder.time)}</div>
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <button
                  type="button"
                  className="reminder-action-btn"
                  onClick={() => onToggleReminder(reminder.id)}
                  title="Mark acknowledged"
                >
                  <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <Check size={12} /> Done
                  </span>
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      <div style={{ marginTop: '12px', fontSize: '11px', color: 'var(--text-muted)', display: 'flex', justifyContent: 'space-between' }}>
        <span>Visual screen alerts only (no speaker)</span>
        <span className="mono">Push Engine: Phase 2</span>
      </div>
    </div>
  );
};
