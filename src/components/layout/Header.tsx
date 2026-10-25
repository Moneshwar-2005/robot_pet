import React from 'react';
import type { PageId, Theme, PetStatus, PetMood } from '../../types';
import { Menu, Moon, Sun, Bot, LogIn, LogOut, User as UserIcon } from 'lucide-react';
import { useAuth } from '../../context/useAuth';

interface HeaderProps {
  currentPage: PageId;
  pageTitle: string;
  pageDescription: string;
  theme: Theme;
  onToggleTheme: () => void;
  onOpenMobileMenu: () => void;
  petStatus: PetStatus;
  currentMood: PetMood;
  onOpenAuthModal?: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  pageTitle,
  pageDescription,
  theme,
  onToggleTheme,
  onOpenMobileMenu,
  petStatus,
  currentMood,
  onOpenAuthModal,
}) => {
  const { user, signOut } = useAuth();
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

        {/* User Account / Auth Actions */}
        {user ? (
          <div className="header-pet-pill" style={{ gap: '6px' }} title={`Signed in as ${user.email}`}>
            <UserIcon size={14} style={{ color: 'var(--accent-primary)' }} />
            <span style={{ maxWidth: '120px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {user.email?.split('@')[0]}
            </span>
            <button
              type="button"
              onClick={() => signOut()}
              style={{
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                color: 'var(--text-muted)',
                display: 'flex',
                alignItems: 'center',
                padding: '2px',
                marginLeft: '2px',
              }}
              title="Sign Out"
              aria-label="Sign Out"
            >
              <LogOut size={13} />
            </button>
          </div>
        ) : (
          onOpenAuthModal && (
            <button
              type="button"
              className="btn btn-secondary"
              onClick={onOpenAuthModal}
              style={{
                padding: '6px 12px',
                fontSize: '12px',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
              }}
              title="Sign in or create account"
            >
              <LogIn size={14} />
              <span>Sign In</span>
            </button>
          )
        )}

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
