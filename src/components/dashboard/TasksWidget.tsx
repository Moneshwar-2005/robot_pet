import React, { useState } from 'react';
import type { Task, TaskPriority } from '../../types';
import { formatTaskDeadline } from '../../lib/formatters';
import { CheckSquare, Check, Plus, Filter, Tag, AlertCircle, RefreshCw, Loader2 } from 'lucide-react';

interface TasksWidgetProps {
  tasks: Task[];
  loading?: boolean;
  error?: string | null;
  onToggleTask: (taskId: string) => void;
  onAddTask: (newTask: Omit<Task, 'id'>) => void;
  onViewAll?: () => void;
  onRetry?: () => void;
}

export const TasksWidget: React.FC<TasksWidgetProps> = ({
  tasks,
  loading = false,
  error = null,
  onToggleTask,
  onAddTask,
  onViewAll,
  onRetry,
}) => {
  const [filter, setFilter] = useState<'all' | 'pending' | 'completed' | 'robot'>('all');
  const [quickTitle, setQuickTitle] = useState('');
  const [quickPriority, setQuickPriority] = useState<TaskPriority>('medium');
  const [showAddForm, setShowAddForm] = useState(false);

  const completedCount = tasks.filter((t) => t.completed).length;

  const filteredTasks = tasks.filter((task) => {
    if (filter === 'pending') return !task.completed;
    if (filter === 'completed') return task.completed;
    if (filter === 'robot') return task.category === 'robot';
    return true;
  });

  const handleQuickSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!quickTitle.trim()) return;

    onAddTask({
      title: quickTitle.trim(),
      category: 'work',
      priority: quickPriority,
      dueDate: 'Today',
      dueTime: null,
      estimatedMinutes: 25,
      completed: false,
      tags: ['Quick Task'],
    });

    setQuickTitle('');
    setShowAddForm(false);
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

  return (
    <div className="card">
      <div className="card-header">
        <div className="card-title-group">
          <CheckSquare className="card-icon" />
          <div>
            <h3 className="card-title">Priority Tasks &amp; Action Items</h3>
            <p className="card-subtitle">
              {completedCount} of {tasks.length} tasks completed today
            </p>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <button
            type="button"
            className="btn btn-secondary"
            style={{ padding: '5px 10px', fontSize: '12px' }}
            onClick={() => setShowAddForm(!showAddForm)}
          >
            <Plus size={14} />
            <span>Add Task</span>
          </button>
          {onViewAll && (
            <button
              type="button"
              className="btn btn-secondary"
              style={{ padding: '5px 10px', fontSize: '12px' }}
              onClick={onViewAll}
            >
              View Board
            </button>
          )}
        </div>
      </div>

      {error && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '8px',
            padding: '8px 12px',
            marginBottom: '12px',
            backgroundColor: 'rgba(239, 68, 68, 0.12)',
            border: '1px solid var(--status-red)',
            borderRadius: 'var(--radius-sm)',
            fontSize: '12px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <AlertCircle size={14} style={{ color: 'var(--status-red)', flexShrink: 0 }} />
            <span>{error}</span>
          </div>
          {onRetry && (
            <button
              type="button"
              className="btn btn-secondary"
              onClick={onRetry}
              style={{ padding: '2px 8px', fontSize: '11px' }}
            >
              <RefreshCw size={10} /> Retry
            </button>
          )}
        </div>
      )}

      {/* Filter Tabs */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '14px', flexWrap: 'wrap' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '11px', color: 'var(--text-muted)' }}>
          <Filter size={12} /> Filter:
        </span>
        {(['all', 'pending', 'completed', 'robot'] as const).map((tab) => (
          <button
            key={tab}
            type="button"
            className={`expression-btn ${filter === tab ? 'active' : ''}`}
            onClick={() => setFilter(tab)}
            style={{ textTransform: 'capitalize' }}
          >
            {tab === 'robot' ? '🤖 Robot Project' : tab}
          </button>
        ))}
      </div>

      {/* Quick Add Form */}
      {showAddForm && (
        <form
          onSubmit={handleQuickSubmit}
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
            padding: '12px',
            backgroundColor: 'var(--bg-card-subtle)',
            borderRadius: 'var(--radius-md)',
            border: '1px solid var(--border-strong)',
            marginBottom: '14px',
          }}
        >
          <input
            type="text"
            placeholder="Enter task title (e.g., Test eye blinking cadence)..."
            value={quickTitle}
            onChange={(e) => setQuickTitle(e.target.value)}
            autoFocus
            style={{
              padding: '8px 12px',
              backgroundColor: 'var(--bg-input)',
              border: '1px solid var(--border-subtle)',
              borderRadius: 'var(--radius-sm)',
              color: 'var(--text-primary)',
              fontSize: '13px',
              width: '100%',
            }}
          />
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Priority:</span>
              <select
                value={quickPriority}
                onChange={(e) => setQuickPriority(e.target.value as TaskPriority)}
                style={{
                  backgroundColor: 'var(--bg-input)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: 'var(--radius-sm)',
                  color: 'var(--text-primary)',
                  fontSize: '11px',
                  padding: '3px 8px',
                }}
              >
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="urgent">Urgent</option>
              </select>
            </div>
            <div style={{ display: 'flex', gap: '6px' }}>
              <button
                type="button"
                className="btn btn-secondary"
                style={{ padding: '4px 8px', fontSize: '11px' }}
                onClick={() => setShowAddForm(false)}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="btn btn-primary"
                style={{ padding: '4px 10px', fontSize: '11px' }}
                disabled={!quickTitle.trim()}
              >
                Save Task
              </button>
            </div>
          </div>
        </form>
      )}

      {/* Task List */}
      <div className="task-list-wrapper">
        {loading ? (
          <div className="empty-state">
            <Loader2 className="empty-state-icon" style={{ animation: 'spin 1s linear infinite' }} />
            <div className="empty-state-title">Loading tasks...</div>
            <p className="empty-state-desc">Connecting to your database.</p>
          </div>
        ) : filteredTasks.length === 0 ? (
          <div className="empty-state">
            <CheckSquare className="empty-state-icon" />
            <div className="empty-state-title">No tasks found in this view</div>
            <p className="empty-state-desc">You are all caught up or no tasks match the selected filter.</p>
          </div>
        ) : (
          filteredTasks.map((task) => (
            <div key={task.id} className={`task-item ${task.completed ? 'completed' : ''}`}>
              <button
                type="button"
                className={`task-checkbox ${task.completed ? 'checked' : ''}`}
                onClick={() => onToggleTask(task.id)}
                aria-label={`Mark "${task.title}" as ${task.completed ? 'incomplete' : 'complete'}`}
              >
                {task.completed && <Check size={13} strokeWidth={3} />}
              </button>

              <div className="task-body">
                <span className="task-title">{task.title}</span>
                <div className="task-meta">
                  {getPriorityBadge(task.priority)}
                  <span>{formatTaskDeadline(task.dueDate, task.dueTime)}</span>
                  <span>•</span>
                  <span>~{task.estimatedMinutes}m</span>
                  {task.tags.map((tag) => (
                    <span key={tag} style={{ display: 'inline-flex', alignItems: 'center', gap: '3px' }}>
                      <Tag size={10} /> {tag}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};
