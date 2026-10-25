import React, { useState } from 'react';
import type { Task, TaskCategory, TaskPriority } from '../types';
import { PlannedFeatureNotice } from '../components/common/PlannedFeatureNotice';
import { formatTaskDeadline, formatLocalDateString } from '../lib/formatters';
import {
  CheckSquare,
  Plus,
  Check,
  FolderKanban,
  Tag,
  Clock,
  AlertCircle,
  RefreshCw,
  Loader2,
  Trash2,
} from 'lucide-react';

interface TasksPageProps {
  tasks: Task[];
  loading?: boolean;
  error?: string | null;
  onToggleTask: (taskId: string) => void;
  onAddTask: (newTask: Omit<Task, 'id'>) => void;
  onDeleteTask?: (taskId: string) => void;
  onRetry?: () => void;
}

export const TasksPage: React.FC<TasksPageProps> = ({
  tasks,
  loading = false,
  error = null,
  onToggleTask,
  onAddTask,
  onDeleteTask,
  onRetry,
}) => {
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [showModal, setShowModal] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newCategory, setNewCategory] = useState<TaskCategory>('robot');
  const [newPriority, setNewPriority] = useState<TaskPriority>('medium');
  const [newEstimate, setNewEstimate] = useState(30);
  const [newDueDate, setNewDueDate] = useState(() => formatLocalDateString());
  const [newDueTime, setNewDueTime] = useState('18:00');

  const filteredTasks = tasks.filter((t) => {
    if (selectedCategory === 'all') return true;
    return t.category === selectedCategory;
  });

  const handleCreateTask = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim()) return;

    onAddTask({
      title: newTitle.trim(),
      category: newCategory,
      priority: newPriority,
      dueDate: newDueDate || null,
      dueTime: newDueTime ? `${newDueTime}:00` : null,
      estimatedMinutes: newEstimate,
      completed: false,
      tags: [newCategory === 'robot' ? 'Hardware' : 'Work'],
    });

    setNewTitle('');
    setShowModal(false);
  };

  const getPriorityBadge = (priority: TaskPriority) => {
    switch (priority) {
      case 'urgent':
        return <span className="badge badge-urgent">Urgent</span>;
      case 'high':
        return <span className="badge badge-high">High</span>;
      case 'medium':
        return <span className="badge badge-medium">Medium</span>;
      case 'low':
        return <span className="badge badge-low">Low</span>;
    }
  };

  const completedCount = tasks.filter((t) => t.completed).length;
  const completionPercentage =
    tasks.length > 0 ? Math.round((completedCount / tasks.length) * 100) : 0;

  const renderSyncBadge = (syncStatus?: Task['syncStatus']) => {
    if (!syncStatus || syncStatus === 'local-only') {
      return (
        <span
          className="badge"
          style={{
            fontSize: '10px',
            padding: '1px 6px',
            backgroundColor: 'var(--bg-card-subtle)',
            color: 'var(--text-muted)',
            border: '1px solid var(--border-subtle)',
          }}
          title="Saved locally on this device (Local Companion Mode)"
        >
          Device Only
        </span>
      );
    }
    if (syncStatus === 'pending-sync') {
      return (
        <span
          className="badge"
          style={{
            fontSize: '10px',
            padding: '1px 6px',
            backgroundColor: 'rgba(234, 179, 8, 0.15)',
            color: 'var(--status-yellow)',
            border: '1px solid rgba(234, 179, 8, 0.35)',
          }}
          title="Saved locally on this device. Waiting to synchronize with Supabase."
        >
          Waiting to sync
        </span>
      );
    }
    if (syncStatus === 'synced') {
      return (
        <span
          className="badge"
          style={{
            fontSize: '10px',
            padding: '1px 6px',
            backgroundColor: 'rgba(34, 197, 94, 0.12)',
            color: 'var(--status-green)',
            border: '1px solid rgba(34, 197, 94, 0.35)',
          }}
          title="Synchronized and persisted in Supabase database."
        >
          Synced
        </span>
      );
    }
    if (syncStatus === 'sync-error') {
      return (
        <span
          className="badge"
          style={{
            fontSize: '10px',
            padding: '1px 6px',
            backgroundColor: 'rgba(239, 68, 68, 0.15)',
            color: 'var(--status-red)',
            border: '1px solid rgba(239, 68, 68, 0.35)',
          }}
          title="Synchronization error. Will retry when connection is restored."
        >
          Sync Error
        </span>
      );
    }
    return null;
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <PlannedFeatureNotice
        phase="Phase 3: Offline Data &amp; Sync"
        title="Tasks &amp; Projects Management"
        description="All task state changes are saved locally first for reliable offline productivity, and synchronized automatically with Supabase when online."
      />

      {error && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '12px',
            padding: '12px 16px',
            backgroundColor: 'rgba(239, 68, 68, 0.12)',
            border: '1px solid var(--status-red)',
            borderRadius: 'var(--radius-md)',
            color: 'var(--text-primary)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <AlertCircle size={18} style={{ color: 'var(--status-red)', flexShrink: 0 }} />
            <span style={{ fontSize: '13px' }}>{error}</span>
          </div>
          {onRetry && (
            <button
              type="button"
              className="btn btn-secondary"
              onClick={onRetry}
              style={{ padding: '4px 10px', fontSize: '12px' }}
            >
              <RefreshCw size={12} />
              <span>Retry</span>
            </button>
          )}
        </div>
      )}

      {/* Top Action Bar */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {(['all', 'work', 'robot', 'learning', 'personal'] as const).map((cat) => (
            <button
              key={cat}
              type="button"
              className={`expression-btn ${selectedCategory === cat ? 'active' : ''}`}
              onClick={() => setSelectedCategory(cat)}
              style={{ textTransform: 'capitalize' }}
            >
              {cat === 'all' ? 'All Projects' : cat === 'robot' ? '🤖 Robot Project' : cat}
            </button>
          ))}
        </div>

        <button
          type="button"
          className="btn btn-primary"
          onClick={() => setShowModal(true)}
        >
          <Plus size={16} />
          <span>New Task</span>
        </button>
      </div>

      {/* Project Statistics Cards */}
      <div className="metric-grid">
        <div className="metric-stat-box">
          <span className="metric-label">Active Tasks</span>
          <span className="metric-value">{tasks.length - completedCount}</span>
          <span className="metric-sub">Across active queues</span>
        </div>
        <div className="metric-stat-box">
          <span className="metric-label">Completed</span>
          <span className="metric-value">{completedCount}</span>
          <span className="metric-sub">{completionPercentage}% completion</span>
        </div>
        <div className="metric-stat-box">
          <span className="metric-label">Robot Milestone</span>
          <span className="metric-value">Phase 2</span>
          <span className="metric-sub">Cloud persistence</span>
        </div>
        <div className="metric-stat-box">
          <span className="metric-label">Estimated Work</span>
          <span className="metric-value">
            {tasks.reduce((sum, t) => sum + (t.completed ? 0 : t.estimatedMinutes), 0)}m
          </span>
          <span className="metric-sub">Remaining today</span>
        </div>
      </div>

      {/* Task Creation Modal */}
      {showModal && (
        <div className="card" style={{ border: '1px solid var(--accent-border)', backgroundColor: 'var(--bg-card-hover)' }}>
          <div className="card-header">
            <h3 className="card-title">Create New Task</h3>
            <button
              type="button"
              className="btn btn-secondary"
              style={{ padding: '4px 8px', fontSize: '11px' }}
              onClick={() => setShowModal(false)}
            >
              Close
            </button>
          </div>
          <form onSubmit={handleCreateTask} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <input
              type="text"
              placeholder="Task title..."
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              autoFocus
              style={{
                padding: '10px 14px',
                backgroundColor: 'var(--bg-input)',
                border: '1px solid var(--border-subtle)',
                borderRadius: 'var(--radius-md)',
                color: 'var(--text-primary)',
              }}
            />
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '10px' }}>
              <div>
                <label style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>
                  Category
                </label>
                <select
                  value={newCategory}
                  onChange={(e) => setNewCategory(e.target.value as TaskCategory)}
                  style={{ width: '100%', padding: '8px', background: 'var(--bg-input)', border: '1px solid var(--border-subtle)', color: 'var(--text-primary)', borderRadius: 'var(--radius-sm)' }}
                >
                  <option value="robot">Robot Companion</option>
                  <option value="work">Work Project</option>
                  <option value="learning">Learning &amp; Growth</option>
                  <option value="personal">Personal Routine</option>
                </select>
              </div>

              <div>
                <label style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>
                  Priority
                </label>
                <select
                  value={newPriority}
                  onChange={(e) => setNewPriority(e.target.value as TaskPriority)}
                  style={{ width: '100%', padding: '8px', background: 'var(--bg-input)', border: '1px solid var(--border-subtle)', color: 'var(--text-primary)', borderRadius: 'var(--radius-sm)' }}
                >
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                  <option value="urgent">Urgent</option>
                </select>
              </div>

              <div>
                <label style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>
                  Estimate (mins)
                </label>
                <input
                  type="number"
                  min="5"
                  step="5"
                  value={newEstimate}
                  onChange={(e) => setNewEstimate(Number(e.target.value))}
                  style={{ width: '100%', padding: '8px', background: 'var(--bg-input)', border: '1px solid var(--border-subtle)', color: 'var(--text-primary)', borderRadius: 'var(--radius-sm)' }}
                />
              </div>

              <div>
                <label style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>
                  Due Date
                </label>
                <input
                  type="date"
                  value={newDueDate}
                  onChange={(e) => setNewDueDate(e.target.value)}
                  style={{ width: '100%', padding: '8px', background: 'var(--bg-input)', border: '1px solid var(--border-subtle)', color: 'var(--text-primary)', borderRadius: 'var(--radius-sm)', fontSize: '12px' }}
                />
              </div>

              <div>
                <label style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>
                  Due Time
                </label>
                <input
                  type="time"
                  value={newDueTime}
                  onChange={(e) => setNewDueTime(e.target.value)}
                  style={{ width: '100%', padding: '8px', background: 'var(--bg-input)', border: '1px solid var(--border-subtle)', color: 'var(--text-primary)', borderRadius: 'var(--radius-sm)', fontSize: '12px' }}
                />
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '6px' }}>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setShowModal(false)}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="btn btn-primary"
                disabled={!newTitle.trim()}
              >
                Add Task
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Task List */}
      <div className="card">
        <div className="card-header">
          <div className="card-title-group">
            <FolderKanban className="card-icon" />
            <div>
              <h3 className="card-title">Tasks in Selected Scope</h3>
              <p className="card-subtitle">{filteredTasks.length} total tasks</p>
            </div>
          </div>
        </div>

        <div>
          {loading ? (
            <div className="empty-state">
              <Loader2 className="empty-state-icon" style={{ animation: 'spin 1s linear infinite' }} />
              <div className="empty-state-title">Loading tasks...</div>
              <p className="empty-state-desc">Fetching tasks from your database.</p>
            </div>
          ) : filteredTasks.length === 0 ? (
            <div className="empty-state">
              <CheckSquare className="empty-state-icon" />
              <div className="empty-state-title">No tasks in this category</div>
              <p className="empty-state-desc">Click "New Task" above to add items to this workspace.</p>
            </div>
          ) : (
            filteredTasks.map((task) => (
              <div key={task.id} className={`task-item ${task.completed ? 'completed' : ''}`}>
                <button
                  type="button"
                  className={`task-checkbox ${task.completed ? 'checked' : ''}`}
                  onClick={() => onToggleTask(task.id)}
                  aria-label={`Mark task as ${task.completed ? 'incomplete' : 'complete'}`}
                >
                  {task.completed && <Check size={13} strokeWidth={3} />}
                </button>

                <div className="task-body" style={{ flex: 1 }}>
                  <span className="task-title">{task.title}</span>
                  {task.description && (
                    <p style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '2px' }}>
                      {task.description}
                    </p>
                  )}
                  <div className="task-meta" style={{ marginTop: '4px' }}>
                    {getPriorityBadge(task.priority)}
                    {renderSyncBadge(task.syncStatus)}
                    <span style={{ textTransform: 'capitalize' }}>Category: {task.category}</span>
                    <span>•</span>
                    <span style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
                      <Clock size={11} /> ~{task.estimatedMinutes}m
                    </span>
                    <span>•</span>
                    <span>{formatTaskDeadline(task.dueDate, task.dueTime)}</span>
                    {task.tags.map((tag) => (
                      <span key={tag} style={{ display: 'inline-flex', alignItems: 'center', gap: '3px' }}>
                        <Tag size={10} /> {tag}
                      </span>
                    ))}
                  </div>
                </div>

                {onDeleteTask && (
                  <button
                    type="button"
                    className="reminder-action-btn"
                    onClick={() => onDeleteTask(task.id)}
                    title="Delete task"
                    style={{ color: 'var(--status-red)', alignSelf: 'center', marginLeft: '8px' }}
                  >
                    <Trash2 size={13} />
                  </button>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};
