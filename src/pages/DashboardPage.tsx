import React from 'react';
import type { PetStatus, PetMood, Task, Reminder, WorkSummary, PageId } from '../types';
import { GreetingBanner } from '../components/dashboard/GreetingBanner';
import { PetFacePreview } from '../components/pet/PetFacePreview';
import { TasksWidget } from '../components/dashboard/TasksWidget';
import { RemindersWidget } from '../components/dashboard/RemindersWidget';
import { WorkSummaryWidget } from '../components/dashboard/WorkSummaryWidget';

interface DashboardPageProps {
  petStatus: PetStatus;
  currentMood: PetMood;
  onMoodChange: (mood: PetMood) => void;
  tasks: Task[];
  onToggleTask: (taskId: string) => void;
  onAddTask: (newTask: Omit<Task, 'id'>) => void;
  reminders: Reminder[];
  onToggleReminder: (reminderId: string) => void;
  workSummary: WorkSummary;
  onNavigate: (page: PageId) => void;
}

export const DashboardPage: React.FC<DashboardPageProps> = ({
  petStatus,
  currentMood,
  onMoodChange,
  tasks,
  onToggleTask,
  onAddTask,
  reminders,
  onToggleReminder,
  workSummary,
  onNavigate,
}) => {
  const pendingTasksCount = tasks.filter((t) => !t.completed).length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {/* Dynamic Greeting & Current Date Banner */}
      <GreetingBanner
        petStatus={petStatus}
        userName="Alex"
        pendingTasksCount={pendingTasksCount}
      />

      {/* Main Responsive Grid */}
      <div className="dashboard-grid">
        {/* Left Column: Priority Tasks & Action Items */}
        <div className="col-7" style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <TasksWidget
            tasks={tasks}
            onToggleTask={onToggleTask}
            onAddTask={onAddTask}
            onViewAll={() => onNavigate('tasks')}
          />

          <WorkSummaryWidget
            workSummary={workSummary}
            onViewWorkTracking={() => onNavigate('work-tracking')}
          />
        </div>

        {/* Right Column: Digital Pet Face Visor & Reminders */}
        <div className="col-5" style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          {/* Digital Pet OLED Face Display */}
          <PetFacePreview
            petStatus={petStatus}
            currentMood={currentMood}
            onMoodChange={onMoodChange}
            interactive={true}
          />

          {/* Upcoming Reminders & Wellness Alerts */}
          <RemindersWidget
            reminders={reminders}
            onToggleReminder={onToggleReminder}
            onViewAll={() => onNavigate('reminders')}
          />
        </div>
      </div>
    </div>
  );
};
