/**
 * Kuro Companion — Kanban Board View Component
 *
 * Scope: Phase 10 Milestone 3 (Projects & Kanban Tasks Integration)
 *
 * Visual Kanban board rendering the 5 canonical workflow columns:
 * 1. Backlog
 * 2. To Do
 * 3. In Progress
 * 4. Done
 * 5. Cancelled
 *
 * Features:
 * - Native HTML5 Drag-and-Drop + quick column move selector for mobile/keyboard accessibility.
 * - Single source of truth: shared task state with List View.
 * - Moving to "Done" automatically updates status, column_id, and completed: true.
 * - Responsive layout with horizontal scrolling and card-based layout.
 */

import React, { useState } from 'react';
import type { Task, BoardColumn, TaskStatusCategory, TaskPriority } from '../../types';
import { formatTaskDeadline } from '../../lib/formatters';
import { useTimer } from '../../context/useTimer';
import { formatTimerDuration } from '../../lib/timerCalculations';
import {
  Plus,
  Check,
  Clock,
  Tag,
  Pencil,
  Trash2,
  MoveRight,
  Inbox,
  ListTodo,
  PlayCircle,
  CheckCircle2,
  XCircle,
  Play,
  Pause,
  Square,
  Timer as TimerIcon,
} from 'lucide-react';

interface KanbanBoardProps {
  columns: BoardColumn[];
  tasks: Task[];
  loading?: boolean;
  onToggleTask: (taskId: string) => void;
  onMoveTask: (
    taskId: string,
    targetColumnId: string,
    newStatus: TaskStatusCategory,
    newPosition?: number
  ) => void;
  onEditTask?: (task: Task) => void;
  onDeleteTask?: (task: Task) => void;
  onQuickAddTask?: (column: BoardColumn) => void;
}

const CATEGORY_META: Record<
  TaskStatusCategory,
  {
    label: string;
    accentColor: string;
    bgBadge: string;
    icon: React.ReactNode;
  }
> = {
  backlog: {
    label: 'Backlog',
    accentColor: 'var(--text-muted, #94a3b8)',
    bgBadge: 'rgba(148, 163, 184, 0.15)',
    icon: <Inbox size={15} />,
  },
  todo: {
    label: 'To Do',
    accentColor: 'var(--status-blue, #38bdf8)',
    bgBadge: 'rgba(56, 189, 248, 0.15)',
    icon: <ListTodo size={15} />,
  },
  in_progress: {
    label: 'In Progress',
    accentColor: 'var(--status-yellow, #f59e0b)',
    bgBadge: 'rgba(245, 158, 11, 0.15)',
    icon: <PlayCircle size={15} />,
  },
  done: {
    label: 'Done',
    accentColor: 'var(--status-green, #22c55e)',
    bgBadge: 'rgba(34, 197, 94, 0.15)',
    icon: <CheckCircle2 size={15} />,
  },
  cancelled: {
    label: 'Cancelled',
    accentColor: 'var(--status-red, #ef4444)',
    bgBadge: 'rgba(239, 68, 68, 0.15)',
    icon: <XCircle size={15} />,
  },
};

export const KanbanBoard: React.FC<KanbanBoardProps> = ({
  columns,
  tasks,
  loading = false,
  onToggleTask,
  onMoveTask,
  onEditTask,
  onDeleteTask,
  onQuickAddTask,
}) => {
  const [dragOverColId, setDragOverColId] = useState<string | null>(null);
  const [draggingTaskId, setDraggingTaskId] = useState<string | null>(null);

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

  // Group tasks by column
  // If task has columnId matching a column, place it there.
  // Otherwise, fallback to status matching the column's statusCategory.
  const columnTaskMap = React.useMemo(() => {
    const map = new Map<string, Task[]>();
    for (const col of columns) {
      map.set(col.id, []);
    }

    for (const task of tasks) {
      let matchedCol = columns.find((c) => c.id === task.columnId);
      if (!matchedCol) {
        // Fallback by status
        matchedCol = columns.find((c) => c.statusCategory === task.status);
      }
      if (!matchedCol) {
        // Fallback: if task completed, place in done column; else todo
        matchedCol = columns.find((c) =>
          task.completed ? c.statusCategory === 'done' : c.statusCategory === 'todo'
        );
      }

      if (matchedCol) {
        const list = map.get(matchedCol.id);
        if (list) list.push(task);
      } else if (columns.length > 0) {
        // Fallback to first column
        const first = map.get(columns[0].id);
        if (first) first.push(task);
      }
    }

    return map;
  }, [columns, tasks]);

  const handleDragStart = (e: React.DragEvent, taskId: string) => {
    e.dataTransfer.setData('text/plain', taskId);
    e.dataTransfer.effectAllowed = 'move';
    setDraggingTaskId(taskId);
  };

  const handleDragEnd = () => {
    setDraggingTaskId(null);
    setDragOverColId(null);
  };

  const handleDragOver = (e: React.DragEvent, colId: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (dragOverColId !== colId) {
      setDragOverColId(colId);
    }
  };

  const handleDragLeave = (colId: string) => {
    if (dragOverColId === colId) {
      setDragOverColId(null);
    }
  };

  const handleDrop = (e: React.DragEvent, targetCol: BoardColumn) => {
    e.preventDefault();
    setDragOverColId(null);
    setDraggingTaskId(null);

    const taskId = e.dataTransfer.getData('text/plain');
    if (!taskId) return;

    onMoveTask(taskId, targetCol.id, targetCol.statusCategory);
  };

  const getPriorityBadge = (priority: TaskPriority) => {
    switch (priority) {
      case 'urgent':
        return <span className="badge badge-urgent" style={{ fontSize: '10px' }}>Urgent</span>;
      case 'high':
        return <span className="badge badge-high" style={{ fontSize: '10px' }}>High</span>;
      case 'medium':
        return <span className="badge badge-medium" style={{ fontSize: '10px' }}>Medium</span>;
      case 'low':
        return <span className="badge badge-low" style={{ fontSize: '10px' }}>Low</span>;
    }
  };

  return (
    <div
      className="kanban-container"
      style={{
        display: 'flex',
        gap: '16px',
        overflowX: 'auto',
        paddingBottom: '16px',
        minHeight: '520px',
        alignItems: 'stretch',
      }}
    >
      {columns.map((col) => {
        const colTasks = columnTaskMap.get(col.id) || [];
        const meta = CATEGORY_META[col.statusCategory] || {
          label: col.name,
          accentColor: 'var(--accent-primary)',
          bgBadge: 'rgba(56, 189, 248, 0.15)',
          icon: <ListTodo size={15} />,
        };
        const isDragOver = dragOverColId === col.id;

        return (
          <div
            key={col.id}
            className="kanban-column"
            style={{
              flex: '1 0 280px',
              maxWidth: '360px',
              minWidth: '270px',
              backgroundColor: isDragOver ? 'var(--bg-card-hover)' : 'var(--bg-card)',
              border: isDragOver
                ? `2px dashed ${meta.accentColor}`
                : '1px solid var(--border-subtle)',
              borderRadius: 'var(--radius-lg)',
              display: 'flex',
              flexDirection: 'column',
              transition: 'all 0.2s ease',
              boxShadow: isDragOver ? '0 8px 24px rgba(0,0,0,0.2)' : 'none',
            }}
            onDragOver={(e) => handleDragOver(e, col.id)}
            onDragLeave={() => handleDragLeave(col.id)}
            onDrop={(e) => handleDrop(e, col)}
          >
            {/* Column Header */}
            <div
              style={{
                padding: '12px 14px',
                borderBottom: '1px solid var(--border-subtle)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                borderTop: `3px solid ${meta.accentColor}`,
                borderTopLeftRadius: 'var(--radius-lg)',
                borderTopRightRadius: 'var(--radius-lg)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ color: meta.accentColor, display: 'flex', alignItems: 'center' }}>
                  {meta.icon}
                </span>
                <span style={{ fontWeight: 600, fontSize: '13.5px', color: 'var(--text-primary)' }}>
                  {col.name}
                </span>
                <span
                  style={{
                    backgroundColor: meta.bgBadge,
                    color: meta.accentColor,
                    fontSize: '11px',
                    fontWeight: 700,
                    padding: '1px 7px',
                    borderRadius: '12px',
                  }}
                >
                  {colTasks.length}
                </span>
              </div>

              {onQuickAddTask && (
                <button
                  type="button"
                  className="btn btn-secondary"
                  style={{ padding: '3px 7px', fontSize: '11px', display: 'flex', alignItems: 'center', gap: '4px' }}
                  onClick={() => onQuickAddTask(col)}
                  title={`Add task to ${col.name}`}
                >
                  <Plus size={12} />
                  <span>Add</span>
                </button>
              )}
            </div>

            {/* Column Body / Cards List */}
            <div
              style={{
                padding: '12px 10px',
                display: 'flex',
                flexDirection: 'column',
                gap: '10px',
                flex: 1,
                overflowY: 'auto',
                minHeight: '200px',
              }}
            >
              {loading && colTasks.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '24px 12px', color: 'var(--text-muted)', fontSize: '12px' }}>
                  Loading...
                </div>
              ) : colTasks.length === 0 ? (
                <div
                  style={{
                    border: '1px dashed var(--border-subtle)',
                    borderRadius: 'var(--radius-md)',
                    padding: '24px 12px',
                    textAlign: 'center',
                    color: 'var(--text-muted)',
                    fontSize: '12px',
                    margin: 'auto 0',
                  }}
                >
                  No tasks in {col.name.toLowerCase()}
                </div>
              ) : (
                colTasks.map((task) => {
                  const isDraggingThis = draggingTaskId === task.id;
                  const isCardTimerActive = isTaskActive(task.id);

                  return (
                    <div
                      key={task.id}
                      draggable
                      onDragStart={(e) => handleDragStart(e, task.id)}
                      onDragEnd={handleDragEnd}
                      className="kanban-card"
                      style={{
                        backgroundColor: 'var(--bg-card-subtle, #1e293b)',
                        border: isCardTimerActive
                          ? `1px solid ${timerStatus === 'running' ? 'var(--status-green)' : 'var(--status-yellow)'}`
                          : '1px solid var(--border-subtle)',
                        boxShadow: isCardTimerActive
                          ? `0 0 10px ${timerStatus === 'running' ? 'rgba(34, 197, 94, 0.25)' : 'rgba(234, 179, 8, 0.25)'}`
                          : 'none',
                        borderRadius: 'var(--radius-md)',
                        padding: '12px',
                        cursor: 'grab',
                        opacity: isDraggingThis ? 0.4 : 1,
                        transition: 'transform 0.15s ease, box-shadow 0.15s ease',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '8px',
                      }}
                    >
                      {/* Card Top Row: Checkbox, Title & Actions */}
                      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px' }}>
                        <button
                          type="button"
                          className={`task-checkbox ${task.completed ? 'checked' : ''}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            onToggleTask(task.id);
                          }}
                          aria-label={`Mark task as ${task.completed ? 'incomplete' : 'complete'}`}
                          style={{ marginTop: '2px', flexShrink: 0 }}
                        >
                          {task.completed && <Check size={12} strokeWidth={3} />}
                        </button>

                        <div style={{ flex: 1 }}>
                          <span
                            style={{
                              fontSize: '13px',
                              fontWeight: 600,
                              color: task.completed ? 'var(--text-muted)' : 'var(--text-primary)',
                              textDecoration: task.completed ? 'line-through' : 'none',
                              lineHeight: 1.35,
                              display: 'block',
                            }}
                          >
                            {task.title}
                          </span>
                        </div>

                        <div style={{ display: 'flex', alignItems: 'center', gap: '2px', flexShrink: 0 }}>
                          {/* Timer Controls on Card */}
                          {isCardTimerActive ? (
                            <>
                              {timerStatus === 'running' ? (
                                <button
                                  type="button"
                                  className="reminder-action-btn"
                                  onClick={() => pauseTimer()}
                                  title="Pause timer"
                                  style={{ padding: '3px', color: 'var(--status-yellow)' }}
                                >
                                  <Pause size={12} />
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  className="reminder-action-btn"
                                  onClick={() => resumeTimer()}
                                  title="Resume timer"
                                  style={{ padding: '3px', color: 'var(--status-green)' }}
                                >
                                  <Play size={12} />
                                </button>
                              )}
                              <button
                                type="button"
                                className="reminder-action-btn"
                                onClick={() => stopTimer()}
                                title="Stop and log timer"
                                style={{ padding: '3px', color: 'var(--status-red)' }}
                              >
                                <Square size={12} />
                              </button>
                            </>
                          ) : !task.completed ? (
                            <button
                              type="button"
                              className="reminder-action-btn"
                              onClick={() => startTimer({ taskId: task.id, projectId: task.projectId })}
                              title="Start timer for this task"
                              style={{ padding: '3px', color: 'var(--status-green)' }}
                            >
                              <Play size={12} />
                            </button>
                          ) : null}

                          {onEditTask && (
                            <button
                              type="button"
                              className="reminder-action-btn"
                              onClick={() => onEditTask(task)}
                              title="Edit task"
                              style={{ padding: '3px', color: 'var(--text-secondary)' }}
                            >
                              <Pencil size={12} />
                            </button>
                          )}
                          {onDeleteTask && (
                            <button
                              type="button"
                              className="reminder-action-btn"
                              onClick={() => onDeleteTask(task)}
                              title="Delete task"
                              style={{ padding: '3px', color: 'var(--status-red)' }}
                            >
                              <Trash2 size={12} />
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Active Normalized Timer Card Indicator */}
                      {isCardTimerActive && (
                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            padding: '3px 8px',
                            borderRadius: 'var(--radius-xs, 4px)',
                            backgroundColor:
                              timerStatus === 'running' ? 'rgba(34, 197, 94, 0.15)' : 'rgba(234, 179, 8, 0.15)',
                            color: timerStatus === 'running' ? 'var(--status-green)' : 'var(--status-yellow)',
                            fontSize: '11px',
                            fontWeight: 600,
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                            <TimerIcon
                              size={12}
                              style={{ animation: timerStatus === 'running' ? 'pulse 2s infinite' : 'none' }}
                            />
                            <span className="mono">{formatTimerDuration(elapsedSeconds)}</span>
                          </div>
                          <span style={{ fontSize: '9px', textTransform: 'uppercase', opacity: 0.85 }}>
                            {timerStatus === 'running' ? 'TRACKING' : 'PAUSED'}
                          </span>
                        </div>
                      )}

                      {/* Optional Description */}
                      {task.description && (
                        <p
                          style={{
                            fontSize: '11.5px',
                            color: 'var(--text-secondary)',
                            margin: 0,
                            lineHeight: 1.4,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            display: '-webkit-box',
                            WebkitLineClamp: 2,
                            WebkitBoxOrient: 'vertical',
                          }}
                        >
                          {task.description}
                        </p>
                      )}

                      {/* Card Metadata Chips */}
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          flexWrap: 'wrap',
                          gap: '6px',
                          fontSize: '11px',
                          color: 'var(--text-muted)',
                        }}
                      >
                        {getPriorityBadge(task.priority)}

                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '3px' }}>
                          <Clock size={10} /> ~{task.estimatedMinutes}m
                        </span>

                        {task.dueDate && (
                          <span>{formatTaskDeadline(task.dueDate, task.dueTime)}</span>
                        )}

                        {task.tags && task.tags.length > 0 && (
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '2px' }}>
                            <Tag size={9} /> {task.tags[0]}
                          </span>
                        )}
                      </div>

                      {/* Quick Move Selector (Keyboard / Mobile accessibility) */}
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          marginTop: '4px',
                          paddingTop: '6px',
                          borderTop: '1px solid var(--border-subtle)',
                        }}
                      >
                        <span
                          style={{
                            fontSize: '10.5px',
                            color: 'var(--text-muted)',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '4px',
                          }}
                        >
                          <MoveRight size={10} /> Move:
                        </span>
                        <select
                          value={col.id}
                          onChange={(e) => {
                            const target = columns.find((c) => c.id === e.target.value);
                            if (target) {
                              onMoveTask(task.id, target.id, target.statusCategory);
                            }
                          }}
                          style={{
                            fontSize: '10.5px',
                            padding: '2px 6px',
                            background: 'var(--bg-input)',
                            border: '1px solid var(--border-subtle)',
                            color: 'var(--text-secondary)',
                            borderRadius: 'var(--radius-sm)',
                            cursor: 'pointer',
                          }}
                        >
                          {columns.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.name}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
};
