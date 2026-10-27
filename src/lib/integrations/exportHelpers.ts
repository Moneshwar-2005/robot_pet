/**
 * Local Data Export Helpers for Kuro Integrations
 *
 * Scope: Phase 5 Useful Local Integrations
 *
 * Provides genuine, client-side, offline export functionality:
 * - Markdown (.md) vault export for Obsidian / Logseq
 * - Standard iCalendar (.ics) export for Google Calendar, Apple Calendar, Outlook
 * - Zero external API keys or network dependencies
 */

import type { Reminder, Task } from '../../types';
import type { ClientWorkSession } from '../adapters';

/**
 * Generates an Obsidian / Logseq compatible Markdown document summarizing daily work.
 */
export function generateMarkdownDailyReport(
  dateStr: string,
  sessions: ClientWorkSession[],
  tasks: Task[]
): string {
  const totalMinutes = sessions.reduce((sum, s) => sum + (s.durationMinutes || 0), 0);
  const hours = (totalMinutes / 60).toFixed(1);
  const completedTasks = tasks.filter((t) => t.completed);
  const pendingTasks = tasks.filter((t) => !t.completed);

  let md = `# Kuro Daily Productivity Summary — ${dateStr}\n\n`;
  md += `> **Generated locally by Kuro Personal Assistant**\n`;
  md += `> Date: ${dateStr} | Total Focus: ${hours}h (${totalMinutes}m) | Completed Tasks: ${completedTasks.length}/${tasks.length}\n\n`;

  md += `## ⏱️ Focus Sessions\n\n`;
  if (sessions.length === 0) {
    md += `_No focus sessions recorded for this date._\n\n`;
  } else {
    md += `| IDE / Context | Duration | Started | Completed |\n`;
    md += `| :--- | :--- | :--- | :--- |\n`;
    for (const sess of sessions) {
      const start = sess.startedAt ? new Date(sess.startedAt).toLocaleTimeString() : 'N/A';
      const end = sess.completedAt ? new Date(sess.completedAt).toLocaleTimeString() : 'N/A';
      md += `| **${sess.title}** | ${sess.durationMinutes}m | ${start} | ${end} |\n`;
    }
    md += `\n`;
  }

  md += `## ✅ Completed Tasks\n\n`;
  if (completedTasks.length === 0) {
    md += `_No tasks marked complete on this date._\n\n`;
  } else {
    for (const t of completedTasks) {
      md += `- [x] **${t.title}** (${t.category}) — Est: ${t.estimatedMinutes}m\n`;
    }
    md += `\n`;
  }

  md += `## 📋 Pending Tasks & Next Steps\n\n`;
  if (pendingTasks.length === 0) {
    md += `_All tasks completed! Ready for new objectives._\n\n`;
  } else {
    for (const t of pendingTasks) {
      md += `- [ ] **${t.title}** [Priority: ${t.priority}] — Est: ${t.estimatedMinutes}m\n`;
    }
    md += `\n`;
  }

  md += `---\n*Saved from Kuro Personal Assistant Web Client*\n`;
  return md;
}

/**
 * Generates standard RFC 5545 iCalendar (.ics) string for reminders.
 */
export function generateICalendarReminders(reminders: Reminder[]): string {
  const now = new Date();
  const nowStamp = now.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';

  let ics = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Kuro Smart Pet Assistant//Kuro Reminders 1.0//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:Kuro Reminders',
    'X-WR-TIMEZONE:UTC',
  ];

  for (const r of reminders) {
    const triggerDate = r.time && r.time.includes('T') ? new Date(r.time) : new Date();
    const dtStart = isNaN(triggerDate.getTime())
      ? nowStamp
      : triggerDate.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';

    const endEpoch = (isNaN(triggerDate.getTime()) ? now.getTime() : triggerDate.getTime()) + 15 * 60 * 1000;
    const dtEnd = new Date(endEpoch).toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';

    const uid = `kuro-${r.id}-${Date.now()}@kuro.assistant`;
    const summary = r.title.replace(/[\r\n]/g, ' ');
    const desc = `Kuro Reminder (${r.type}) - Priority: ${r.priority} - Status: ${r.done ? 'Done' : 'Pending'}`;

    ics.push(
      'BEGIN:VEVENT',
      `UID:${uid}`,
      `DTSTAMP:${nowStamp}`,
      `DTSTART:${dtStart}`,
      `DTEND:${dtEnd}`,
      `SUMMARY:${summary}`,
      `DESCRIPTION:${desc}`,
      `STATUS:${r.done ? 'COMPLETED' : 'CONFIRMED'}`,
      'END:VEVENT'
    );
  }

  ics.push('END:VCALENDAR');
  return ics.join('\r\n');
}

/**
 * Triggers a client-side file download via Blob.
 */
export function downloadTextBlob(filename: string, content: string, mimeType: string): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}
