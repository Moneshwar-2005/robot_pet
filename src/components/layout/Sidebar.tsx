import React from 'react';
import type { PageId } from '../../types';
import {
  LayoutDashboard,
  Bot,
  MessageSquareText,
  CheckSquare,
  CalendarClock,
  Timer,
  FileBarChart,
  Brain,
  Network,
  Settings,
  X,
  Radio,
} from 'lucide-react';

interface SidebarProps {
  currentPage: PageId;
  onNavigate: (page: PageId) => void;
  mobileOpen: boolean;
  onCloseMobile: () => void;
  pendingTasksCount: number;
  upcomingRemindersCount: number;
}

interface NavItemConfig {
  id: PageId;
  label: string;
  icon: React.ComponentType<{ className?: string; size?: number }>;
  badge?: string | number;
  section: 'primary' | 'productivity' | 'system';
}

export const Sidebar: React.FC<SidebarProps> = ({
  currentPage,
  onNavigate,
  mobileOpen,
  onCloseMobile,
  pendingTasksCount,
  upcomingRemindersCount,
}) => {
  const navItems: NavItemConfig[] = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, section: 'primary' },
    { id: 'pet-studio', label: 'Pet Studio', icon: Bot, badge: 'Live OLED', section: 'primary' },
    { id: 'assistant', label: 'Personal Assistant', icon: MessageSquareText, section: 'primary' },
    { id: 'tasks', label: 'Tasks & Projects', icon: CheckSquare, badge: pendingTasksCount, section: 'productivity' },
    { id: 'reminders', label: 'Reminders & Calendar', icon: CalendarClock, badge: upcomingRemindersCount, section: 'productivity' },
    { id: 'work-tracking', label: 'Work Tracking', icon: Timer, section: 'productivity' },
    { id: 'daily-reports', label: 'Daily Reports', icon: FileBarChart, section: 'productivity' },
    { id: 'ai-memory', label: 'AI & Memory', icon: Brain, section: 'system' },
    { id: 'integrations', label: 'Integrations', icon: Network, badge: 'Phase 2', section: 'system' },
    { id: 'settings', label: 'Settings & Privacy', icon: Settings, section: 'system' },
  ];

  const handleItemClick = (pageId: PageId) => {
    onNavigate(pageId);
    if (mobileOpen) {
      onCloseMobile();
    }
  };

  return (
    <aside className={`sidebar ${mobileOpen ? 'mobile-open' : ''}`} aria-label="Main Navigation">
      {/* Brand Header */}
      <div className="sidebar-header">
        <div className="sidebar-brand">
          <div className="brand-icon-wrap">
            <Bot size={22} />
          </div>
          <div className="brand-details">
            <span className="brand-title">KURO ASSISTANT</span>
            <span className="brand-subtitle">
              <span className="brand-pulse-dot" />
              <span>Simulated Core Online</span>
            </span>
          </div>
        </div>

        {mobileOpen && (
          <button
            type="button"
            className="mobile-menu-btn"
            onClick={onCloseMobile}
            aria-label="Close navigation"
          >
            <X size={18} />
          </button>
        )}
      </div>

      {/* Navigation List */}
      <nav className="sidebar-nav-container">
        <div className="nav-section-label">Core Companion</div>
        {navItems
          .filter((item) => item.section === 'primary')
          .map((item) => {
            const Icon = item.icon;
            const isActive = currentPage === item.id;
            return (
              <button
                key={item.id}
                type="button"
                className={`nav-item ${isActive ? 'active' : ''}`}
                onClick={() => handleItemClick(item.id)}
                aria-current={isActive ? 'page' : undefined}
              >
                <Icon className="nav-item-icon" size={18} />
                <span>{item.label}</span>
                {item.badge !== undefined && (
                  <span className="nav-item-badge">{item.badge}</span>
                )}
              </button>
            );
          })}

        <div className="nav-section-label" style={{ marginTop: '12px' }}>
          Productivity & Tracking
        </div>
        {navItems
          .filter((item) => item.section === 'productivity')
          .map((item) => {
            const Icon = item.icon;
            const isActive = currentPage === item.id;
            return (
              <button
                key={item.id}
                type="button"
                className={`nav-item ${isActive ? 'active' : ''}`}
                onClick={() => handleItemClick(item.id)}
                aria-current={isActive ? 'page' : undefined}
              >
                <Icon className="nav-item-icon" size={18} />
                <span>{item.label}</span>
                {item.badge !== undefined && (
                  <span className="nav-item-badge">{item.badge}</span>
                )}
              </button>
            );
          })}

        <div className="nav-section-label" style={{ marginTop: '12px' }}>
          Intelligence & Config
        </div>
        {navItems
          .filter((item) => item.section === 'system')
          .map((item) => {
            const Icon = item.icon;
            const isActive = currentPage === item.id;
            return (
              <button
                key={item.id}
                type="button"
                className={`nav-item ${isActive ? 'active' : ''}`}
                onClick={() => handleItemClick(item.id)}
                aria-current={isActive ? 'page' : undefined}
              >
                <Icon className="nav-item-icon" size={18} />
                <span>{item.label}</span>
                {item.badge !== undefined && (
                  <span className="nav-item-badge">{item.badge}</span>
                )}
              </button>
            );
          })}
      </nav>

      {/* Hardware Status Footer */}
      <div className="sidebar-footer">
        <div className="sidebar-hardware-badge">
          <div className="hardware-indicator">
            <Radio size={14} style={{ color: 'var(--status-amber)' }} />
            <span>Hardware Unit</span>
          </div>
          <span className="hardware-tag">Offline (Phase 3)</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10.5px', color: 'var(--text-muted)' }}>
          <span>Version 0.1.0 (Phase 1)</span>
          <span className="mono">Local Mock UI</span>
        </div>
      </div>
    </aside>
  );
};
