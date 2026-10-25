import React, { useState } from 'react';
import { PlannedFeatureNotice } from '../components/common/PlannedFeatureNotice';
import { Sparkles, CheckCircle, Lightbulb, Calendar } from 'lucide-react';

export const DailyReportsPage: React.FC = () => {
  const [selectedDay, setSelectedDay] = useState<'today' | 'yesterday'>('today');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <PlannedFeatureNotice
        phase="Phase 1: Report Structure Preview"
        title="Daily Productivity Synthesis"
        description="Review end-of-day reports synthesized by your assistant. Automated LLM daily reflections, Obsidian markdown sync, and weekly trend graphs will be populated in Phase 2."
      />

      {/* Date Switcher */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            type="button"
            className={`expression-btn ${selectedDay === 'today' ? 'active' : ''}`}
            onClick={() => setSelectedDay('today')}
          >
            <Calendar size={13} />
            <span>Today (Friday, Oct 23)</span>
          </button>
          <button
            type="button"
            className={`expression-btn ${selectedDay === 'yesterday' ? 'active' : ''}`}
            onClick={() => setSelectedDay('yesterday')}
          >
            <Calendar size={13} />
            <span>Yesterday (Thursday, Oct 22)</span>
          </button>
        </div>

        <span className="badge badge-phase">Simulated AI Summary</span>
      </div>

      {/* Main Report Card */}
      <div className="card">
        <div className="card-header">
          <div className="card-title-group">
            <Sparkles className="card-icon" style={{ color: 'var(--accent-primary)' }} />
            <div>
              <h3 className="card-title">Kuro's Daily Companion Reflection</h3>
              <p className="card-subtitle">Generated at 4:30 PM (Local Session Synthesis)</p>
            </div>
          </div>
          <span className="badge badge-active">Productivity Score: 88/100</span>
        </div>

        <div style={{ fontSize: '14px', lineHeight: 1.6, color: 'var(--text-primary)', marginBottom: '20px', padding: '16px', backgroundColor: 'var(--bg-card-subtle)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)' }}>
          <p style={{ marginBottom: '10px' }}>
            <strong>Executive Summary:</strong> User, today was a highly productive engineering day. You accomplished 2.8 hours of deep uninterrupted work focusing on the Phase 1 software architecture of our robot pet companion.
          </p>
          <p>
            Your energy was highest during the morning block between 10:00 AM and 12:30 PM. You successfully marked off 4 tasks, including the OLED display breakout procurement and the navigation framework.
          </p>
        </div>

        <div className="dashboard-grid">
          {/* Key Accomplishments */}
          <div className="col-6">
            <h4 style={{ fontSize: '13px', fontWeight: 600, marginBottom: '10px', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <CheckCircle size={15} style={{ color: 'var(--status-green)' }} />
              Key Accomplishments
            </h4>
            <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '8px', fontSize: '13px', color: 'var(--text-secondary)' }}>
              <li style={{ padding: '8px', background: 'var(--bg-card-subtle)', borderRadius: 'var(--radius-sm)' }}>
                ✅ Scaffolded full responsive Vite + React + TypeScript UI framework.
              </li>
              <li style={{ padding: '8px', background: 'var(--bg-card-subtle)', borderRadius: 'var(--radius-sm)' }}>
                ✅ Built 1.5-inch simulated OLED digital pet visor with 6 dynamic moods.
              </li>
              <li style={{ padding: '8px', background: 'var(--bg-card-subtle)', borderRadius: 'var(--radius-sm)' }}>
                ✅ Kept consistent 45-minute hydration rhythm with Kuro desk chimes.
              </li>
            </ul>
          </div>

          {/* Assistant Suggestions for Tomorrow */}
          <div className="col-6">
            <h4 style={{ fontSize: '13px', fontWeight: 600, marginBottom: '10px', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <Lightbulb size={15} style={{ color: 'var(--status-amber)' }} />
              Recommendations for Next Sprint
            </h4>
            <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '8px', fontSize: '13px', color: 'var(--text-secondary)' }}>
              <li style={{ padding: '8px', background: 'var(--bg-card-subtle)', borderRadius: 'var(--radius-sm)' }}>
                💡 Block a 90-minute slot tomorrow morning for the Q4 presentation deck.
              </li>
              <li style={{ padding: '8px', background: 'var(--bg-card-subtle)', borderRadius: 'var(--radius-sm)' }}>
                💡 Take a longer screen break in the afternoon to avoid eye strain.
              </li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
};
