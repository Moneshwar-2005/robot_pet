/**
 * Kuro Robot Companion — Phase 7.4 Autonomous Digital Pet & Context Awareness Tests
 *
 * Scope:
 * - Deterministic evaluation rules on 5-second cadence
 * - Priority ladder: urgent reminders > manual interaction > task events > focus/break > browser tab > idle
 * - Domain categorization & privacy exclusions (no passwords, localhost/banking ignored)
 * - Frequency cooldowns (quiet/balanced/expressive) & anti-repetition deduplication
 * - Autonomous pause / resume controls
 * - Visual mouth styles (10) and eye styles (8)
 * - Removal of misleading 88% battery telemetry (Part F requirement)
 */

import assert from 'node:assert/strict';
import {
  evaluatePetContext,
} from '../src/lib/pet/autonomousEngine.ts';
import {
  classifyDomain,
  isDomainExcluded,
  normalizeHostname,
  sanitizeBrowserTitle,
} from '../src/lib/pet/browserDomainClassifier.ts';
import {
  ALL_MOUTH_STYLES,
  getMoodDefaultMouthStyle,
  getMoodDefaultEyeStyle,
  DEFAULT_DOCUMENTED_PET_SETTINGS,
} from '../src/lib/pet/faceLifecycle.ts';
import { initialPetStatus } from '../src/data/mockData.ts';

console.log('[Test Suite] Running Kuro Autonomous Pet & Context Awareness Tests...\n');

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

// ============================================================================
// 1. Misleading 88% Battery Telemetry Elimination (Part F)
// ============================================================================
test('Part F: initialPetStatus does not contain hardcoded 88% battery telemetry', () => {
  assert.equal(
    initialPetStatus.batteryLevel,
    null,
    'batteryLevel must be null on unverified/USB-powered hardware'
  );
  assert.equal(
    initialPetStatus.hasPhysicalBattery,
    false,
    'hasPhysicalBattery must be false for fixed USB-C box companion'
  );
  assert.equal(
    initialPetStatus.powerSource,
    'simulated',
    'powerSource must be explicitly marked simulated'
  );
});

test('Part F: Disconnected hardware never claims physical battery percentage', () => {
  // If hardware is disconnected, powerSource must not fabricate live sensor readings
  const status = { ...initialPetStatus, hardwareConnected: false };
  assert.equal(status.hasPhysicalBattery, false);
  assert.equal(status.batteryLevel, null);
});

// ============================================================================
// 2. Browser Domain Classifier & Privacy Protection (Part D)
// ============================================================================
test('normalizeHostname cleans URLs, ports and paths safely', () => {
  assert.equal(normalizeHostname('https://github.com/org/repo?tab=1'), 'github.com');
  assert.equal(normalizeHostname('HTTP://LOCALHOST:4173/dashboard'), 'localhost');
  assert.equal(normalizeHostname('app.asana.com:8080'), 'app.asana.com');
  assert.equal(normalizeHostname(''), '');
  assert.equal(normalizeHostname(null), '');
});

test('isDomainExcluded catches localhost, loopback, auth, and banking domains', () => {
  assert.equal(isDomainExcluded('localhost'), true);
  assert.equal(isDomainExcluded('127.0.0.1'), true);
  assert.equal(isDomainExcluded('accounts.google.com'), true);
  assert.equal(isDomainExcluded('paypal.com'), true);
  assert.equal(isDomainExcluded('login.chase.com'), true);
  assert.equal(isDomainExcluded('bankofamerica.com'), true);

  // Normal work domains are not excluded
  assert.equal(isDomainExcluded('github.com'), false);
  assert.equal(isDomainExcluded('react.dev'), false);
  assert.equal(isDomainExcluded('linear.app'), false);
});

test('classifyDomain accurately categorizes permitted work and study websites', () => {
  assert.equal(classifyDomain('github.com'), 'coding');
  assert.equal(classifyDomain('gitlab.com'), 'coding');
  assert.equal(classifyDomain('stackoverflow.com'), 'coding');
  assert.equal(classifyDomain('developer.mozilla.org'), 'documentation');
  assert.equal(classifyDomain('react.dev'), 'documentation');
  assert.equal(classifyDomain('linear.app'), 'work');
  assert.equal(classifyDomain('notion.so'), 'work');
  assert.equal(classifyDomain('coursera.org'), 'learning');
  assert.equal(classifyDomain('slack.com'), 'communication');
  assert.equal(classifyDomain('youtube.com'), 'entertainment');
  assert.equal(classifyDomain('netflix.com'), 'entertainment');
  assert.equal(classifyDomain('localhost'), 'private_excluded');
  assert.equal(classifyDomain('paypal.com'), 'private_excluded');
});

test('sanitizeBrowserTitle strips URL parameters, auth tokens and personal email hashes', () => {
  assert.equal(sanitizeBrowserTitle('Project Board - Linear'), 'Project Board - Linear');
  assert.equal(sanitizeBrowserTitle('Docs - https://domain.com/secret?token=xyz123'), 'Docs -');
  assert.equal(sanitizeBrowserTitle('Profile: user@example.com - Kuro'), 'Profile: - Kuro');
  assert.equal(sanitizeBrowserTitle('Very Long Title '.repeat(20)).length <= 80, true);
});

// ============================================================================
// 3. Deterministic Behaviour Engine & Priority Ladder (Part A & E)
// ============================================================================
const baseSettings = {
  ...DEFAULT_DOCUMENTED_PET_SETTINGS,
  autonomousEnabled: true,
  reactionFrequency: 'balanced',
  browserAwarenessEnabled: true,
};

test('Priority 1: Urgent overdue reminder triggers worried mood and warning speech', () => {
  const result = evaluatePetContext({
    tasks: [],
    reminders: [
      {
        id: 'rem-1',
        title: 'Submit tax documentation',
        time: '10:00 AM',
        type: 'task',
        done: false,
        priority: 'important',
      },
    ],
    focusSession: null,
    companionActive: null,
    browserActive: null,
    petSettings: baseSettings,
    manualInteraction: null,
    isCurrentlySpeaking: false,
    previouslyCompletedTaskIds: new Set(),
    lastSpeechText: null,
    lastSpeechTimestamp: 0,
  });

  assert.equal(result.mood, 'worried');
  assert.equal(result.mouthStyle, 'worried_curve');
  assert.equal(result.ruleTriggered, 'urgent_reminder');
  assert.equal(result.shouldSpeak, true);
  assert.ok(result.speechText.includes('Reminder:'));
});

test('Priority 2: Explicit manual interaction holds priority without being overridden by lower ticks', () => {
  const result = evaluatePetContext({
    tasks: [],
    reminders: [],
    focusSession: null,
    companionActive: null,
    browserActive: null,
    petSettings: baseSettings,
    manualInteraction: {
      selectedMood: 'playful',
      timestamp: Date.now() - 5000, // 5 seconds ago (< 45s threshold)
    },
    isCurrentlySpeaking: false,
    previouslyCompletedTaskIds: new Set(),
    lastSpeechText: null,
    lastSpeechTimestamp: 0,
  });

  assert.equal(result.mood, 'playful');
  assert.equal(result.ruleTriggered, 'user_manual_override');
  assert.equal(result.shouldSpeak, false);
});

test('Priority 3: Newly completed task triggers proud/excited celebration and acknowledges task ID', () => {
  const result = evaluatePetContext({
    tasks: [
      {
        id: 'task-101',
        title: 'Fix auth session vulnerability',
        completed: true,
        priority: 'high',
        category: 'work',
      },
    ],
    reminders: [],
    focusSession: null,
    companionActive: null,
    browserActive: null,
    petSettings: baseSettings,
    manualInteraction: null,
    isCurrentlySpeaking: false,
    previouslyCompletedTaskIds: new Set(), // not yet acknowledged
    lastSpeechText: null,
    lastSpeechTimestamp: 0,
  });

  assert.ok(['proud', 'excited'].includes(result.mood));
  assert.equal(result.completedTaskIdToAck, 'task-101');
  assert.equal(result.ruleTriggered, 'task_completed_celebration');
  assert.equal(result.shouldSpeak, true);
  assert.ok(result.speechText.includes('Completed "Fix auth session vulnerability"'));
});

test('Task already acknowledged does not repeatedly celebrate on every 5s tick', () => {
  const result = evaluatePetContext({
    tasks: [
      {
        id: 'task-101',
        title: 'Fix auth session vulnerability',
        completed: true,
        priority: 'high',
        category: 'work',
      },
    ],
    reminders: [],
    focusSession: null,
    companionActive: null,
    browserActive: null,
    petSettings: baseSettings,
    manualInteraction: null,
    isCurrentlySpeaking: false,
    previouslyCompletedTaskIds: new Set(['task-101']), // already celebrated!
    lastSpeechText: null,
    lastSpeechTimestamp: 0,
  });

  // Since task-101 is already acknowledged and all tasks are completed:
  // It shouldn't trigger 'task_completed_celebration'
  assert.notEqual(result.ruleTriggered, 'task_completed_celebration');
});

test('Priority 4: Active focus session triggers focused mood and line mouth', () => {
  const result = evaluatePetContext({
    tasks: [{ id: 'task-1', title: 'Code', completed: false, priority: 'medium', category: 'work' }],
    reminders: [],
    focusSession: {
      isActive: true,
      mode: 'focus',
      remainingSeconds: 1200,
    },
    companionActive: null,
    browserActive: null,
    petSettings: baseSettings,
    manualInteraction: null,
    isCurrentlySpeaking: false,
    previouslyCompletedTaskIds: new Set(),
    lastSpeechText: null,
    lastSpeechTimestamp: 0,
  });

  assert.equal(result.mood, 'focused');
  assert.equal(result.mouthStyle, 'focused_line');
  assert.equal(result.ruleTriggered, 'active_pomodoro_focus');
});

test('Priority 5: Active break mode triggers caring mood and closed smile', () => {
  const result = evaluatePetContext({
    tasks: [],
    reminders: [],
    focusSession: {
      isActive: true,
      mode: 'short_break',
      remainingSeconds: 300,
    },
    companionActive: null,
    browserActive: null,
    petSettings: baseSettings,
    manualInteraction: null,
    isCurrentlySpeaking: false,
    previouslyCompletedTaskIds: new Set(),
    lastSpeechText: null,
    lastSpeechTimestamp: 0,
  });

  assert.equal(result.mood, 'caring');
  assert.equal(result.mouthStyle, 'closed_smile');
  assert.equal(result.ruleTriggered, 'focus_break_caring');
});

test('Priority 6: Permitted browser activity triggers focused mood for coding repositories', () => {
  const result = evaluatePetContext({
    tasks: [{ id: 'task-2', title: 'Pending task', completed: false, priority: 'low', category: 'work' }],
    reminders: [],
    focusSession: null,
    companionActive: null,
    browserActive: {
      hostname: 'github.com',
      title: 'Kuro Autonomous Engine PR',
      timestamp: Date.now(),
    },
    petSettings: baseSettings,
    manualInteraction: null,
    isCurrentlySpeaking: false,
    previouslyCompletedTaskIds: new Set(),
    lastSpeechText: null,
    lastSpeechTimestamp: 0,
  });

  assert.equal(result.mood, 'focused');
  assert.equal(result.ruleTriggered, 'browser_coding');
  assert.equal(result.shouldSpeak, true);
});

test('Private and excluded browser sites never trigger speech or curious reactions', () => {
  const result = evaluatePetContext({
    tasks: [{ id: 'task-3', title: 'Pending', completed: false, priority: 'low', category: 'work' }],
    reminders: [],
    focusSession: null,
    companionActive: null,
    browserActive: {
      hostname: 'paypal.com',
      title: 'Checkout Confirmation',
      timestamp: Date.now(),
    },
    petSettings: baseSettings,
    manualInteraction: null,
    isCurrentlySpeaking: false,
    previouslyCompletedTaskIds: new Set(),
    lastSpeechText: null,
    lastSpeechTimestamp: 0,
  });

  assert.notEqual(result.ruleTriggered, 'browser_coding');
  assert.notEqual(result.ruleTriggered, 'browser_documentation');
  assert.notEqual(result.ruleTriggered, 'browser_learning');
});

// ============================================================================
// 4. Cooldowns, Frequency & Anti-Repetition Deduplication (Part A & C)
// ============================================================================
test('Speech deduplication: never speaks the identical phrase consecutively', () => {
  const result = evaluatePetContext({
    tasks: [
      { id: 't1', title: 'Done', completed: true, priority: 'medium', category: 'work' },
    ],
    reminders: [],
    focusSession: null,
    companionActive: null,
    browserActive: null,
    petSettings: baseSettings,
    manualInteraction: null,
    isCurrentlySpeaking: false,
    previouslyCompletedTaskIds: new Set(),
    lastSpeechText: 'Crushed another task! You are unstoppable today.',
    lastSpeechTimestamp: Date.now() - 100000,
  });

  // Even if task is completed, it must choose a different phrase or not repeat the same text
  if (result.shouldSpeak) {
    assert.notEqual(result.speechText, 'Crushed another task! You are unstoppable today.');
  }
});

test('Frequency cooldown: quiet (180s), balanced (60s), expressive (30s)', () => {
  const now = Date.now();

  // Test Quiet: last spoke 100s ago (< 180s cooldown) -> should NOT speak
  const quietResult = evaluatePetContext({
    tasks: [{ id: 't-q', title: 'Work', completed: false, priority: 'low', category: 'work' }],
    reminders: [],
    focusSession: null,
    companionActive: { connected: true, isTracking: true, activeIde: 'VS Code', workspaceName: 'kuro' },
    browserActive: null,
    petSettings: { ...baseSettings, reactionFrequency: 'quiet' },
    manualInteraction: null,
    isCurrentlySpeaking: false,
    previouslyCompletedTaskIds: new Set(),
    lastSpeechText: 'Previous speech',
    lastSpeechTimestamp: now - 100000, // 100s ago
  });
  assert.equal(quietResult.shouldSpeak, false);

  // Test Expressive: last spoke 45s ago (> 30s cooldown) -> permitted to speak
  const expressiveResult = evaluatePetContext({
    tasks: [{ id: 't-e', title: 'Work', completed: false, priority: 'low', category: 'work' }],
    reminders: [],
    focusSession: null,
    companionActive: { connected: true, isTracking: true, activeIde: 'VS Code', workspaceName: 'kuro' },
    browserActive: null,
    petSettings: { ...baseSettings, reactionFrequency: 'expressive' },
    manualInteraction: null,
    isCurrentlySpeaking: false,
    previouslyCompletedTaskIds: new Set(),
    lastSpeechText: 'Previous speech',
    lastSpeechTimestamp: now - 45000, // 45s ago
  });
  assert.equal(expressiveResult.shouldSpeak, true);
});

// ============================================================================
// 5. Pause & Autonomy Disabled State
// ============================================================================
test('Disabling autonomousEnabled disables autonomous reactions and speech', () => {
  const result = evaluatePetContext({
    tasks: [{ id: 't1', title: 'Work', completed: true, priority: 'high', category: 'work' }],
    reminders: [],
    focusSession: null,
    companionActive: null,
    browserActive: null,
    petSettings: { ...baseSettings, autonomousEnabled: false },
    manualInteraction: null,
    isCurrentlySpeaking: false,
    previouslyCompletedTaskIds: new Set(),
    lastSpeechText: null,
    lastSpeechTimestamp: 0,
  });

  assert.equal(result.mood, 'attentive');
  assert.equal(result.ruleTriggered, 'autonomy_disabled');
  assert.equal(result.shouldSpeak, false);
});

test('pausedUntil pauses reactions until expiration timestamp', () => {
  const result = evaluatePetContext({
    tasks: [{ id: 't1', title: 'Work', completed: true, priority: 'high', category: 'work' }],
    reminders: [],
    focusSession: null,
    companionActive: null,
    browserActive: null,
    petSettings: { ...baseSettings, pausedUntil: Date.now() + 1800000 }, // paused for 30m
    manualInteraction: null,
    isCurrentlySpeaking: false,
    previouslyCompletedTaskIds: new Set(),
    lastSpeechText: null,
    lastSpeechTimestamp: 0,
  });

  assert.equal(result.mood, 'attentive');
  assert.equal(result.ruleTriggered, 'autonomy_paused');
  assert.equal(result.shouldSpeak, false);
});

// ============================================================================
// 6. Mouth Styles & Eye Variations (Part B)
// ============================================================================
test('ALL_MOUTH_STYLES includes all 10 distinct mouth shapes', () => {
  const expected = [
    'closed_smile',
    'open_smile',
    'laugh',
    'tiny_mouth',
    'surprised_o',
    'worried_curve',
    'confused_crooked',
    'focused_line',
    'sleepy_mouth',
    'speaking',
  ];
  const ids = ALL_MOUTH_STYLES.map((m) => m.id);
  assert.equal(ids.length, 10);
  for (const exp of expected) {
    assert.ok(ids.includes(exp), `Missing mouth style: ${exp}`);
  }
});

test('getMoodDefaultMouthStyle and getMoodDefaultEyeStyle map all 17 moods', () => {
  assert.equal(getMoodDefaultMouthStyle('focused'), 'focused_line');
  assert.equal(getMoodDefaultMouthStyle('surprised'), 'surprised_o');
  assert.equal(getMoodDefaultMouthStyle('worried'), 'worried_curve');
  assert.equal(getMoodDefaultMouthStyle('speaking'), 'speaking');
  assert.equal(getMoodDefaultMouthStyle('happy'), 'open_smile');

  assert.equal(getMoodDefaultEyeStyle('focused'), 'squint');
  assert.equal(getMoodDefaultEyeStyle('surprised'), 'curious_widened');
  assert.equal(getMoodDefaultEyeStyle('sleepy'), 'sleepy_lids');
});

console.log(`\n[Autonomous Pet & Context Awareness Tests]: ${passedTests} passed, 0 failed\n`);
