import React, { useState } from 'react';
import {
  CheckSquare,
  Bell,
  Check,
  X,
  Loader2,
  Calendar,
  Clock,
  Tag,
  AlertCircle,
  ExternalLink,
  ShieldCheck,
} from 'lucide-react';
import type { ActionProposal, TaskProposalPayload, ReminderProposalPayload } from '../../lib/assistantActions';
import { formatDateDisplay } from '../../lib/formatters';

interface ActionProposalCardProps {
  proposal: ActionProposal;
  onConfirm: (proposal: ActionProposal) => Promise<void>;
  onCancel: (proposal: ActionProposal) => void;
  isAuthUser: boolean;
  userEmail?: string | null;
  onNavigate?: (page: 'tasks' | 'reminders') => void;
}

export const ActionProposalCard: React.FC<ActionProposalCardProps> = ({
  proposal,
  onConfirm,
  onCancel,
  isAuthUser,
  userEmail,
  onNavigate,
}) => {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const isTask = proposal.actionType === 'create_task';
  const taskPayload = isTask ? (proposal.payload as TaskProposalPayload) : null;
  const remPayload = !isTask ? (proposal.payload as ReminderProposalPayload) : null;

  const handleConfirm = async () => {
    if (isSubmitting || proposal.status !== 'pending') return;
    setIsSubmitting(true);
    setLocalError(null);

    try {
      await onConfirm(proposal);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to execute proposed action.';
      setLocalError(msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCancel = () => {
    if (isSubmitting) return;
    onCancel(proposal);
  };

  const renderStatusBadge = () => {
    switch (proposal.status) {
      case 'confirmed':
        return (
          <span
            style={{
              fontSize: '11px',
              padding: '2px 8px',
              borderRadius: 'var(--radius-sm)',
              backgroundColor: 'rgba(34, 197, 94, 0.15)',
              color: 'var(--status-green)',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              fontWeight: 500,
            }}
          >
            <Check size={12} /> Confirmed
          </span>
        );
      case 'cancelled':
        return (
          <span
            style={{
              fontSize: '11px',
              padding: '2px 8px',
              borderRadius: 'var(--radius-sm)',
              backgroundColor: 'var(--bg-card-hover)',
              color: 'var(--text-muted)',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
            }}
          >
            <X size={12} /> Cancelled
          </span>
        );
      case 'error':
        return (
          <span
            style={{
              fontSize: '11px',
              padding: '2px 8px',
              borderRadius: 'var(--radius-sm)',
              backgroundColor: 'rgba(239, 68, 68, 0.15)',
              color: 'var(--status-red)',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
            }}
          >
            <AlertCircle size={12} /> Failed
          </span>
        );
      case 'executing':
        return (
          <span
            style={{
              fontSize: '11px',
              padding: '2px 8px',
              borderRadius: 'var(--radius-sm)',
              backgroundColor: 'rgba(59, 130, 246, 0.15)',
              color: 'var(--accent-primary)',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
            }}
          >
            <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} /> Creating...
          </span>
        );
      case 'pending':
      default:
        return (
          <span
            style={{
              fontSize: '11px',
              padding: '2px 8px',
              borderRadius: 'var(--radius-sm)',
              backgroundColor: 'rgba(234, 179, 8, 0.15)',
              color: 'var(--status-yellow)',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              fontWeight: 500,
            }}
          >
            Requires Confirmation
          </span>
        );
    }
  };

  return (
    <div
      style={{
        marginTop: '12px',
        backgroundColor: 'var(--bg-card)',
        border: '1px solid var(--border-subtle)',
        borderRadius: 'var(--radius-md)',
        overflow: 'hidden',
        boxShadow: 'var(--shadow-sm)',
      }}
    >
      {/* Proposal Header */}
      <div
        style={{
          padding: '10px 14px',
          borderBottom: '1px solid var(--border-subtle)',
          backgroundColor: 'var(--bg-card-subtle)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {isTask ? (
            <CheckSquare size={15} style={{ color: 'var(--accent-primary)' }} />
          ) : (
            <Bell size={15} style={{ color: 'var(--accent-primary)' }} />
          )}
          <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-primary)' }}>
            {isTask ? 'Proposed Task Creation' : 'Proposed Reminder Creation'}
          </span>
        </div>

        {renderStatusBadge()}
      </div>

      {/* Proposal Body */}
      <div style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
        <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)' }}>
          {isTask ? taskPayload?.title : remPayload?.title}
        </div>

        {/* Task Details */}
        {isTask && taskPayload && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', fontSize: '12px', color: 'var(--text-secondary)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              <Calendar size={13} style={{ color: 'var(--text-muted)' }} />
              <span>
                {taskPayload.dueDate ? formatDateDisplay(taskPayload.dueDate) : 'No due date'}
                {taskPayload.dueTime ? ` at ${taskPayload.dueTime}` : ''}
              </span>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              <Clock size={13} style={{ color: 'var(--text-muted)' }} />
              <span>{taskPayload.estimatedMinutes}m estimate</span>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              <Tag size={13} style={{ color: 'var(--text-muted)' }} />
              <span style={{ textTransform: 'capitalize' }}>
                {taskPayload.priority} priority • {taskPayload.category}
              </span>
            </div>

            {taskPayload.description && (
              <div
                style={{
                  width: '100%',
                  marginTop: '4px',
                  padding: '6px 10px',
                  borderRadius: 'var(--radius-sm)',
                  backgroundColor: 'var(--bg-card-subtle)',
                  border: '1px solid var(--border-subtle)',
                  fontSize: '11.5px',
                  color: 'var(--text-secondary)',
                }}
              >
                {taskPayload.description}
              </div>
            )}
          </div>
        )}

        {/* Reminder Details */}
        {!isTask && remPayload && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', fontSize: '12px', color: 'var(--text-secondary)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              <Calendar size={13} style={{ color: 'var(--text-muted)' }} />
              <span>
                {(() => {
                  try {
                    const d = new Date(remPayload.time);
                    return `${d.toLocaleDateString()} at ${d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
                  } catch {
                    return remPayload.time;
                  }
                })()}
              </span>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              <Tag size={13} style={{ color: 'var(--text-muted)' }} />
              <span style={{ textTransform: 'capitalize' }}>
                {remPayload.priority} priority • {remPayload.type}
              </span>
            </div>
          </div>
        )}

        {/* Ownership & Safety Notice */}
        <div
          style={{
            marginTop: '4px',
            padding: '6px 10px',
            borderRadius: 'var(--radius-sm)',
            backgroundColor: 'var(--bg-card-subtle)',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            fontSize: '11px',
            color: 'var(--text-muted)',
          }}
        >
          <ShieldCheck size={13} style={{ color: isAuthUser ? 'var(--status-green)' : 'var(--text-muted)' }} />
          <span>
            {isAuthUser
              ? `Will be saved to authenticated account (${userEmail || 'Connected'}).`
              : 'Will be saved locally in demo mode (Unauthenticated).'}
          </span>
        </div>

        {/* Error notification if execution failed */}
        {(localError || proposal.errorMsg) && (
          <div
            style={{
              padding: '6px 10px',
              borderRadius: 'var(--radius-sm)',
              backgroundColor: 'rgba(239, 68, 68, 0.1)',
              border: '1px solid rgba(239, 68, 68, 0.3)',
              color: 'var(--status-red)',
              fontSize: '11.5px',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            <AlertCircle size={13} style={{ flexShrink: 0 }} />
            <span>{localError || proposal.errorMsg}</span>
          </div>
        )}

        {/* Actions bar */}
        {proposal.status === 'pending' && (
          <div
            style={{
              marginTop: '6px',
              paddingTop: '8px',
              borderTop: '1px solid var(--border-subtle)',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
            }}
          >
            <button
              type="button"
              className="btn btn-primary"
              style={{ padding: '6px 14px', fontSize: '12px' }}
              onClick={handleConfirm}
              disabled={isSubmitting}
            >
              {isSubmitting ? (
                <>
                  <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} />
                  <span>Creating...</span>
                </>
              ) : (
                <>
                  <Check size={13} />
                  <span>Confirm & Create {isTask ? 'Task' : 'Reminder'}</span>
                </>
              )}
            </button>

            <button
              type="button"
              className="btn btn-secondary"
              style={{ padding: '6px 12px', fontSize: '12px' }}
              onClick={handleCancel}
              disabled={isSubmitting}
            >
              <X size={13} />
              <span>Cancel</span>
            </button>
          </div>
        )}

        {proposal.status === 'confirmed' && onNavigate && (
          <div
            style={{
              marginTop: '4px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              fontSize: '11.5px',
            }}
          >
            <span style={{ color: 'var(--status-green)' }}>
              {isTask ? 'Task added to your list.' : 'Reminder set successfully.'}
            </span>
            <button
              type="button"
              className="btn btn-secondary"
              style={{ padding: '4px 8px', fontSize: '11px', display: 'flex', alignItems: 'center', gap: '4px' }}
              onClick={() => onNavigate(isTask ? 'tasks' : 'reminders')}
            >
              <span>View in {isTask ? 'Tasks' : 'Reminders'}</span>
              <ExternalLink size={11} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
