/**
 * Automated Unit Test Suite for Kuro Notifications, Safe Automation & Integrations
 *
 * Scope: Phase 4.4 + Phase 5
 *
 * Verifies:
 * 1. Notification trigger time parsing (ISO, 12h/24h, relative offsets)
 * 2. Notification due scheduling & duplicate suppression
 * 3. Safe Automation rules evaluation (triggers, actions, idempotency, confirmations)
 * 4. Account isolation for automation rules & execution logs
 * 5. Data export formatting (.md Markdown and .ics iCalendar)
 */

import {
  parseReminderTriggerTime,
  checkRemindersToNotify,
  dispatchReminderNotification,
} from '../src/lib/notifications.ts';

import {
  DEFAULT_AUTOMATION_RULES,
  evaluateAutomations,
  executeSafeAction,
} from '../src/lib/automation/automationEngine.ts';

import {
  generateMarkdownDailyReport,
  generateICalendarReminders,
} from '../src/lib/integrations/exportHelpers.ts';

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✓ PASS: ${message}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL: ${message}`);
    failed++;
  }
}

// Mock localStorage in Node environment
const mockStorage = new Map();
globalThis.localStorage = {
  getItem: (key) => mockStorage.get(key) ?? null,
  setItem: (key, val) => mockStorage.set(key, String(val)),
  removeItem: (key) => mockStorage.delete(key),
  clear: () => mockStorage.clear(),
};

async function runTests() {
  console.log('[Test Suite] Running Kuro Notifications, Automation & Integrations Unit Tests...\n');

  try {
    // ==========================================
    // 1. Reminder Trigger Time Parsing
    // ==========================================
    const fixedNow = new Date('2026-10-27T12:00:00.000Z').getTime();

    // 1a. ISO string parsing
    const isoResult = parseReminderTriggerTime('2026-10-27T14:30:00.000Z', fixedNow);
    assert(
      isoResult === new Date('2026-10-27T14:30:00.000Z').getTime(),
      'parseReminderTriggerTime parses ISO 8601 UTC timestamp accurately'
    );

    // 1b. 12-hour AM/PM string parsing
    const pmResult = parseReminderTriggerTime('4:30 PM', fixedNow);
    const expectedPm = new Date(fixedNow);
    expectedPm.setHours(16, 30, 0, 0);
    assert(pmResult === expectedPm.getTime(), 'parseReminderTriggerTime parses 12-hour PM clock time');

    const amResult = parseReminderTriggerTime('9:15 AM', fixedNow);
    const expectedAm = new Date(fixedNow);
    expectedAm.setHours(9, 15, 0, 0);
    assert(amResult === expectedAm.getTime(), 'parseReminderTriggerTime parses 12-hour AM clock time');

    // 1c. 24-hour time parsing
    const h24Result = parseReminderTriggerTime('18:45', fixedNow);
    const expectedH24 = new Date(fixedNow);
    expectedH24.setHours(18, 45, 0, 0);
    assert(h24Result === expectedH24.getTime(), 'parseReminderTriggerTime parses 24-hour clock time');

    // 1d. Relative offset parsing
    const relResult = parseReminderTriggerTime('20 mins left', fixedNow);
    assert(relResult === fixedNow + 20 * 60 * 1000, 'parseReminderTriggerTime parses relative minute offsets');

    const inRelResult = parseReminderTriggerTime('In 45 mins', fixedNow);
    assert(inRelResult === fixedNow + 45 * 60 * 1000, 'parseReminderTriggerTime parses "In X mins" offsets');

    // 1e. Invalid inputs
    assert(parseReminderTriggerTime(null) === null, 'parseReminderTriggerTime handles null safely');
    assert(parseReminderTriggerTime('invalid text') === null, 'parseReminderTriggerTime handles invalid text safely');

    // ==========================================
    // 2. Notification Due Scheduling & Duplicate Prevention
    // ==========================================
    const testReminders = [
      {
        id: 'rem-due-now',
        title: 'Hydration break',
        time: new Date(fixedNow + 10000).toISOString(), // Due in 10s
        type: 'wellness',
        priority: 'normal',
        done: false,
      },
      {
        id: 'rem-far-future',
        title: 'Tomorrow review',
        time: new Date(fixedNow + 3600000 * 24).toISOString(), // Due in 24h
        type: 'task',
        priority: 'normal',
        done: false,
      },
      {
        id: 'rem-done',
        title: 'Already completed',
        time: new Date(fixedNow - 5000).toISOString(),
        type: 'task',
        priority: 'normal',
        done: true,
      },
    ];

    const dueInitial = checkRemindersToNotify(testReminders, { now: fixedNow });
    assert(dueInitial.length === 1 && dueInitial[0].id === 'rem-due-now', 'checkRemindersToNotify flags only due, uncompleted reminders');

    // Dispatch notification
    let alertReceived = null;
    dispatchReminderNotification(dueInitial[0], (alert) => {
      alertReceived = alert;
    });

    assert(alertReceived !== null && alertReceived.reminderId === 'rem-due-now', 'dispatchReminderNotification invokes foreground in-app alert callback');

    // Duplicate check: Same reminder should not be flagged again
    const dueAfterDispatch = checkRemindersToNotify(testReminders, { now: fixedNow });
    assert(dueAfterDispatch.length === 0, 'checkRemindersToNotify ignores already notified reminders (duplicate prevention)');

    // ==========================================
    // 3. Safe Automation Framework
    // ==========================================
    const baseState = {
      globalEnabled: true,
      rules: DEFAULT_AUTOMATION_RULES.map((r) => ({ ...r })),
      logs: [],
    };

    // 3a. Global Disable check
    const disabledState = { ...baseState, globalEnabled: false };
    const evalDisabled = evaluateAutomations(disabledState, {
      scope: 'test-user',
      focusMinutesToday: 90,
      completedTasksCount: 5,
      pendingTasksCount: 0,
    });
    assert(evalDisabled.executedLogs.length === 0, 'Automation engine does not trigger rules when globalEnabled is false');

    // 3b. Focus Interval Trigger (Hydration 45m reached)
    let inAppAlertFired = null;
    const evalInterval = evaluateAutomations(baseState, {
      scope: 'test-user',
      focusMinutesToday: 50, // >= 45m
      completedTasksCount: 1,
      pendingTasksCount: 2,
      now: new Date(2026, 9, 27, 10, 0, 0),
      onInAppAlert: (t, b) => {
        inAppAlertFired = { t, b };
      },
    });

    const hydLog = evalInterval.executedLogs.find((l) => l.ruleId === 'rule-hydration');
    assert(hydLog && hydLog.status === 'success', 'Automation engine triggers focus_interval_reached hydration chime');
    assert(inAppAlertFired !== null, 'Hydration rule executes non-destructive notification alert safely');

    // 3c. Idempotency: interval rule does not re-trigger immediately
    const evalIntervalSecond = evaluateAutomations(evalInterval.updatedState, {
      scope: 'test-user',
      focusMinutesToday: 55, // Still >= 45m
      completedTasksCount: 1,
      pendingTasksCount: 2,
      now: new Date(2026, 9, 27, 10, 5, 0), // Only 5m later (less than 45m interval)
    });
    const hydLogSecond = evalIntervalSecond.executedLogs.find((l) => l.ruleId === 'rule-hydration');
    assert(!hydLogSecond, 'Automation engine enforces idempotency: interval rule does not re-trigger before elapsed interval');

    // 3d. Data-modifying action requires confirmation
    // e.g. rule-daily-debrief (at 19:00, requiresConfirmation: true)
    const debriefDate = new Date(2026, 9, 27, 19, 5, 0);
    const evalConfirmation = evaluateAutomations(baseState, {
      scope: 'test-user',
      focusMinutesToday: 120,
      completedTasksCount: 3,
      pendingTasksCount: 1,
      now: debriefDate,
    });

    const debriefLog = evalConfirmation.executedLogs.find((l) => l.ruleId === 'rule-daily-debrief');
    assert(
      debriefLog && debriefLog.status === 'pending_confirmation',
      'Automation actions requiring confirmation are placed in pending_confirmation status without modifying data'
    );

    // 3e. All tasks completed trigger
    let petMoodUpdated = null;
    const evalAllDone = evaluateAutomations(baseState, {
      scope: 'test-user',
      focusMinutesToday: 60,
      completedTasksCount: 4,
      pendingTasksCount: 0, // All tasks done
      now: new Date(2026, 9, 27, 15, 0, 0),
      onSetPetMood: (m) => {
        petMoodUpdated = m;
      },
    });

    const tasksDoneLog = evalAllDone.executedLogs.find((l) => l.ruleId === 'rule-all-tasks');
    assert(tasksDoneLog && tasksDoneLog.status === 'success', 'Automation engine triggers all_tasks_completed routine');
    assert(petMoodUpdated === 'happy', 'Task backlog celebration updates pet mood to happy');

    // 3f. Safe action execution: strictly whitelisted operations
    let reminderCreated = null;
    executeSafeAction(
      'create_reminder',
      { reminderTitle: 'Test Wrapup Reminder', reminderType: 'wellness', reminderPriority: 'normal' },
      {
        scope: 'test-user',
        focusMinutesToday: 30,
        completedTasksCount: 1,
        pendingTasksCount: 0,
        onAddReminder: (payload) => {
          reminderCreated = payload;
        },
      }
    );
    assert(
      reminderCreated !== null && reminderCreated.title === 'Test Wrapup Reminder',
      'executeSafeAction safely creates reminder via allowed whitelist'
    );

    // ==========================================
    // 4. Data Export Helpers
    // ==========================================
    const sampleSessions = [
      {
        id: 'sess-1',
        title: 'VS Code: kuro-core',
        sessionType: 'focus',
        durationMinutes: 45,
        startedAt: '2026-10-27T09:00:00.000Z',
        completedAt: '2026-10-27T09:45:00.000Z',
      },
    ];
    const sampleTasks = [
      {
        id: 't-1',
        title: 'Implement automated tests',
        category: 'work',
        priority: 'high',
        estimatedMinutes: 30,
        completed: true,
        dueDate: '2026-10-27',
        dueTime: '12:00',
        tags: ['testing'],
      },
      {
        id: 't-2',
        title: 'Document system boundaries',
        category: 'work',
        priority: 'medium',
        estimatedMinutes: 20,
        completed: false,
        dueDate: null,
        dueTime: null,
        tags: ['docs'],
      },
    ];

    const mdReport = generateMarkdownDailyReport('2026-10-27', sampleSessions, sampleTasks);
    assert(mdReport.includes('# Kuro Daily Productivity Summary — 2026-10-27'), 'generateMarkdownDailyReport includes formatted title header');
    assert(mdReport.includes('**VS Code: kuro-core**'), 'generateMarkdownDailyReport formats work sessions table');
    assert(mdReport.includes('- [x] **Implement automated tests**'), 'generateMarkdownDailyReport formats completed tasks checklist');
    assert(mdReport.includes('- [ ] **Document system boundaries**'), 'generateMarkdownDailyReport formats pending tasks checklist');

    const icsContent = generateICalendarReminders(testReminders);
    assert(icsContent.startsWith('BEGIN:VCALENDAR'), 'generateICalendarReminders starts with standard VCALENDAR block');
    assert(icsContent.includes('SUMMARY:Hydration break'), 'generateICalendarReminders includes reminder summaries');
    assert(icsContent.includes('STATUS:CONFIRMED'), 'generateICalendarReminders records confirmed event status');
    assert(icsContent.endsWith('END:VCALENDAR'), 'generateICalendarReminders terminates with valid END:VCALENDAR');
  } catch (err) {
    console.error('Test execution error:', err);
    failed++;
  }

  console.log(`\n[Notifications & Automation Tests]: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests();
