import { useState, useEffect } from 'react';
import type { PageId, Theme, PetMood, Task, Reminder } from './types';
import {
  initialPetStatus,
  initialTasks,
  initialReminders,
  initialWorkSummary,
} from './data/mockData';
import { AppLayout } from './components/layout/AppLayout';
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

export function App() {
  const [currentPage, setCurrentPage] = useState<PageId>('dashboard');
  const [theme, setTheme] = useState<Theme>('dark');
  const [petStatus] = useState(initialPetStatus);
  const [currentMood, setCurrentMood] = useState<PetMood>('attentive');
  const [tasks, setTasks] = useState<Task[]>(initialTasks);
  const [reminders, setReminders] = useState<Reminder[]>(initialReminders);
  const [workSummary] = useState(initialWorkSummary);

  // Sync theme with HTML data-theme attribute
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  const toggleTheme = () => {
    setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'));
  };

  const handleToggleTask = (taskId: string) => {
    setTasks((prev) =>
      prev.map((t) => (t.id === taskId ? { ...t, completed: !t.completed } : t))
    );
  };

  const handleAddTask = (newTaskData: Omit<Task, 'id'>) => {
    const newTask: Task = {
      ...newTaskData,
      id: `task-${Date.now()}`,
    };
    setTasks((prev) => [newTask, ...prev]);
  };

  const handleToggleReminder = (reminderId: string) => {
    setReminders((prev) =>
      prev.map((r) => (r.id === reminderId ? { ...r, done: !r.done } : r))
    );
  };

  const handleAddReminder = (newReminderData: Omit<Reminder, 'id'>) => {
    const newReminder: Reminder = {
      ...newReminderData,
      id: `rem-${Date.now()}`,
    };
    setReminders((prev) => [newReminder, ...prev]);
  };

  const handleResetData = () => {
    setTasks(initialTasks);
    setReminders(initialReminders);
    setCurrentMood('attentive');
  };

  const pendingTasksCount = tasks.filter((t) => !t.completed).length;
  const upcomingRemindersCount = reminders.filter((r) => !r.done).length;

  const renderActivePage = () => {
    switch (currentPage) {
      case 'dashboard':
        return (
          <DashboardPage
            petStatus={petStatus}
            currentMood={currentMood}
            onMoodChange={setCurrentMood}
            tasks={tasks}
            onToggleTask={handleToggleTask}
            onAddTask={handleAddTask}
            reminders={reminders}
            onToggleReminder={handleToggleReminder}
            workSummary={workSummary}
            onNavigate={setCurrentPage}
          />
        );
      case 'pet-studio':
        return (
          <PetStudioPage
            petStatus={petStatus}
            currentMood={currentMood}
            onMoodChange={setCurrentMood}
          />
        );
      case 'assistant':
        return <AssistantPage />;
      case 'tasks':
        return (
          <TasksPage
            tasks={tasks}
            onToggleTask={handleToggleTask}
            onAddTask={handleAddTask}
          />
        );
      case 'reminders':
        return (
          <RemindersPage
            reminders={reminders}
            onToggleReminder={handleToggleReminder}
            onAddReminder={handleAddReminder}
          />
        );
      case 'work-tracking':
        return <WorkTrackingPage workSummary={workSummary} />;
      case 'daily-reports':
        return <DailyReportsPage />;
      case 'ai-memory':
        return <MemoryPage />;
      case 'integrations':
        return <IntegrationsPage />;
      case 'settings':
        return (
          <SettingsPage
            theme={theme}
            onToggleTheme={toggleTheme}
            onResetData={handleResetData}
          />
        );
      default:
        return (
          <DashboardPage
            petStatus={petStatus}
            currentMood={currentMood}
            onMoodChange={setCurrentMood}
            tasks={tasks}
            onToggleTask={handleToggleTask}
            onAddTask={handleAddTask}
            reminders={reminders}
            onToggleReminder={handleToggleReminder}
            workSummary={workSummary}
            onNavigate={setCurrentPage}
          />
        );
    }
  };

  return (
    <AppLayout
      currentPage={currentPage}
      onNavigate={setCurrentPage}
      theme={theme}
      onToggleTheme={toggleTheme}
      petStatus={petStatus}
      currentMood={currentMood}
      pendingTasksCount={pendingTasksCount}
      upcomingRemindersCount={upcomingRemindersCount}
    >
      {renderActivePage()}
    </AppLayout>
  );
}

export default App;
