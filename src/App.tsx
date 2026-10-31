import { useState } from 'react';
import type { PageId, PetMood, PetStatus } from './types';
import type { PetFocusState } from './lib/pet/autonomousEngine';
import { initialPetStatus } from './data/mockData';
import { AppLayout } from './components/layout/AppLayout';
import { AuthProvider } from './context/AuthContext';
import { AuthModal } from './components/auth/AuthModal';
import { useTasks } from './hooks/useTasks';
import { useReminders } from './hooks/useReminders';
import { usePetSettings, defaultPetSettings } from './hooks/usePetSettings';
import { useMemories } from './hooks/useMemories';
import { useWorkSessions } from './hooks/useWorkSessions';
import { useProfile } from './hooks/useProfile';
import { useUserPreferences } from './hooks/useUserPreferences';
import { useAuth } from './context/useAuth';
import { useReminderNotifications } from './hooks/useReminderNotifications';
import { useAutonomousPet } from './hooks/useAutonomousPet';
import { useDesktopCompanion } from './hooks/useDesktopCompanion';
import { BellRing, X, Check } from 'lucide-react';
import { DashboardPage } from './pages/DashboardPage';
import { PetStudioPage } from './pages/PetStudioPage';
import { ActivitiesPage } from './pages/ActivitiesPage';
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
  const { theme, toggleTheme } = useUserPreferences();
  const [currentMood, setCurrentMood] = useState<PetMood>('attentive');
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [activeFocusSession, setActiveFocusSession] = useState<PetFocusState | null>(null);

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
    editTask,
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
    snoozeReminder,
    deleteReminder,
    retry: retryReminders,
    resetDemoData: resetRemindersDemoData,
  } = useReminders();

  const {
    alerts: reminderAlerts,
    dismissAlert: dismissReminderAlert,
    acknowledgeAlert: acknowledgeReminderAlert,
  } = useReminderNotifications(reminders, toggleReminder);

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

  // Companion & Browser awareness integration
  const {
    connectionState: companionConnectionState,
    activeSession: companionActiveSession,
    isTracking: companionIsTracking,
    activeBrowserTab,
  } = useDesktopCompanion();

  // Autonomous Digital Pet Engine (Phase 7.4)
  const autonomousPet = useAutonomousPet({
    tasks,
    reminders,
    petSettings,
    updatePetSettings,
    focusSession: activeFocusSession,
    companionState:
      companionConnectionState === 'running_paired'
        ? {
            isTracking: companionIsTracking,
            activeIde: companionActiveSession?.ideName || null,
            activeProject: companionActiveSession?.project || null,
          }
        : null,
    browserState: activeBrowserTab
      ? {
          activeTab: activeBrowserTab,
          isTracking: Boolean(petSettings.browserAwarenessEnabled),
        }
      : null,
    initialMood: currentMood,
  });

  const handleMoodChange = (mood: PetMood) => {
    setCurrentMood(mood);
    autonomousPet.setMood(mood);
  };


  const handleResetPetSettings = async () => {
    resetPetSettingsDemoData();
    await updatePetSettings(defaultPetSettings);
    handleMoodChange('attentive');
  };

  const handleResetData = () => {
    resetTasksDemoData();
    resetRemindersDemoData();
    resetPetSettingsDemoData();
    resetMemoriesDemoData();
    resetSessionsDemoData();
    handleMoodChange('attentive');
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
            currentMood={autonomousPet.currentMood}
            onMoodChange={handleMoodChange}
            eyeShape={petSettings.eyeShape}
            glowColor={petSettings.glowColor}
            mouthStyle={autonomousPet.mouthStyle}
            eyeStyle={autonomousPet.eyeStyle}
            speechText={autonomousPet.speechText}
            isSpeaking={autonomousPet.isSpeaking}
            onSpeechEnd={autonomousPet.stopSpeech}
            onCancelSpeech={autonomousPet.stopSpeech}
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
            currentMood={autonomousPet.currentMood}
            onMoodChange={handleMoodChange}
            petSettings={petSettings}
            loading={petSettingsLoading}
            saving={petSettingsSaving}
            error={petSettingsError}
            onUpdatePetSettings={updatePetSettings}
            onResetPetSettings={handleResetPetSettings}
            onRetry={retryPetSettings}
            autonomousMouthStyle={autonomousPet.mouthStyle}
            autonomousEyeStyle={autonomousPet.eyeStyle}
            autonomousSpeechText={autonomousPet.speechText}
            autonomousIsSpeaking={autonomousPet.isSpeaking}
            isAutonomousPaused={autonomousPet.isPaused}
            onPauseAutonomy={autonomousPet.pauseAutonomy}
            onResumeAutonomy={autonomousPet.resumeAutonomy}
            autonomousCooldownMs={autonomousPet.cooldownMs}
            autonomousNextEligibleSpeechTimestamp={autonomousPet.nextEligibleSpeechTimestamp}
            autonomousLastRule={autonomousPet.lastRuleTriggered}
          />
        );
      case 'activities':
        return (
          <ActivitiesPage
            petStatus={activePetStatus}
            currentMood={autonomousPet.currentMood}
            onMoodChange={handleMoodChange}
            petSettings={petSettings}
            onUpdatePetSettings={updatePetSettings}
          />
        );
      case 'assistant':
        return (
          <AssistantPage
            onAddTask={addTask}
            onAddReminder={addReminder}
            onNavigate={setCurrentPage}
            memories={memories}
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
            onEditTask={editTask}
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
            focusMinutesToday={workSummary.focusMinutesToday}
            onSetPetMood={handleMoodChange}
            onNavigate={setCurrentPage}
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
            onFocusStateChange={setActiveFocusSession}
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
        return (
          <IntegrationsPage
            reminders={reminders}
            tasks={tasks}
            sessions={sessions}
            onNavigate={setCurrentPage}
          />
        );
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
            tasks={tasks}
            reminders={reminders}
            petSettings={petSettings}
            sessions={sessions}
          />
        );
      default:
        return (
          <DashboardPage
            petStatus={activePetStatus}
            currentMood={currentMood}
            onMoodChange={setCurrentMood}
            eyeShape={petSettings.eyeShape}
            glowColor={petSettings.glowColor}
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
        currentMood={autonomousPet.currentMood}
        pendingTasksCount={pendingTasksCount}
        upcomingRemindersCount={upcomingRemindersCount}
        onOpenAuthModal={() => setAuthModalOpen(true)}
      >
        {renderActivePage()}
      </AppLayout>

      {/* Floating In-App Foreground Reminder Alerts */}
      {reminderAlerts.length > 0 && (
        <aside
          aria-label="Reminder Alerts"
          style={{
            position: 'fixed',
            top: '20px',
            right: '20px',
            zIndex: 9999,
            display: 'flex',
            flexDirection: 'column',
            gap: '10px',
            maxWidth: '380px',
            width: 'calc(100vw - 40px)',
          }}
        >
          {reminderAlerts.map((alert) => (
            <div
              key={alert.id}
              className="card"
              style={{
                boxShadow: '0 8px 24px rgba(0, 0, 0, 0.45)',
                border: '1px solid var(--accent-primary)',
                backgroundColor: 'var(--bg-card)',
                padding: '12px 14px',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '8px' }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px' }}>
                  <BellRing size={18} style={{ color: 'var(--status-amber)', flexShrink: 0, marginTop: '2px' }} />
                  <div>
                    <h4 style={{ margin: '0 0 2px 0', fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>
                      {alert.title}
                    </h4>
                    <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                      {alert.timeDisplay || 'Due now'}
                    </span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => dismissReminderAlert(alert.id)}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: 'var(--text-muted)',
                    cursor: 'pointer',
                    padding: '2px',
                  }}
                  title="Dismiss alert"
                >
                  <X size={14} />
                </button>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '10px' }}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  style={{ fontSize: '11px', padding: '3px 8px' }}
                  onClick={() => {
                    dismissReminderAlert(alert.id);
                    void snoozeReminder(alert.reminderId, 5);
                  }}
                  title="Snooze reminder for 5 minutes"
                >
                  Snooze
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  style={{ fontSize: '11px', padding: '3px 10px' }}
                  onClick={() => acknowledgeReminderAlert(alert.reminderId)}
                >
                  <Check size={12} style={{ marginRight: '4px' }} /> Acknowledge
                </button>
              </div>
            </div>
          ))}
        </aside>
      )}

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
