import { useState, useEffect } from 'react';
import type { PageId, Theme, PetMood, PetStatus } from './types';
import { initialPetStatus } from './data/mockData';
import { AppLayout } from './components/layout/AppLayout';
import { AuthProvider } from './context/AuthContext';
import { AuthModal } from './components/auth/AuthModal';
import { useTasks } from './hooks/useTasks';
import { useReminders } from './hooks/useReminders';
import { usePetSettings } from './hooks/usePetSettings';
import { useMemories } from './hooks/useMemories';
import { useWorkSessions } from './hooks/useWorkSessions';
import { useProfile } from './hooks/useProfile';
import { useAuth } from './context/useAuth';
import { DashboardPage } from './pages/DashboardPage';
import { PetStudioPage } from './pages/PetStudioPage';
import { AssistantPage } from './pages/AssistantPage';
import { TasksPage } from './pages/TasksPage';
import { RemindersPage } from './pages/RemindersPage';
import { WorkTrackingPage } from './pages/WorkTrackingPage';
import { DailyReportsPage } from './pages/DailyReportsPage';
import { MemoryPage } from './pages/MemoryPage';
import { IntegrationsPage } from './pages/IntegrationsPage';
import { SettingsPage } from './pages/SettingsPage';

function AppContent() {
  const { user } = useAuth();
  const [currentPage, setCurrentPage] = useState<PageId>('dashboard');
  const [theme, setTheme] = useState<Theme>('dark');
  const [currentMood, setCurrentMood] = useState<PetMood>('attentive');
  const [authModalOpen, setAuthModalOpen] = useState(false);

  const {
    profile,
    loading: profileLoading,
    saving: profileSaving,
    error: profileError,
    updateFullName,
    retry: retryProfile,
  } = useProfile();

  const {
    tasks,
    loading: tasksLoading,
    error: tasksError,
    addTask,
    toggleTask,
    deleteTask,
    retry: retryTasks,
    resetDemoData: resetTasksDemoData,
  } = useTasks();

  const {
    reminders,
    loading: remindersLoading,
    error: remindersError,
    addReminder,
    toggleReminder,
    deleteReminder,
    retry: retryReminders,
    resetDemoData: resetRemindersDemoData,
  } = useReminders();

  const {
    petSettings,
    loading: petSettingsLoading,
    saving: petSettingsSaving,
    error: petSettingsError,
    updatePetSettings,
    retry: retryPetSettings,
    resetDemoData: resetPetSettingsDemoData,
  } = usePetSettings();

  const {
    memories,
    loading: memoriesLoading,
    error: memoriesError,
    addMemory,
    editMemory,
    deleteMemory,
    retry: retryMemories,
    resetDemoData: resetMemoriesDemoData,
  } = useMemories();

  const completedTasksCount = tasks.filter((t) => t.completed).length;
  const totalTasksCount = tasks.length;

  const {
    sessions,
    workSummary,
    loading: sessionsLoading,
    error: sessionsError,
    recordSession,
    deleteSession,
    retry: retrySessions,
    resetDemoData: resetSessionsDemoData,
  } = useWorkSessions(completedTasksCount, totalTasksCount);

  // Sync theme with HTML data-theme attribute
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  const toggleTheme = () => {
    setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'));
  };

  const handleResetData = () => {
    resetTasksDemoData();
    resetRemindersDemoData();
    resetPetSettingsDemoData();
    resetMemoriesDemoData();
    resetSessionsDemoData();
    setCurrentMood('attentive');
  };

  const pendingTasksCount = tasks.filter((t) => !t.completed).length;
  const upcomingRemindersCount = reminders.filter((r) => !r.done).length;

  const activePetStatus: PetStatus = {
    ...initialPetStatus,
    name: petSettings.petName || initialPetStatus.name,
    avatarVariant: petSettings.avatarVariant || initialPetStatus.avatarVariant,
  };

  const displayName = profile?.fullName || (user ? '' : 'User');

  const renderActivePage = () => {
    switch (currentPage) {
      case 'dashboard':
        return (
          <DashboardPage
            petStatus={activePetStatus}
            currentMood={currentMood}
            onMoodChange={setCurrentMood}
            userName={displayName}
            tasks={tasks}
            tasksLoading={tasksLoading}
            tasksError={tasksError}
            onToggleTask={toggleTask}
            onAddTask={addTask}
            onRetryTasks={retryTasks}
            reminders={reminders}
            remindersLoading={remindersLoading}
            remindersError={remindersError}
            onToggleReminder={toggleReminder}
            onRetryReminders={retryReminders}
            workSummary={workSummary}
            onNavigate={setCurrentPage}
          />
        );
      case 'pet-studio':
        return (
          <PetStudioPage
            petStatus={activePetStatus}
            currentMood={currentMood}
            onMoodChange={setCurrentMood}
            petSettings={petSettings}
            loading={petSettingsLoading}
            saving={petSettingsSaving}
            error={petSettingsError}
            onUpdatePetSettings={updatePetSettings}
            onRetry={retryPetSettings}
          />
        );
      case 'assistant':
        return (
          <AssistantPage
            onAddTask={addTask}
            onAddReminder={addReminder}
            onNavigate={setCurrentPage}
          />
        );
      case 'tasks':
        return (
          <TasksPage
            tasks={tasks}
            loading={tasksLoading}
            error={tasksError}
            onToggleTask={toggleTask}
            onAddTask={addTask}
            onDeleteTask={deleteTask}
            onRetry={retryTasks}
          />
        );
      case 'reminders':
        return (
          <RemindersPage
            reminders={reminders}
            loading={remindersLoading}
            error={remindersError}
            onToggleReminder={toggleReminder}
            onAddReminder={addReminder}
            onDeleteReminder={deleteReminder}
            onRetry={retryReminders}
          />
        );
      case 'work-tracking':
        return (
          <WorkTrackingPage
            workSummary={workSummary}
            sessions={sessions}
            loading={sessionsLoading}
            error={sessionsError}
            onRecordSession={recordSession}
            onDeleteSession={deleteSession}
            onRetry={retrySessions}
            tasks={tasks}
          />
        );
      case 'daily-reports':
        return <DailyReportsPage sessions={sessions} tasks={tasks} />;
      case 'ai-memory':
        return (
          <MemoryPage
            memories={memories}
            loading={memoriesLoading}
            error={memoriesError}
            onAddMemory={addMemory}
            onEditMemory={editMemory}
            onDeleteMemory={deleteMemory}
            onRetry={retryMemories}
          />
        );
      case 'integrations':
        return <IntegrationsPage />;
      case 'settings':
        return (
          <SettingsPage
            theme={theme}
            onToggleTheme={toggleTheme}
            onResetData={handleResetData}
            onOpenAuthModal={() => setAuthModalOpen(true)}
            profile={profile}
            profileLoading={profileLoading}
            profileSaving={profileSaving}
            profileError={profileError}
            onUpdateFullName={updateFullName}
            onRetryProfile={retryProfile}
          />
        );
      default:
        return (
          <DashboardPage
            petStatus={activePetStatus}
            currentMood={currentMood}
            onMoodChange={setCurrentMood}
            userName={displayName}
            tasks={tasks}
            tasksLoading={tasksLoading}
            tasksError={tasksError}
            onToggleTask={toggleTask}
            onAddTask={addTask}
            onRetryTasks={retryTasks}
            reminders={reminders}
            remindersLoading={remindersLoading}
            remindersError={remindersError}
            onToggleReminder={toggleReminder}
            onRetryReminders={retryReminders}
            workSummary={workSummary}
            onNavigate={setCurrentPage}
          />
        );
    }
  };

  return (
    <>
      <AppLayout
        currentPage={currentPage}
        onNavigate={setCurrentPage}
        theme={theme}
        onToggleTheme={toggleTheme}
        petStatus={activePetStatus}
        currentMood={currentMood}
        pendingTasksCount={pendingTasksCount}
        upcomingRemindersCount={upcomingRemindersCount}
        onOpenAuthModal={() => setAuthModalOpen(true)}
      >
        {renderActivePage()}
      </AppLayout>

      <AuthModal
        isOpen={authModalOpen}
        onClose={() => setAuthModalOpen(false)}
      />
    </>
  );
}

export function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}

export default App;
