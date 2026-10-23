import React from 'react';
import type { PageId, Theme, PetStatus, PetMood } from '../../types';
import { Menu, Moon, Sun, Bot, ShieldCheck } from 'lucide-react';

interface HeaderProps {
  currentPage: PageId;
  pageTitle: string;
  pageDescription: string;
  theme: Theme;
  onToggleTheme: () => void;
  onOpenMobileMenu: () => void;
  petStatus: PetStatus;
  currentMood: PetMood;
}

export const Header: React.FC<HeaderProps> = ({
  pageTitle,
  pageDescription,
  theme,
  onToggleTheme,
  onOpenMobileMenu,
  petStatus,
  currentMood,
}) => {
  return (
    <header className="app-header">
      <div className="header-left">
        <button
          type="button"
          className="mobile-menu-btn"
          onClick={onOpenMobileMenu}
          aria-label="Open mobile navigation menu"
        >
          <Menu size={20} />
        </button>

        <div className="header-page-info">
          <h1 className="header-page-title">{pageTitle}</h1>
          <p className="header-page-desc">{pageDescription}</p>
        </div>
      </div>

      <div className="header-right">
        {/* Quick Pet Companion Status Badge */}
        <div className="header-pet-pill">
          <Bot size={15} style={{ color: 'var(--accent-primary)' }} />
          <span>{petStatus.name}</span>
          <span style={{ color: 'var(--text-muted)' }}>•</span>
          <span style={{ textTransform: 'capitalize' }}>{currentMood}</span>
          <span style={{ color: 'var(--text-muted)' }}>•</span>
          <span className="mono">{petStatus.batteryLevel}%</span>
        </div>

        {/* Phase 1 Local Mode Indicator */}
        <div className="header-pet-pill" style={{ display: 'none' /* Will show on large displays */ }}>
          <ShieldCheck size={14} style={{ color: 'var(--status-green)' }} />
          <span>Local UI Phase 1</span>
        </div>

        {/* Theme Toggle Button */}
        <button
          type="button"
          className="header-theme-toggle"
          onClick={onToggleTheme}
          title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
          aria-label="Toggle theme"
        >
          {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
        </button>
      </div>
    </header>
  );
};
