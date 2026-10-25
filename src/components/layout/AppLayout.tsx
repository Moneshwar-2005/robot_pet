import React, { useState } from 'react';
import type { PageId, Theme, PetStatus, PetMood } from '../../types';
import { Sidebar } from './Sidebar';
import { Header } from './Header';
import { navigationItems } from '../../data/mockData';

interface AppLayoutProps {
  currentPage: PageId;
  onNavigate: (page: PageId) => void;
  theme: Theme;
  onToggleTheme: () => void;
  petStatus: PetStatus;
  currentMood: PetMood;
  pendingTasksCount: number;
  upcomingRemindersCount: number;
  onOpenAuthModal?: () => void;
  children: React.ReactNode;
}

export const AppLayout: React.FC<AppLayoutProps> = ({
  currentPage,
  onNavigate,
  theme,
  onToggleTheme,
  petStatus,
  currentMood,
  pendingTasksCount,
  upcomingRemindersCount,
  onOpenAuthModal,
  children,
}) => {
  const [mobileOpen, setMobileOpen] = useState(false);

  const activeNavItem = navigationItems.find((item) => item.id === currentPage) || navigationItems[0];

  return (
    <div className="app-container">
      {/* Mobile Drawer Backdrop */}
      <div
        className={`mobile-overlay ${mobileOpen ? 'mobile-open' : ''}`}
        onClick={() => setMobileOpen(false)}
        aria-hidden="true"
      />

      {/* Desktop & Mobile Sidebar */}
      <Sidebar
        currentPage={currentPage}
        onNavigate={onNavigate}
        mobileOpen={mobileOpen}
        onCloseMobile={() => setMobileOpen(false)}
        pendingTasksCount={pendingTasksCount}
        upcomingRemindersCount={upcomingRemindersCount}
      />

      {/* Main Wrapper */}
      <div className="main-wrapper">
        <Header
          currentPage={currentPage}
          pageTitle={activeNavItem.label}
          pageDescription={activeNavItem.description}
          theme={theme}
          onToggleTheme={onToggleTheme}
          onOpenMobileMenu={() => setMobileOpen(true)}
          petStatus={petStatus}
          currentMood={currentMood}
          onOpenAuthModal={onOpenAuthModal}
        />

        <main className="page-container">{children}</main>
      </div>
    </div>
  );
};
