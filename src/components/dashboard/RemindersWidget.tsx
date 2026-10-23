import React from 'react';
import type { Reminder } from '../../types';
import { CalendarClock, Bell, Heart, Coffee, Users, Check } from 'lucide-react';

interface RemindersWidgetProps {
  reminders: Reminder[];
  onToggleReminder: (reminderId: string) => void;
  onViewAll?: () => void;
}

export const RemindersWidget: React.FC<RemindersWidgetProps> = ({
  reminders,
  onToggleReminder,
  onViewAll,
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

      <div className="reminder-list">
        {activeReminders.length === 0 ? (
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
                  <div className="reminder-time">{reminder.time}</div>
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
        <span>Hardware audio chimes simulated</span>
        <span className="mono">Push Engine: Phase 2</span>
      </div>
    </div>
  );
};
