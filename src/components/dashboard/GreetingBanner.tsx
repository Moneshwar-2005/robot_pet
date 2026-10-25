import React from 'react';
import type { PetStatus } from '../../types';
import { Calendar, Clock, Sparkles } from 'lucide-react';

interface GreetingBannerProps {
  petStatus: PetStatus;
  userName?: string;
  pendingTasksCount: number;
}

export const GreetingBanner: React.FC<GreetingBannerProps> = ({
  petStatus,
  userName = 'User',
  pendingTasksCount,
}) => {
  const [currentDate] = React.useState(() => new Date());

  const hour = currentDate.getHours();
  let timeGreeting = 'Good morning';
  if (hour >= 12 && hour < 17) {
    timeGreeting = 'Good afternoon';
  } else if (hour >= 17) {
    timeGreeting = 'Good evening';
  }

  const headingGreeting = userName ? `${timeGreeting}, ${userName}` : `${timeGreeting}, Welcome`;

  const formattedDate = currentDate.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

  const pendingText =
    pendingTasksCount === 0
      ? 'no pending tasks'
      : `${pendingTasksCount} pending task${pendingTasksCount === 1 ? '' : 's'}`;

  return (
    <div className="greeting-card">
      <div className="greeting-text-area">
        <h2 className="greeting-heading">
          {headingGreeting}
          <span style={{ fontSize: '20px' }}>👋</span>
        </h2>
        <p style={{ fontSize: '13.5px', color: 'var(--text-secondary)' }}>
          {petStatus.name} is in <strong style={{ color: 'var(--accent-primary)' }}>{petStatus.mode}</strong>.
          You have <strong style={{ color: 'var(--text-primary)' }}>{pendingText}</strong> scheduled for today.
        </p>
        <div className="greeting-meta" style={{ marginTop: '4px' }}>
          <div className="meta-item">
            <Calendar size={14} style={{ color: 'var(--accent-primary)' }} />
            <span>{formattedDate}</span>
          </div>
          <div className="meta-item">
            <Clock size={14} style={{ color: 'var(--accent-primary)' }} />
            <span>Uptime: {petStatus.virtualUptime}</span>
          </div>
          <div className="meta-item">
            <Sparkles size={14} style={{ color: 'var(--status-green)' }} />
            <span>Software State: Optimal</span>
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '8px' }}>
        <span className="badge badge-phase">Phase 1: Web UI Shell</span>
        <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
          Hardware & AI integrations offline
        </span>
      </div>
    </div>
  );
};
