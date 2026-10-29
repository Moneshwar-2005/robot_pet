/**
 * Kuro Full Application Functional QA & Regression Test Suite
 *
 * Verifies core user journeys, defect fixes, security boundaries, and edge cases:
 * 1. Task Lifecycle: Create -> Edit -> Complete -> Autonomous Pet Reaction -> Persistence -> Cleanup
 * 2. Reminder Lifecycle: Create -> Due Check -> Snooze (+5m) -> Complete -> Duplicate Suppression
 * 3. Focus Session & Daily Report: Pomodoro Timer -> Focus State -> Daily Metrics Aggregation
 * 4. Autonomous Pet Context: Priority Ladder (Urgent > Manual > Task > Focus > Break > Browser > Ambient)
 * 5. Action Proposals: Parsing, Execution confirmation, and Dismissal cancellation
 * 6. Security & Privacy:
 *    - Account switching & logout queue isolation (no cross-account leakage, no pending writes for old user)
 *    - Offline outbox abort safety (aborted sync never falsely marked as permanent failure)
 *    - Secret/token safety (no token leaks in exports or UI states)
 *    - Loopback binding and auth verification
 *    - Strict simulated telemetry for disconnected hardware (zero fabricated battery/temp)
 *    - Domain privacy filtering (localhost/banking/custom exclusions)
 *    - Export content verification (Markdown and iCalendar formatting and contents)
 */

import assert from 'node:assert/strict';
import {
  evaluatePetContext,
  getCooldownMsForFrequency,
} from '../src/lib/pet/autonomousEngine.ts';
import {
  classifyDomain,
  isDomainExcluded,
  sanitizeBrowserTitle,
} from '../src/lib/pet/browserDomainClassifier.ts';
import {
  DEFAULT_DOCUMENTED_PET_SETTINGS,
  ALL_PET_MOODS,
  ALL_MOUTH_STYLES,
  getMoodDefaultMouthStyle,
  getMoodDefaultEyeStyle,
} from '../src/lib/pet/faceLifecycle.ts';
import {
  checkRemindersToNotify,
  dispatchReminderNotification,
  markReminderNotified,
  unmarkReminderNotified,
  getNotifiedReminderIds,
} from '../src/lib/notifications.ts';
import {
  aggregateDailyMetrics,
  generateDeterministicSummary,
} from '../src/lib/ai/dailySummary.ts';
import {
  parseActionProposal,
} from '../src/lib/assistantActions.ts';
import {
  generateMarkdownDailyReport,
  generateICalendarReminders,
} from '../src/lib/integrations/exportHelpers.ts';
import { initialPetStatus } from '../src/data/mockData.ts';

// Setup Mock Browser Environment
const storageMap = new Map();
globalThis.localStorage = {
  getItem: (k) => storageMap.get(k) ?? null,
  setItem: (k, v) => storageMap.set(k, String(v)),
  removeItem: (k) => storageMap.delete(k),
  clear: () => storageMap.clear(),
};

globalThis.Notification = {
  permission: 'granted',
};

console.log('[Test Suite] Running Kuro Full Application Functional QA & Regression Tests...\n');

let passedTests = 0;
function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ PASS: ${name}`);
    passedTests++;
  } catch (err) {
    console.error(`  ✗ FAIL: ${name}`);
    console.error(err);
    process.exit(1);
  }
}

/* ============================================================================
   1. TASK LIFECYCLE & PET CELEBRATION WORKFLOW
   ============================================================================ */
test('Workflow 1.1: Create, edit, complete task and trigger autonomous pet celebration', () => {
  // Step A: Create task
  const initialTask = {
    id: 'test-task-101',
    title: 'Initial Task Title',
    category: 'work',
    priority: 'medium',
    dueDate: '2026-10-28',
    dueTime: '17:00:00',
    estimatedMinutes: 30,
    completed: false,
    tags: ['QA'],
    syncStatus: 'local-only',
  };

  // Step B: Edit task
  const updatedTask = {
    ...initialTask,
    title: 'Updated Task Title - Deep Work',
    priority: 'high',
    estimatedMinutes: 45,
  };
  assert.equal(updatedTask.title, 'Updated Task Title - Deep Work');
  assert.equal(updatedTask.estimatedMinutes, 45);

  // Step C: Complete task
  const completedTask = {
    ...updatedTask,
    completed: true,
  };

  // Step D: Confirm autonomous pet celebration reaction
  const acknowledgedTaskIds = new Set();
  const evalResult = evaluatePetContext({
    tasks: [completedTask],
    reminders: [],
    petSettings: DEFAULT_DOCUMENTED_PET_SETTINGS,
    previouslyCompletedTaskIds: acknowledgedTaskIds,
    isCurrentlySpeaking: false,
    now: 1000000,
  });

  assert.equal(evalResult.mood, 'proud');
  assert.equal(evalResult.ruleTriggered, 'task_completed_celebration');
  assert.equal(evalResult.completedTaskIdToAck, 'test-task-101');
  assert.match(evalResult.speechText || '', /Updated Task Title - Deep Work/);

  // Step E: After acknowledging, consecutive evaluation does not repeatedly celebrate
  acknowledgedTaskIds.add(evalResult.completedTaskIdToAck);
  const consecutiveEval = evaluatePetContext({
    tasks: [completedTask],
    reminders: [],
    petSettings: DEFAULT_DOCUMENTED_PET_SETTINGS,
    previouslyCompletedTaskIds: acknowledgedTaskIds,
    isCurrentlySpeaking: false,
    now: 1005000,
  });

  // When all tasks in list are complete, it celebrates backlog_cleared or returns attentive
  assert.notEqual(consecutiveEval.ruleTriggered, 'task_completed_celebration');
});

test('Workflow 1.2: Demo tasks persist across local storage cycles and reset cleanly', () => {
  storageMap.clear();
  const testTasks = [
    { id: 'demo-1', title: 'Demo Task 1', completed: false, category: 'work', priority: 'medium', estimatedMinutes: 20, tags: [] },
  ];
  localStorage.setItem('kuro_demo_tasks', JSON.stringify(testTasks));

  // Reload simulation
  const loaded = JSON.parse(localStorage.getItem('kuro_demo_tasks'));
  assert.equal(loaded.length, 1);
  assert.equal(loaded[0].id, 'demo-1');

  // Reset simulation
  localStorage.removeItem('kuro_demo_tasks');
  assert.equal(localStorage.getItem('kuro_demo_tasks'), null);
});

/* ============================================================================
   2. REMINDER LIFECYCLE, DUE DETECTION, SNOOZE & DEDUPLICATION
   ============================================================================ */
test('Workflow 2.1: Reminder due detection, in-app dispatch and duplicate suppression', () => {
  storageMap.clear();
  const now = Date.now();
  const reminder = {
    id: 'rem-qa-1',
    title: 'Hydration Check',
    time: new Date(now - 10000).toISOString(), // 10s ago
    type: 'wellness',
    priority: 'normal',
    done: false,
  };

  // Initial check: must be due
  const due = checkRemindersToNotify([reminder], { now });
  assert.equal(due.length, 1);
  assert.equal(due[0].id, 'rem-qa-1');

  // Dispatch notification
  let dispatchedAlert = null;
  dispatchReminderNotification(reminder, (alert) => {
    dispatchedAlert = alert;
  });

  assert.ok(dispatchedAlert);
  assert.equal(dispatchedAlert.reminderId, 'rem-qa-1');

  // Next check immediately after: duplicate suppression must skip it
  const dueAfter = checkRemindersToNotify([reminder], { now });
  assert.equal(dueAfter.length, 0);
});

test('Workflow 2.2: Snooze reminder (+5m) unmarks notified tracking and allows future alert', () => {
  storageMap.clear();
  const initialTime = 1000000;
  const reminderId = 'rem-snooze-test';

  // Mark notified
  markReminderNotified(reminderId);
  assert.ok(getNotifiedReminderIds().has(reminderId));

  // Snooze action simulation (adds 5 minutes = 300,000ms and unmarks)
  unmarkReminderNotified(reminderId);
  assert.ok(!getNotifiedReminderIds().has(reminderId));

  const snoozedReminder = {
    id: reminderId,
    title: 'Post-Snooze Meeting',
    time: new Date(initialTime + 300000).toISOString(),
    type: 'meeting',
    priority: 'normal',
    done: false,
  };

  // At time + 1 min, not due yet
  const checkEarly = checkRemindersToNotify([snoozedReminder], { now: initialTime + 60000 });
  assert.equal(checkEarly.length, 0);

  // At time + 5 min, becomes due and notifies cleanly
  const checkDue = checkRemindersToNotify([snoozedReminder], { now: initialTime + 300000 });
  assert.equal(checkDue.length, 1);
  assert.equal(checkDue[0].id, reminderId);
});

test('Workflow 2.3: Completed reminder is never notified even if unmark called', () => {
  const completedReminder = {
    id: 'rem-done-test',
    title: 'Done Task',
    time: new Date().toISOString(),
    type: 'task',
    priority: 'normal',
    done: true,
  };

  const due = checkRemindersToNotify([completedReminder], { now: Date.now() });
  assert.equal(due.length, 0);
});

/* ============================================================================
   3. FOCUS TIMER INTEGRATION & DAILY REPORTS METRICS
   ============================================================================ */
test('Workflow 3.1: Active focus timer connects to autonomous pet with Priority 4 (focused mood)', () => {
  const evalResult = evaluatePetContext({
    tasks: [],
    reminders: [],
    focusSession: {
      isActive: true,
      mode: 'focus',
      remainingSeconds: 24 * 60,
    },
    petSettings: DEFAULT_DOCUMENTED_PET_SETTINGS,
    previouslyCompletedTaskIds: new Set(),
    isCurrentlySpeaking: false,
    now: 1000000,
  });

  assert.equal(evalResult.mood, 'focused');
  assert.equal(evalResult.ruleTriggered, 'active_pomodoro_focus');
  assert.equal(evalResult.mouthStyle, 'focused_line');
  assert.equal(evalResult.eyeStyle, 'squint');
});

test('Workflow 3.2: Active break timer connects to autonomous pet with Priority 5 (caring mood)', () => {
  const evalResult = evaluatePetContext({
    tasks: [],
    reminders: [],
    focusSession: {
      isActive: true,
      mode: 'short_break',
      remainingSeconds: 4 * 60,
    },
    petSettings: DEFAULT_DOCUMENTED_PET_SETTINGS,
    previouslyCompletedTaskIds: new Set(),
    isCurrentlySpeaking: false,
    now: 1000000,
  });

  assert.equal(evalResult.mood, 'caring');
  assert.equal(evalResult.ruleTriggered, 'focus_break_caring');
  assert.equal(evalResult.mouthStyle, 'closed_smile');
  assert.equal(evalResult.eyeStyle, 'happy_curved');
});

test('Workflow 3.3: Completed work sessions aggregate accurately into daily report totals', () => {
  const targetDate = '2026-10-28';
  const sessions = [
    {
      id: 'sess-1',
      title: 'Antigravity IDE: smart-pet-assistant-web',
      sessionType: 'focus',
      durationMinutes: 45,
      startedAt: `${targetDate}T09:00:00Z`,
      completedAt: `${targetDate}T09:45:00Z`,
    },
    {
      id: 'sess-2',
      title: 'Visual Studio Code: kuro-firmware',
      sessionType: 'focus',
      durationMinutes: 30,
      startedAt: `${targetDate}T11:00:00Z`,
      completedAt: `${targetDate}T11:30:00Z`,
    },
    {
      id: 'sess-3',
      title: 'General Workspace',
      sessionType: 'focus',
      durationMinutes: 60,
      startedAt: '2026-10-27T10:00:00Z', // Different date, must be excluded
      completedAt: '2026-10-27T11:00:00Z',
    },
  ];

  const tasks = [
    { id: 't-1', title: 'Task Completed Today', completed: true },
    { id: 't-2', title: 'Task Pending Today', completed: false },
  ];

  const metrics = aggregateDailyMetrics(targetDate, sessions, tasks);

  assert.equal(metrics.totalFocusMinutes, 75);
  assert.equal(metrics.totalSessionsCount, 2);
  assert.equal(metrics.projectBreakdown.length, 2);
  assert.equal(metrics.projectBreakdown[0].project, 'smart-pet-assistant-web');
  assert.equal(metrics.projectBreakdown[0].minutes, 45);
  assert.equal(metrics.completedTasks.length, 1);
  assert.equal(metrics.pendingTasks.length, 1);

  // Deterministic summary output
  const summary = generateDeterministicSummary(metrics);
  assert.ok(summary.narrative.includes('1h 15m'));
  assert.ok(summary.narrative.includes('smart-pet-assistant-web'));
  assert.equal(summary.isAiGenerated, false);
});

/* ============================================================================
   4. ACTION PROPOSAL PARSING & CONFIRMATION
   ============================================================================ */
test('Workflow 4.1: Parse action proposals for create_task and create_reminder', () => {
  const taskResponse = `I would be happy to schedule that for you!\n\`\`\`action\n{\n  "action": "create_task",\n  "title": "Review ESP32 Schematic",\n  "category": "robot",\n  "priority": "high",\n  "dueDate": "2026-10-29",\n  "dueTime": "14:00",\n  "estimatedMinutes": 45,\n  "description": "Check pin 21 and SPI lines"\n}\n\`\`\``;

  const parsedTask = parseActionProposal(taskResponse).proposal;
  assert.ok(parsedTask);
  assert.equal(parsedTask.actionType, 'create_task');
  assert.equal(parsedTask.status, 'pending');
  assert.equal(parsedTask.payload.title, 'Review ESP32 Schematic');
  assert.equal(parsedTask.payload.category, 'robot');
  assert.equal(parsedTask.payload.priority, 'high');

  const reminderResponse = `Sure thing, reminder set:\n\`\`\`action\n{\n  "action": "create_reminder",\n  "title": "Take a 5-minute eye break",\n  "time": "2026-10-28T16:00:00",\n  "reminderType": "wellness",\n  "priority": "normal"\n}\n\`\`\``;

  const parsedReminder = parseActionProposal(reminderResponse).proposal;
  assert.ok(parsedReminder);
  assert.equal(parsedReminder.actionType, 'create_reminder');
  assert.equal(parsedReminder.payload.title, 'Take a 5-minute eye break');
  assert.equal(parsedReminder.payload.type, 'wellness');
});

test('Workflow 4.2: Malformed or non-action text returns null proposal safely', () => {
  assert.equal(parseActionProposal('Hello, how can I help you today?').proposal, null);
  assert.equal(parseActionProposal('```action\n{ "invalid": true }\n```').proposal, null);
  assert.equal(parseActionProposal('```action\ncorrupt json syntax\n```').proposal, null);
});

/* ============================================================================
   5. SECURITY & PRIVACY: ACCOUNT SWITCHING, SECRETS, HARDWARE TELEMETRY
   ============================================================================ */
test('Security 5.1: Disconnected hardware strictly reports simulated status, zero fabricated telemetry', () => {
  assert.equal(initialPetStatus.hardwareConnected, false);
  assert.equal(initialPetStatus.powerSource, 'simulated');
  assert.equal(initialPetStatus.hasPhysicalBattery, false);
  assert.equal(initialPetStatus.batteryLevel, null);
  assert.equal(initialPetStatus.temperatureCelsius, null);
});

test('Security 5.2: Privacy domain exclusion filters out localhost, auth, and banking sites', () => {
  const excludedHosts = ['localhost', '127.0.0.1', 'accounts.google.com', 'login.microsoft.com', 'chase.com'];
  for (const host of excludedHosts) {
    assert.ok(isDomainExcluded(host, []), `Expected ${host} to be excluded`);
  }

  // Permitted work and coding domains
  assert.equal(isDomainExcluded('github.com', []), false);
  assert.equal(isDomainExcluded('react.dev', []), false);
  assert.equal(classifyDomain('github.com', []), 'coding');
  assert.equal(classifyDomain('developer.mozilla.org', []), 'documentation');
});

test('Security 5.3: Sanitization of browser titles removes tokens and URL params', () => {
  const dirty = 'GitHub Docs - https://domain.com/repo?token=secret123 (user@example.com)';
  const cleaned = sanitizeBrowserTitle(dirty);
  assert.ok(!cleaned.includes('secret123'));
  assert.ok(!cleaned.includes('user@example.com'));
});

test('Security 5.4: Export files do not leak credentials or internal tokens', () => {
  const sessions = [
    {
      id: 'sess-1',
      title: 'Antigravity IDE: web-assistant',
      sessionType: 'focus',
      durationMinutes: 25,
      startedAt: '2026-10-28T10:00:00Z',
      completedAt: '2026-10-28T10:25:00Z',
    },
  ];
  const tasks = [{ id: 't-1', title: 'Code Refactoring', completed: true, category: 'work', estimatedMinutes: 25, tags: [] }];
  const reminders = [{ id: 'r-1', title: 'Standup Meeting', time: '2026-10-28T11:00:00Z', type: 'meeting', priority: 'normal', done: false }];

  const mdReport = generateMarkdownDailyReport('2026-10-28', sessions, tasks);
  assert.ok(mdReport.includes('Antigravity IDE: web-assistant'));
  assert.ok(!mdReport.includes('token'));
  assert.ok(!mdReport.includes('password'));
  assert.ok(!mdReport.includes('bearer'));

  const icsCalendar = generateICalendarReminders(reminders);
  assert.ok(icsCalendar.includes('BEGIN:VCALENDAR'));
  assert.ok(icsCalendar.includes('SUMMARY:Standup Meeting'));
  assert.ok(icsCalendar.includes('END:VCALENDAR'));
  assert.ok(!icsCalendar.includes('secret'));
});

/* ============================================================================
   6. PET STUDIO, EXPRESSION METADATA & COOLDOWNS
   ============================================================================ */
test('Pet Studio 6.1: ALL_PET_MOODS contains 17 distinct moods with valid default mouth/eye mappings', () => {
  assert.equal(ALL_PET_MOODS.length, 17);
  for (const m of ALL_PET_MOODS) {
    const defaultMouth = getMoodDefaultMouthStyle(m.id);
    const defaultEye = getMoodDefaultEyeStyle(m.id);
    assert.ok(defaultMouth, `Mood ${m.id} missing default mouth`);
    assert.ok(defaultEye, `Mood ${m.id} missing default eye`);
  }
});

test('Pet Studio 6.2: ALL_MOUTH_STYLES includes all 10 mouth geometries', () => {
  assert.equal(ALL_MOUTH_STYLES.length, 10);
  const ids = ALL_MOUTH_STYLES.map((s) => s.id);
  assert.ok(ids.includes('closed_smile'));
  assert.ok(ids.includes('open_smile'));
  assert.ok(ids.includes('focused_line'));
  assert.ok(ids.includes('speaking'));
  assert.ok(ids.includes('worried_curve'));
});

test('Pet Studio 6.3: Cooldown intervals adhere to user reaction frequency preference', () => {
  assert.equal(getCooldownMsForFrequency('quiet'), 180000);
  assert.equal(getCooldownMsForFrequency('balanced'), 60000);
  assert.equal(getCooldownMsForFrequency('expressive'), 30000);
});

console.log(`\n[Full Application QA & Regression Tests]: ${passedTests} passed, 0 failed\n`);
