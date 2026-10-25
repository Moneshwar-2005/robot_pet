/**
 * Assistant Action Proposals and Validation for Kuro.
 * Strictly separates AI proposals from database execution.
 * Only two actions supported: create_task and create_reminder.
 * Never executes writes directly.
 */

import type { TaskPriority, TaskCategory } from '../types';
import { formatLocalDateString } from './formatters';

export interface TaskProposalPayload {
  title: string;
  category: TaskCategory;
  priority: TaskPriority;
  dueDate: string | null;
  dueTime: string | null;
  estimatedMinutes: number;
  description?: string;
}

export interface ReminderProposalPayload {
  title: string;
  time: string; // ISO 8601 string (e.g. 2026-10-26T14:30:00.000Z)
  type: 'wellness' | 'task' | 'meeting' | 'pet-routine';
  priority: 'normal' | 'important';
}

export interface ActionProposal {
  id: string;
  actionType: 'create_task' | 'create_reminder';
  status: 'pending' | 'executing' | 'confirmed' | 'cancelled' | 'error';
  payload: TaskProposalPayload | ReminderProposalPayload;
  errorMsg?: string;
  createdAt: string;
}

export interface ParseActionResult {
  cleanText: string;
  proposal: ActionProposal | null;
}

const VALID_TASK_CATEGORIES: TaskCategory[] = ['work', 'personal', 'robot', 'learning'];
const VALID_TASK_PRIORITIES: TaskPriority[] = ['low', 'medium', 'high', 'urgent'];
const VALID_REMINDER_TYPES = ['wellness', 'task', 'meeting', 'pet-routine'] as const;
const VALID_REMINDER_PRIORITIES = ['normal', 'important'] as const;

/**
 * Validates and sanitizes a proposed Task payload.
 */
function validateTaskPayload(obj: Record<string, unknown>): TaskProposalPayload | null {
  const rawTitle = typeof obj.title === 'string' ? obj.title.trim() : '';
  if (!rawTitle || rawTitle.length > 200) {
    return null;
  }

  const rawCat = typeof obj.category === 'string' ? obj.category.toLowerCase() : '';
  const category: TaskCategory = VALID_TASK_CATEGORIES.includes(rawCat as TaskCategory)
    ? (rawCat as TaskCategory)
    : 'work';

  const rawPriority = typeof obj.priority === 'string' ? obj.priority.toLowerCase() : '';
  const priority: TaskPriority = VALID_TASK_PRIORITIES.includes(rawPriority as TaskPriority)
    ? (rawPriority as TaskPriority)
    : 'medium';

  let dueDate: string | null = null;
  if (typeof obj.dueDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(obj.dueDate.trim())) {
    const parsed = new Date(obj.dueDate.trim() + 'T00:00:00');
    if (!isNaN(parsed.getTime())) {
      dueDate = obj.dueDate.trim();
    }
  }

  let dueTime: string | null = null;
  if (typeof obj.dueTime === 'string') {
    const timeTrim = obj.dueTime.trim();
    const match = timeTrim.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
    if (match) {
      const h = parseInt(match[1], 10);
      const m = parseInt(match[2], 10);
      if (h >= 0 && h < 24 && m >= 0 && m < 60) {
        dueTime = `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
      }
    }
  }

  let estimatedMinutes = 25;
  if (typeof obj.estimatedMinutes === 'number' && obj.estimatedMinutes > 0 && obj.estimatedMinutes <= 480) {
    estimatedMinutes = Math.round(obj.estimatedMinutes);
  } else if (typeof obj.estimatedMinutes === 'string') {
    const parsedMin = parseInt(obj.estimatedMinutes, 10);
    if (!isNaN(parsedMin) && parsedMin > 0 && parsedMin <= 480) {
      estimatedMinutes = parsedMin;
    }
  }

  const description =
    typeof obj.description === 'string' && obj.description.trim().length > 0
      ? obj.description.trim().slice(0, 500)
      : undefined;

  return {
    title: rawTitle,
    category,
    priority,
    dueDate,
    dueTime,
    estimatedMinutes,
    description,
  };
}

/**
 * Validates and sanitizes a proposed Reminder payload.
 */
function validateReminderPayload(obj: Record<string, unknown>): ReminderProposalPayload | null {
  const rawTitle = typeof obj.title === 'string' ? obj.title.trim() : '';
  if (!rawTitle || rawTitle.length > 200) {
    return null;
  }

  const rawTypeProp = obj.reminderType || obj.type || obj.category;
  const rawType = typeof rawTypeProp === 'string' ? rawTypeProp.toLowerCase() : '';
  const type = (VALID_REMINDER_TYPES as readonly string[]).includes(rawType)
    ? (rawType as (typeof VALID_REMINDER_TYPES)[number])
    : 'task';

  const rawPriority = typeof obj.priority === 'string' ? obj.priority.toLowerCase() : '';
  const priority = (VALID_REMINDER_PRIORITIES as readonly string[]).includes(rawPriority)
    ? (rawPriority as (typeof VALID_REMINDER_PRIORITIES)[number])
    : 'normal';

  let isoTime: string | null = null;
  if (typeof obj.time === 'string' && obj.time.trim().length > 0) {
    const trimmed = obj.time.trim();

    // Check if full ISO timestamp
    const parsedTs = Date.parse(trimmed);
    if (!isNaN(parsedTs)) {
      isoTime = new Date(parsedTs).toISOString();
    } else if (/^\d{1,2}:\d{2}/.test(trimmed)) {
      // If time-only (e.g. 15:30), combine with today's local date
      const todayStr = formatLocalDateString();
      const combined = `${todayStr}T${trimmed}`;
      const parsedComb = Date.parse(combined);
      if (!isNaN(parsedComb)) {
        isoTime = new Date(parsedComb).toISOString();
      }
    }
  }

  // If no valid time could be derived, default to 1 hour from now
  if (!isoTime) {
    const oneHourLater = new Date(Date.now() + 60 * 60 * 1000);
    isoTime = oneHourLater.toISOString();
  }

  return {
    title: rawTitle,
    time: isoTime,
    type,
    priority,
  };
}

/**
 * Parses assistant message text for embedded action blocks.
 * Extracts and strictly validates proposals while returning clean conversational text.
 */
export function parseActionProposal(rawText: string): ParseActionResult {
  if (!rawText || typeof rawText !== 'string') {
    return { cleanText: '', proposal: null };
  }

  // Regex looks for ```action ... ``` or ```json { ... "type": "create_task" | "create_reminder" ... } ```
  const blockRegex = /```(?:action|json)?\s*(\{[\s\S]*?"(?:type|action)"\s*:\s*"(?:create_task|create_reminder)"[\s\S]*?\})\s*```/i;
  const match = rawText.match(blockRegex);

  if (!match || !match[1]) {
    return { cleanText: rawText, proposal: null };
  }

  try {
    const parsed = JSON.parse(match[1]);
    if (!parsed || typeof parsed !== 'object') {
      return { cleanText: rawText, proposal: null };
    }

    const isCreateReminder = /"(?:type|action)"\s*:\s*"create_reminder"/i.test(match[1]);
    const isCreateTask = /"(?:type|action)"\s*:\s*"create_task"/i.test(match[1]);

    if (isCreateTask) {
      const payload = validateTaskPayload(parsed);
      if (!payload) {
        return { cleanText: rawText, proposal: null };
      }

      const cleanText = rawText.replace(match[0], '').trim();
      return {
        cleanText: cleanText || 'I have prepared a task proposal for you to confirm below:',
        proposal: {
          id: `prop-task-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          actionType: 'create_task',
          status: 'pending',
          payload,
          createdAt: new Date().toISOString(),
        },
      };
    }

    if (isCreateReminder) {
      const payload = validateReminderPayload(parsed);
      if (!payload) {
        return { cleanText: rawText, proposal: null };
      }

      const cleanText = rawText.replace(match[0], '').trim();
      return {
        cleanText: cleanText || 'I have prepared a reminder proposal for you to confirm below:',
        proposal: {
          id: `prop-rem-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          actionType: 'create_reminder',
          status: 'pending',
          payload,
          createdAt: new Date().toISOString(),
        },
      };
    }

    return { cleanText: rawText, proposal: null };
  } catch {
    // Malformed JSON block - return raw text without executing anything
    return { cleanText: rawText, proposal: null };
  }
}
