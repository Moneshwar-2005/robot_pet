import React, { useState } from 'react';
import { sampleIntegrations } from '../data/mockData';
import { PlannedFeatureNotice } from '../components/common/PlannedFeatureNotice';
import { Bot, Calendar, FileText, Home, Music, Database } from 'lucide-react';

export const IntegrationsPage: React.FC = () => {
  const [selectedIntegration, setSelectedIntegration] = useState<string | null>(null);

  const getIcon = (iconName: string) => {
    switch (iconName) {
      case 'Bot':
        return <Bot size={22} style={{ color: 'var(--accent-primary)' }} />;
      case 'Calendar':
        return <Calendar size={22} style={{ color: 'var(--accent-secondary)' }} />;
      case 'FileText':
        return <FileText size={22} style={{ color: 'var(--status-green)' }} />;
      case 'Home':
        return <Home size={22} style={{ color: 'var(--status-amber)' }} />;
      case 'Music':
        return <Music size={22} style={{ color: 'var(--status-blue)' }} />;
      default:
        return <Database size={22} style={{ color: 'var(--text-muted)' }} />;
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <PlannedFeatureNotice
        phase="Phase 1: Architecture Preview"
        title="External Tool &amp; Hardware Integrations"
        description="Review planned integrations with third-party tools, smart home systems, and physical robot hardware. In accordance with Phase 1 rules, external APIs, cloud databases, and hardware radios are not active."
      />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '20px' }}>
        {sampleIntegrations.map((item) => (
          <div key={item.id} className="card" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '12px' }}>
                <div className="brand-icon-wrap" style={{ width: '42px', height: '42px' }}>
                  {getIcon(item.icon)}
                </div>
                <span className="badge badge-planned">{item.status}</span>
              </div>

              <h3 style={{ fontSize: '15px', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '4px' }}>
                {item.name}
              </h3>
              <span style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'block', marginBottom: '10px' }}>
                Category: {item.category}
              </span>
              <p style={{ fontSize: '12.5px', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                {item.description}
              </p>
            </div>

            <div style={{ marginTop: '16px', paddingTop: '12px', borderTop: '1px solid var(--border-subtle)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Connection: Disabled</span>
              <button
                type="button"
                className="btn btn-secondary"
                style={{ fontSize: '11px', padding: '4px 10px' }}
                onClick={() => setSelectedIntegration(item.id)}
              >
                Protocol Spec
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Protocol Spec Modal */}
      {selectedIntegration && (
        <div className="card" style={{ backgroundColor: 'var(--bg-card-hover)', border: '1px solid var(--border-strong)', marginTop: '10px' }}>
          <div className="card-header">
            <h3 className="card-title">Integration Protocol Details</h3>
            <button
              type="button"
              className="btn btn-secondary"
              style={{ padding: '4px 8px', fontSize: '11px' }}
              onClick={() => setSelectedIntegration(null)}
            >
              Dismiss
            </button>
          </div>
          <p style={{ fontSize: '13px', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
            Selected target: <strong style={{ color: 'var(--text-primary)' }}>{selectedIntegration}</strong>.
            This connection is scheduled for implementation in subsequent phases. Hardware drivers and API credentials will be configured safely via environment secrets and WebBluetooth in Phase 2 & 3.
          </p>
        </div>
      )}
    </div>
  );
};
