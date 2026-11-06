import React, { useState } from 'react';
import type { Task, TaskCategory, TaskPriority, TaskStatusCategory, BoardColumn } from '../types';
import { PlannedFeatureNotice } from '../components/common/PlannedFeatureNotice';
import { formatTaskDeadline, formatLocalDateString } from '../lib/formatters';
import { useProjects } from '../hooks/useProjects';
import { useTimer } from '../context/useTimer';
import { formatTimerDuration } from '../lib/timerCalculations';
import { KanbanBoard } from '../components/tasks/KanbanBoard';
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
  Pencil,
  List,
  Folder,
  FolderPlus,
  Settings2,
  Archive,
  Play,
  Pause,
  Square,
  Timer as TimerIcon,
} from 'lucide-react';

interface TasksPageProps {
  tasks: Task[];
  loading?: boolean;
  error?: string | null;
  onToggleTask: (taskId: string) => void;
  onAddTask: (newTask: Omit<Task, 'id'>) => void;
  onEditTask?: (taskId: string, updates: Partial<Omit<Task, 'id'>>) => Promise<void> | void;
  onMoveTask?: (
    taskId: string,
    targetColumnId: string,
    newStatus: TaskStatusCategory,
    newPosition?: number
  ) => Promise<void> | void;
  onDeleteTask?: (taskId: string) => void;
  onRetry?: () => void;
}

export const TasksPage: React.FC<TasksPageProps> = ({
  tasks,
  loading = false,
  error = null,
  onToggleTask,
  onAddTask,
  onEditTask,
  onMoveTask,
  onDeleteTask,
  onRetry,
}) => {
  // View mode: 'list' or 'kanban'
  const [viewMode, setViewMode] = useState<'list' | 'kanban'>(() => {
    try {
      return (localStorage.getItem('kuro_tasks_view_mode') as 'list' | 'kanban') || 'list';
    } catch {
      return 'list';
    }
  });

  const handleSetViewMode = (mode: 'list' | 'kanban') => {
    setViewMode(mode);
    try {
      localStorage.setItem('kuro_tasks_view_mode', mode);
    } catch {}
  };

  // Projects integration
  const {
    projects,
    activeProject,
    activeBoard,
    columns,
    loading: projectsLoading,
    error: projectsError,
    selectProject,
    createProject,
    updateProject,
    archiveProject,
  } = useProjects();

  // Normalized Timer integration
  const {
    timerStatus,
    elapsedSeconds,
    isTaskActive,
    startTimer,
    pauseTimer,
    resumeTimer,
    stopTimer,
  } = useTimer();

  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [showModal, setShowModal] = useState(false);
  const [presetColumn, setPresetColumn] = useState<BoardColumn | null>(null);

  // New Task form state
  const [newTitle, setNewTitle] = useState('');
  const [newCategory, setNewCategory] = useState<TaskCategory>('robot');
  const [newPriority, setNewPriority] = useState<TaskPriority>('medium');
  const [newEstimate, setNewEstimate] = useState(30);
  const [newDueDate, setNewDueDate] = useState(() => formatLocalDateString());
  const [newDueTime, setNewDueTime] = useState('18:00');

  // Edit Task State
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [taskToDelete, setTaskToDelete] = useState<Task | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editCategory, setEditCategory] = useState<TaskCategory>('robot');
  const [editPriority, setEditPriority] = useState<TaskPriority>('medium');
  const [editEstimate, setEditEstimate] = useState(30);
  const [editDueDate, setEditDueDate] = useState('');
  const [editDueTime, setEditDueTime] = useState('');
  const [editDescription, setEditDescription] = useState('');

  // Project Creation Modal state
  const [showProjectModal, setShowProjectModal] = useState(false);
  const [newProjName, setNewProjName] = useState('');
  const [newProjDesc, setNewProjDesc] = useState('');
  const [newProjColor, setNewProjColor] = useState('cyan');

  // Project Edit Modal state
  const [showEditProjectModal, setShowEditProjectModal] = useState(false);
  const [editProjName, setEditProjName] = useState('');
  const [editProjDesc, setEditProjDesc] = useState('');
  const [editProjColor, setEditProjColor] = useState('cyan');

  // Filter tasks by active project and category
  const projectTasks = React.useMemo(() => {
    if (!activeProject) return tasks;
    return tasks.filter((t) => {
      // If task has a projectId, match it; if null/legacy, treat as default project
      if (t.projectId) {
        return t.projectId === activeProject.id;
      }
      return activeProject.name === 'General';
    });
  }, [tasks, activeProject]);

  const filteredTasks = React.useMemo(() => {
    return projectTasks.filter((t) => {
      if (selectedCategory === 'all') return true;
      return t.category === selectedCategory;
    });
  }, [projectTasks, selectedCategory]);

  const handleCreateTask = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim()) return;
    if (activeProject?.isArchived) {
      alert('Cannot create tasks in an archived project. Please switch to an active project.');
      return;
    }

    // Resolve column & status
    let resolvedColId: string | null = null;
    let resolvedStatus: TaskStatusCategory = 'todo';

    if (presetColumn) {
      resolvedColId = presetColumn.id;
      resolvedStatus = presetColumn.statusCategory;
    } else {
      const todoCol = columns.find((c) => c.statusCategory === 'todo');
      if (todoCol) {
        resolvedColId = todoCol.id;
      }
    }

    onAddTask({
      title: newTitle.trim(),
      category: newCategory,
      priority: newPriority,
      dueDate: newDueDate || null,
      dueTime: newDueTime ? `${newDueTime}:00` : null,
      estimatedMinutes: newEstimate,
      completed: resolvedStatus === 'done',
      tags: [newCategory === 'robot' ? 'Hardware' : 'Work'],
      projectId: activeProject?.id || null,
      boardId: activeBoard?.id || null,
      columnId: resolvedColId,
      status: resolvedStatus,
    });

    setNewTitle('');
    setPresetColumn(null);
    setShowModal(false);
  };

  const handleQuickAddFromColumn = (column: BoardColumn) => {
    if (activeProject?.isArchived) return;
    setPresetColumn(column);
    setShowModal(true);
  };

  const handleStartEdit = (task: Task) => {
    setEditingTask(task);
    setEditTitle(task.title);
    setEditCategory(task.category);
    setEditPriority(task.priority);
    setEditEstimate(task.estimatedMinutes);
    setEditDueDate(task.dueDate || '');
    setEditDueTime(task.dueTime ? task.dueTime.slice(0, 5) : '');
    setEditDescription(task.description || '');
  };

  const handleSaveEdit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingTask || !editTitle.trim()) return;

    if (onEditTask) {
      void onEditTask(editingTask.id, {
        title: editTitle.trim(),
        category: editCategory,
        priority: editPriority,
        estimatedMinutes: editEstimate,
        dueDate: editDueDate || null,
        dueTime: editDueTime ? `${editDueTime}:00` : null,
        description: editDescription.trim() || undefined,
      });
    }

    setEditingTask(null);
  };

  const handleMoveTask = (
    taskId: string,
    targetColumnId: string,
    newStatus: TaskStatusCategory,
    newPosition?: number
  ) => {
    if (onMoveTask) {
      void onMoveTask(taskId, targetColumnId, newStatus, newPosition);
    } else if (onEditTask) {
      void onEditTask(taskId, {
        columnId: targetColumnId,
        status: newStatus,
        completed: newStatus === 'done',
        position: newPosition,
      });
    }
  };

  const handleCreateProjectSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newProjName.trim()) return;

    await createProject({
      name: newProjName.trim(),
      description: newProjDesc.trim() || undefined,
      color: newProjColor,
    });

    setNewProjName('');
    setNewProjDesc('');
    setShowProjectModal(false);
  };

  const handleStartEditProject = () => {
    if (!activeProject) return;
    setEditProjName(activeProject.name);
    setEditProjDesc(activeProject.description || '');
    setEditProjColor(activeProject.color || 'cyan');
    setShowEditProjectModal(true);
  };

  const handleSaveProjectEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeProject || !editProjName.trim()) return;

    await updateProject(activeProject.id, {
      name: editProjName.trim(),
      description: editProjDesc.trim() || null,
      color: editProjColor,
    });

    setShowEditProjectModal(false);
  };

  const handleArchiveActiveProject = async () => {
    if (!activeProject) return;
    if (activeProject.name.toLowerCase() === 'general') {
      alert('The default General project cannot be archived.');
      return;
    }
    const confirmed = window.confirm(
      `Are you sure you want to archive project "${activeProject.name}"?`
    );
    if (confirmed) {
      await archiveProject(activeProject.id, true);
    }
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

  const completedCount = projectTasks.filter((t) => t.completed).length;
  const completionPercentage =
    projectTasks.length > 0 ? Math.round((completedCount / projectTasks.length) * 100) : 0;

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
        phase="Phase 10: Projects &amp; Kanban Tasks"
        title="Multi-Project &amp; Kanban Board Workspace"
        description="Unified task state across List View and Kanban Board. Tasks are linked to validated project, board and column containers with offline-first synchronization."
      />

      {(error || projectsError) && (
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
            <span style={{ fontSize: '13px' }}>{error || projectsError}</span>
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

      {/* Project Selector Bar */}
      <div
        className="card"
        style={{
          padding: '12px 16px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '12px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--accent-primary)' }}>
            <Folder size={18} />
            <span style={{ fontSize: '13px', fontWeight: 600 }}>Project:</span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
            {projects
              .filter((p) => !p.isArchived)
              .map((p) => {
                const isActive = activeProject?.id === p.id;
                return (
                  <button
                    key={p.id}
                    type="button"
                    className={`expression-btn ${isActive ? 'active' : ''}`}
                    onClick={() => selectProject(p.id)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px',
                      fontSize: '12.5px',
                    }}
                  >
                    <span
                      style={{
                        width: '8px',
                        height: '8px',
                        borderRadius: '50%',
                        backgroundColor: p.color || 'var(--accent-primary)',
                      }}
                    />
                    <span>{p.name}</span>
                  </button>
                );
              })}
          </div>

          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => setShowProjectModal(true)}
            style={{ padding: '4px 9px', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '4px' }}
            title="Create a new workspace project"
          >
            <FolderPlus size={13} />
            <span>New Project</span>
          </button>
        </div>

        {activeProject && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={handleStartEditProject}
              style={{ padding: '4px 8px', fontSize: '11px', display: 'flex', alignItems: 'center', gap: '4px' }}
              title="Edit project details"
            >
              <Settings2 size={12} />
              <span>Edit</span>
            </button>

            {activeProject.name.toLowerCase() !== 'general' && (
              <button
                type="button"
                className="btn btn-secondary"
                onClick={handleArchiveActiveProject}
                style={{ padding: '4px 8px', fontSize: '11px', display: 'flex', alignItems: 'center', gap: '4px', color: 'var(--text-muted)' }}
                title="Archive project"
              >
                <Archive size={12} />
                <span>Archive</span>
              </button>
            )}
          </div>
        )}
      </div>

      {/* Top Action & View Switcher Bar */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '12px',
        }}
      >
        {/* Category Filters (applied in List mode) */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          {(['all', 'work', 'robot', 'learning', 'personal'] as const).map((cat) => (
            <button
              key={cat}
              type="button"
              className={`expression-btn ${selectedCategory === cat ? 'active' : ''}`}
              onClick={() => setSelectedCategory(cat)}
              style={{ textTransform: 'capitalize' }}
            >
              {cat === 'all' ? 'All Categories' : cat === 'robot' ? '🤖 Robot' : cat}
            </button>
          ))}
        </div>

        {/* View Switcher & New Task Button */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div
            style={{
              display: 'flex',
              backgroundColor: 'var(--bg-card)',
              border: '1px solid var(--border-subtle)',
              borderRadius: 'var(--radius-md)',
              padding: '2px',
            }}
          >
            <button
              type="button"
              className={`btn ${viewMode === 'list' ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => handleSetViewMode('list')}
              style={{
                padding: '5px 10px',
                fontSize: '12px',
                border: 'none',
                display: 'flex',
                alignItems: 'center',
                gap: '5px',
              }}
              title="Switch to List View"
            >
              <List size={14} />
              <span>List</span>
            </button>
            <button
              type="button"
              className={`btn ${viewMode === 'kanban' ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => handleSetViewMode('kanban')}
              style={{
                padding: '5px 10px',
                fontSize: '12px',
                border: 'none',
                display: 'flex',
                alignItems: 'center',
                gap: '5px',
              }}
              title="Switch to Kanban Board"
            >
              <FolderKanban size={14} />
              <span>Kanban</span>
            </button>
          </div>

          <button
            type="button"
            className="btn btn-primary"
            disabled={Boolean(activeProject?.isArchived)}
            title={activeProject?.isArchived ? 'Cannot create tasks in an archived project' : undefined}
            onClick={() => {
              if (activeProject?.isArchived) return;
              setPresetColumn(null);
              setShowModal(true);
            }}
          >
            <Plus size={16} />
            <span>New Task</span>
          </button>
        </div>
      </div>

      {/* Project Statistics Cards */}
      <div className="metric-grid">
        <div className="metric-stat-box">
          <span className="metric-label">Active Tasks</span>
          <span className="metric-value">{projectTasks.length - completedCount}</span>
          <span className="metric-sub">In {activeProject?.name || 'Workspace'}</span>
        </div>
        <div className="metric-stat-box">
          <span className="metric-label">Completed</span>
          <span className="metric-value">{completedCount}</span>
          <span className="metric-sub">{completionPercentage}% completion</span>
        </div>
        <div className="metric-stat-box">
          <span className="metric-label">Active Board</span>
          <span className="metric-value">{activeBoard?.name || 'Main Board'}</span>
          <span className="metric-sub">{columns.length} workflow columns</span>
        </div>
        <div className="metric-stat-box">
          <span className="metric-label">Estimated Work</span>
          <span className="metric-value">
            {projectTasks.reduce((sum, t) => sum + (t.completed ? 0 : t.estimatedMinutes), 0)}m
          </span>
          <span className="metric-sub">Remaining work</span>
        </div>
      </div>

      {/* Task Creation Modal */}
      {showModal && (
        <div className="card" style={{ border: '1px solid var(--accent-border)', backgroundColor: 'var(--bg-card-hover)' }}>
          <div className="card-header">
            <h3 className="card-title">
              Create New Task {presetColumn ? `in ${presetColumn.name}` : `in ${activeProject?.name || 'General'}`}
            </h3>
            <button
              type="button"
              className="btn btn-secondary"
              style={{ padding: '4px 8px', fontSize: '11px' }}
              onClick={() => {
                setShowModal(false);
                setPresetColumn(null);
              }}
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
                onClick={() => {
                  setShowModal(false);
                  setPresetColumn(null);
                }}
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

      {/* Task Edit Modal */}
      {editingTask && (
        <div className="card" style={{ border: '1px solid var(--accent-primary)', backgroundColor: 'var(--bg-card-hover)' }}>
          <div className="card-header">
            <h3 className="card-title">Edit Task</h3>
            <button
              type="button"
              className="btn btn-secondary"
              style={{ padding: '4px 8px', fontSize: '11px' }}
              onClick={() => setEditingTask(null)}
            >
              Close
            </button>
          </div>
          <form onSubmit={handleSaveEdit} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <input
              type="text"
              placeholder="Task title..."
              value={editTitle}
              onChange={(e) => setEditTitle(e.target.value)}
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
                  value={editCategory}
                  onChange={(e) => setEditCategory(e.target.value as TaskCategory)}
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
                  value={editPriority}
                  onChange={(e) => setEditPriority(e.target.value as TaskPriority)}
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
                  value={editEstimate}
                  onChange={(e) => setEditEstimate(Number(e.target.value))}
                  style={{ width: '100%', padding: '8px', background: 'var(--bg-input)', border: '1px solid var(--border-subtle)', color: 'var(--text-primary)', borderRadius: 'var(--radius-sm)' }}
                />
              </div>

              <div>
                <label style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>
                  Due Date
                </label>
                <input
                  type="date"
                  value={editDueDate}
                  onChange={(e) => setEditDueDate(e.target.value)}
                  style={{ width: '100%', padding: '8px', background: 'var(--bg-input)', border: '1px solid var(--border-subtle)', color: 'var(--text-primary)', borderRadius: 'var(--radius-sm)', fontSize: '12px' }}
                />
              </div>

              <div>
                <label style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>
                  Due Time
                </label>
                <input
                  type="time"
                  value={editDueTime}
                  onChange={(e) => setEditDueTime(e.target.value)}
                  style={{ width: '100%', padding: '8px', background: 'var(--bg-input)', border: '1px solid var(--border-subtle)', color: 'var(--text-primary)', borderRadius: 'var(--radius-sm)', fontSize: '12px' }}
                />
              </div>
            </div>

            <div>
              <label style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>
                Description / Notes
              </label>
              <textarea
                value={editDescription}
                onChange={(e) => setEditDescription(e.target.value)}
                placeholder="Optional task details..."
                rows={2}
                style={{
                  width: '100%',
                  padding: '8px 10px',
                  background: 'var(--bg-input)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: 'var(--radius-sm)',
                  color: 'var(--text-primary)',
                  fontSize: '12.5px',
                  resize: 'vertical',
                }}
              />
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '6px' }}>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setEditingTask(null)}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="btn btn-primary"
                disabled={!editTitle.trim()}
              >
                Save Changes
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Project Creation Modal */}
      {showProjectModal && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0,0,0,0.7)',
            backdropFilter: 'blur(3px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 100,
            padding: '16px',
          }}
          onClick={() => setShowProjectModal(false)}
        >
          <div
            className="card"
            style={{ maxWidth: '440px', width: '100%', backgroundColor: 'var(--bg-card)' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="card-header">
              <h3 className="card-title">Create New Project</h3>
              <button
                type="button"
                className="btn btn-secondary"
                style={{ padding: '4px 8px', fontSize: '11px' }}
                onClick={() => setShowProjectModal(false)}
              >
                Close
              </button>
            </div>
            <form onSubmit={handleCreateProjectSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div>
                <label style={{ fontSize: '11.5px', color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>
                  Project Name
                </label>
                <input
                  type="text"
                  placeholder="e.g. Robot Firmware, Learning React..."
                  value={newProjName}
                  onChange={(e) => setNewProjName(e.target.value)}
                  autoFocus
                  required
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    background: 'var(--bg-input)',
                    border: '1px solid var(--border-subtle)',
                    borderRadius: 'var(--radius-sm)',
                    color: 'var(--text-primary)',
                  }}
                />
              </div>

              <div>
                <label style={{ fontSize: '11.5px', color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>
                  Description (optional)
                </label>
                <textarea
                  placeholder="Short goal or description..."
                  value={newProjDesc}
                  onChange={(e) => setNewProjDesc(e.target.value)}
                  rows={2}
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    background: 'var(--bg-input)',
                    border: '1px solid var(--border-subtle)',
                    borderRadius: 'var(--radius-sm)',
                    color: 'var(--text-primary)',
                    resize: 'vertical',
                  }}
                />
              </div>

              <div>
                <label style={{ fontSize: '11.5px', color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>
                  Accent Color
                </label>
                <div style={{ display: 'flex', gap: '8px' }}>
                  {['cyan', 'emerald', 'amber', 'violet', 'blue', 'rose'].map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setNewProjColor(c)}
                      style={{
                        width: '28px',
                        height: '28px',
                        borderRadius: '50%',
                        backgroundColor: `var(--status-${c}, ${c})`,
                        border: newProjColor === c ? '2px solid #fff' : '2px solid transparent',
                        cursor: 'pointer',
                      }}
                      title={c}
                    />
                  ))}
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '8px' }}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setShowProjectModal(false)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={!newProjName.trim()}
                >
                  Create Project
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Project Edit Modal */}
      {showEditProjectModal && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0,0,0,0.7)',
            backdropFilter: 'blur(3px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 100,
            padding: '16px',
          }}
          onClick={() => setShowEditProjectModal(false)}
        >
          <div
            className="card"
            style={{ maxWidth: '440px', width: '100%', backgroundColor: 'var(--bg-card)' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="card-header">
              <h3 className="card-title">Edit Project</h3>
              <button
                type="button"
                className="btn btn-secondary"
                style={{ padding: '4px 8px', fontSize: '11px' }}
                onClick={() => setShowEditProjectModal(false)}
              >
                Close
              </button>
            </div>
            <form onSubmit={handleSaveProjectEdit} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div>
                <label style={{ fontSize: '11.5px', color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>
                  Project Name
                </label>
                <input
                  type="text"
                  value={editProjName}
                  onChange={(e) => setEditProjName(e.target.value)}
                  autoFocus
                  required
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    background: 'var(--bg-input)',
                    border: '1px solid var(--border-subtle)',
                    borderRadius: 'var(--radius-sm)',
                    color: 'var(--text-primary)',
                  }}
                />
              </div>

              <div>
                <label style={{ fontSize: '11.5px', color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>
                  Description
                </label>
                <textarea
                  value={editProjDesc}
                  onChange={(e) => setEditProjDesc(e.target.value)}
                  rows={2}
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    background: 'var(--bg-input)',
                    border: '1px solid var(--border-subtle)',
                    borderRadius: 'var(--radius-sm)',
                    color: 'var(--text-primary)',
                    resize: 'vertical',
                  }}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '8px' }}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setShowEditProjectModal(false)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={!editProjName.trim()}
                >
                  Save Changes
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Main Content Area: Kanban View or List View */}
      {viewMode === 'kanban' ? (
        <div className="card" style={{ padding: '16px' }}>
          <div className="card-header" style={{ marginBottom: '14px' }}>
            <div className="card-title-group">
              <FolderKanban className="card-icon" />
              <div>
                <h3 className="card-title">
                  {activeProject?.name || 'General'} — {activeBoard?.name || 'Main Board'}
                </h3>
                <p className="card-subtitle">
                  {columns.length} workflow columns • {projectTasks.length} total tasks
                </p>
              </div>
            </div>
          </div>

          <KanbanBoard
            columns={columns}
            tasks={projectTasks}
            loading={loading || projectsLoading}
            onToggleTask={onToggleTask}
            onMoveTask={handleMoveTask}
            onEditTask={handleStartEdit}
            onDeleteTask={(t) => setTaskToDelete(t)}
            onQuickAddTask={handleQuickAddFromColumn}
          />
        </div>
      ) : (
        /* List View */
        <div className="card">
          <div className="card-header">
            <div className="card-title-group">
              <FolderKanban className="card-icon" />
              <div>
                <h3 className="card-title">Tasks in {activeProject?.name || 'Selected Project'}</h3>
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
              filteredTasks.map((task) => {
                const isTaskTimerActive = isTaskActive(task.id);
                return (
                  <div
                    key={task.id}
                    className={`task-item ${task.completed ? 'completed' : ''}`}
                    style={
                      isTaskTimerActive
                        ? {
                            borderLeft: `3px solid ${timerStatus === 'running' ? 'var(--status-green)' : 'var(--status-yellow)'}`,
                            backgroundColor:
                              timerStatus === 'running' ? 'rgba(34, 197, 94, 0.05)' : 'rgba(234, 179, 8, 0.05)',
                          }
                        : undefined
                    }
                  >
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

                      {/* Active Normalized Timer Live Indicator */}
                      {isTaskTimerActive && (
                        <div
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '6px',
                            marginTop: '4px',
                            marginBottom: '2px',
                            padding: '2px 8px',
                            borderRadius: 'var(--radius-xs, 4px)',
                            backgroundColor:
                              timerStatus === 'running' ? 'rgba(34, 197, 94, 0.15)' : 'rgba(234, 179, 8, 0.15)',
                            color: timerStatus === 'running' ? 'var(--status-green)' : 'var(--status-yellow)',
                            fontSize: '11px',
                            fontWeight: 600,
                          }}
                        >
                          <TimerIcon
                            size={12}
                            style={{ animation: timerStatus === 'running' ? 'pulse 2s infinite' : 'none' }}
                          />
                          <span className="mono">{formatTimerDuration(elapsedSeconds)}</span>
                          <span style={{ fontSize: '9.5px', textTransform: 'uppercase', opacity: 0.85 }}>
                            {timerStatus === 'running' ? 'TRACKING' : 'PAUSED'}
                          </span>
                        </div>
                      )}

                      <div className="task-meta" style={{ marginTop: '4px' }}>
                        {getPriorityBadge(task.priority)}
                        {renderSyncBadge(task.syncStatus)}
                        <span style={{ textTransform: 'capitalize' }}>Category: {task.category}</span>
                        {task.status && (
                          <span
                            className="badge"
                            style={{
                              fontSize: '10px',
                              padding: '1px 6px',
                              backgroundColor: 'var(--bg-card-hover)',
                              color: 'var(--text-secondary)',
                              textTransform: 'uppercase',
                            }}
                          >
                            {task.status.replace('_', ' ')}
                          </span>
                        )}
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

                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px', alignSelf: 'center', marginLeft: '8px' }}>
                      {/* Timer Actions */}
                      {isTaskTimerActive ? (
                        <>
                          {timerStatus === 'running' ? (
                            <button
                              type="button"
                              className="reminder-action-btn"
                              onClick={() => pauseTimer()}
                              title="Pause timer"
                              style={{ color: 'var(--status-yellow)' }}
                            >
                              <Pause size={13} />
                            </button>
                          ) : (
                            <button
                              type="button"
                              className="reminder-action-btn"
                              onClick={() => resumeTimer()}
                              title="Resume timer"
                              style={{ color: 'var(--status-green)' }}
                            >
                              <Play size={13} />
                            </button>
                          )}
                          <button
                            type="button"
                            className="reminder-action-btn"
                            onClick={() => stopTimer()}
                            title="Stop and log timer"
                            style={{ color: 'var(--status-red)' }}
                          >
                            <Square size={13} />
                          </button>
                        </>
                      ) : !task.completed ? (
                        <button
                          type="button"
                          className="reminder-action-btn"
                          onClick={() => startTimer({ taskId: task.id, projectId: task.projectId })}
                          title="Start timer for this task"
                          style={{ color: 'var(--status-green)' }}
                        >
                          <Play size={13} />
                        </button>
                      ) : null}

                      {onEditTask && (
                        <button
                          type="button"
                          className="reminder-action-btn"
                          onClick={() => handleStartEdit(task)}
                          title="Edit task"
                          style={{ color: 'var(--text-secondary)' }}
                        >
                          <Pencil size={13} />
                        </button>
                      )}
                      {onDeleteTask && (
                        <button
                          type="button"
                          className="reminder-action-btn"
                          onClick={() => setTaskToDelete(task)}
                          title="Delete task"
                          style={{ color: 'var(--status-red)' }}
                        >
                          <Trash2 size={13} />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      {/* Delete Task Confirmation Modal */}
      {taskToDelete && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.75)',
            backdropFilter: 'blur(3px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 100,
            padding: '16px',
          }}
          onClick={() => setTaskToDelete(null)}
        >
          <div
            style={{
              backgroundColor: 'var(--bg-card)',
              border: '1px solid var(--border-color)',
              borderRadius: 'var(--radius-lg)',
              padding: '24px',
              maxWidth: '420px',
              width: '100%',
              boxShadow: '0 20px 40px rgba(0, 0, 0, 0.4)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                marginBottom: '12px',
                color: 'var(--status-red)',
              }}
            >
              <AlertCircle size={20} />
              <h4 style={{ margin: 0, fontSize: '16px', fontWeight: 600 }}>Delete Task?</h4>
            </div>
            <p
              style={{
                fontSize: '13px',
                color: 'var(--text-secondary)',
                marginBottom: '16px',
                lineHeight: 1.5,
              }}
            >
              Are you sure you want to delete{' '}
              <strong style={{ color: 'var(--text-primary)' }}>"{taskToDelete.title}"</strong>? This action cannot be
              undone.
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setTaskToDelete(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn"
                style={{ backgroundColor: 'var(--status-red)', color: '#fff' }}
                onClick={() => {
                  if (onDeleteTask) onDeleteTask(taskToDelete.id);
                  setTaskToDelete(null);
                }}
              >
                Delete Task
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
