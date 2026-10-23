import React from 'react';
import { Info } from 'lucide-react';

interface PlannedFeatureNoticeProps {
  phase: string;
  title: string;
  description: string;
}

export const PlannedFeatureNotice: React.FC<PlannedFeatureNoticeProps> = ({
  phase,
  title,
  description,
}) => {
  return (
    <div className="planned-notice-banner" role="status">
      <Info className="notice-icon" aria-hidden="true" />
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
          <span className="planned-notice-title">{title}</span>
          <span className="badge badge-phase">{phase}</span>
        </div>
        <p className="planned-notice-desc">{description}</p>
      </div>
    </div>
  );
};
