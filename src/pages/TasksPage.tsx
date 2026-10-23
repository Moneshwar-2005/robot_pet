import React, { useState } from 'react';
import type { Task, TaskCategory, TaskPriority } from '../types';
import { PlannedFeatureNotice } from '../components/common/PlannedFeatureNotice';
import { CheckSquare, Plus, Check, FolderKanban, Tag, Clock } from 'lucide-react';

interface TasksPageProps {
  tasks: Task[];
  onToggleTask: (taskId: string) => void;
  onAddTask: (newTask: Omit<Task, 'id'>) => void;
}

export const TasksPage: React.FC<TasksPageProps> = ({
  tasks,
  onToggleTask,
  onAddTask,
}) => {
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [showModal, setShowModal] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newCategory, setNewCategory] = useState<TaskCategory>('robot');
  const [newPriority, setNewPriority] = useState<TaskPriority>('medium');
  const [newEstimate, setNewEstimate] = useState(30);

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
      dueDate: 'Today',
      dueTime: '6:00 PM',
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

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <PlannedFeatureNotice
        phase="Phase 1: Local Task Engine"
        title="Tasks & Projects Management"
        description="All task state changes in this view operate locally in memory. Multi-device sync, database backup, and automated voice scheduling will be added in Phase 2."
      />

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
          <span className="metric-sub">{Math.round((completedCount / tasks.length) * 100)}% completion</span>
        </div>
        <div className="metric-stat-box">
          <span className="metric-label">Robot Milestone</span>
          <span className="metric-value">Phase 1</span>
          <span className="metric-sub">UI Shell active</span>
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
            <h3 className="card-title">Create New Task (Local State)</h3>
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
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px' }}>
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
          {filteredTasks.length === 0 ? (
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

                <div className="task-body">
                  <span className="task-title">{task.title}</span>
                  {task.description && (
                    <p style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '2px' }}>
                      {task.description}
                    </p>
                  )}
                  <div className="task-meta" style={{ marginTop: '4px' }}>
                    {getPriorityBadge(task.priority)}
                    <span style={{ textTransform: 'capitalize' }}>Category: {task.category}</span>
                    <span>•</span>
                    <span style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
                      <Clock size={11} /> ~{task.estimatedMinutes}m
                    </span>
                    <span>•</span>
                    <span>Due {task.dueDate} at {task.dueTime}</span>
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
    </div>
  );
};
