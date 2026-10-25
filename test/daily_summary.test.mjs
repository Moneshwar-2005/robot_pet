/**
 * Unit Test Suite for Kuro Daily Productivity Summary Engine
 * (Phase 4, Step 4.3)
 *
 * Run with: node --experimental-strip-types test/daily_summary.test.mjs
 */

import assert from 'node:assert';
import {
  parseSessionTitle,
  formatYMD,
  aggregateDailyMetrics,
  generateDeterministicSummary,
  generateAiDailySummary,
} from '../src/lib/ai/dailySummary.ts';

let passCount = 0;
let failCount = 0;

function it(description, fn) {
  try {
    fn();
    console.log(`  ✓ PASS: ${description}`);
    passCount++;
  } catch (err) {
    console.error(`  ✗ FAIL: ${description}`);
    console.error(err);
    failCount++;
  }
}

async function itAsync(description, fn) {
  try {
    await fn();
    console.log(`  ✓ PASS: ${description}`);
    passCount++;
  } catch (err) {
    console.error(`  ✗ FAIL: ${description}`);
    console.error(err);
    failCount++;
  }
}

console.log('[Test Suite] Running Kuro Daily Summary Engine Unit Tests...');

// 1. parseSessionTitle
it('parseSessionTitle parses standard IDE: project string', () => {
  const result = parseSessionTitle('Antigravity IDE: smart-pet-assistant-web');
  assert.strictEqual(result.ide, 'Antigravity IDE');
  assert.strictEqual(result.project, 'smart-pet-assistant-web');
});

it('parseSessionTitle handles missing colon or empty title safely', () => {
  const r1 = parseSessionTitle('SoloWorkspace');
  assert.strictEqual(r1.ide, 'General');
  assert.strictEqual(r1.project, 'SoloWorkspace');

  const r2 = parseSessionTitle('');
  assert.strictEqual(r2.ide, 'General');
  assert.strictEqual(r2.project, 'General Workspace');
});

// 2. formatYMD
it('formatYMD formats Date into YYYY-MM-DD', () => {
  const d = new Date(2026, 9, 25); // Oct is month index 9
  assert.strictEqual(formatYMD(d), '2026-10-25');
});

// 3. aggregateDailyMetrics
const mockSessions = [
  {
    id: 's1',
    title: 'Antigravity IDE: smart-pet-assistant-web',
    durationMinutes: 45,
    startedAt: '2026-10-25T10:00:00.000Z',
    completedAt: '2026-10-25T10:45:00.000Z',
    sessionType: 'focus',
    createdAt: '2026-10-25T10:00:00.000Z',
  },
  {
    id: 's2',
    title: 'Visual Studio Code: kuro-core',
    durationMinutes: 30,
    startedAt: '2026-10-25T14:00:00.000Z',
    completedAt: '2026-10-25T14:30:00.000Z',
    sessionType: 'focus',
    createdAt: '2026-10-25T14:00:00.000Z',
  },
  {
    id: 's3',
    title: 'Antigravity IDE: smart-pet-assistant-web',
    durationMinutes: 25,
    startedAt: '2026-10-25T16:00:00.000Z',
    completedAt: '2026-10-25T16:25:00.000Z',
    sessionType: 'focus',
    createdAt: '2026-10-25T16:00:00.000Z',
  },
  // Session on a different date (should be filtered out)
  {
    id: 's4',
    title: 'Visual Studio Code: other-project',
    durationMinutes: 60,
    startedAt: '2026-10-24T12:00:00.000Z',
    completedAt: '2026-10-24T13:00:00.000Z',
    sessionType: 'focus',
    createdAt: '2026-10-24T12:00:00.000Z',
  },
];

const mockTasks = [
  {
    id: 't1',
    title: 'Fix companion reconnect loop',
    completed: true,
    created_at: '2026-10-25T08:00:00.000Z',
  },
  {
    id: 't2',
    title: 'Design daily summary view',
    completed: true,
    created_at: '2026-10-25T11:00:00.000Z',
  },
  {
    id: 't3',
    title: 'Phase 5 hardware design',
    completed: false,
    created_at: '2026-10-25T15:00:00.000Z',
  },
];

it('aggregateDailyMetrics filters sessions strictly to target date and aggregates total minutes', () => {
  const metrics = aggregateDailyMetrics('2026-10-25', mockSessions, mockTasks);
  assert.strictEqual(metrics.date, '2026-10-25');
  assert.strictEqual(metrics.totalSessionsCount, 3);
  assert.strictEqual(metrics.totalFocusMinutes, 100); // 45 + 30 + 25
});

it('aggregateDailyMetrics calculates project breakdowns accurately and sorts by duration', () => {
  const metrics = aggregateDailyMetrics('2026-10-25', mockSessions, mockTasks);
  assert.strictEqual(metrics.projectBreakdown.length, 2);
  // smart-pet-assistant-web: 70 min, kuro-core: 30 min
  assert.strictEqual(metrics.projectBreakdown[0].project, 'smart-pet-assistant-web');
  assert.strictEqual(metrics.projectBreakdown[0].minutes, 70);
  assert.strictEqual(metrics.projectBreakdown[0].sessionCount, 2);

  assert.strictEqual(metrics.projectBreakdown[1].project, 'kuro-core');
  assert.strictEqual(metrics.projectBreakdown[1].minutes, 30);
});

it('aggregateDailyMetrics aggregates IDE metrics properly', () => {
  const metrics = aggregateDailyMetrics('2026-10-25', mockSessions, mockTasks);
  assert.strictEqual(metrics.ideBreakdown.length, 2);
  assert.strictEqual(metrics.ideBreakdown[0].ide, 'Antigravity IDE');
  assert.strictEqual(metrics.ideBreakdown[0].minutes, 70);
  assert.strictEqual(metrics.ideBreakdown[1].ide, 'Visual Studio Code');
  assert.strictEqual(metrics.ideBreakdown[1].minutes, 30);
});

it('aggregateDailyMetrics separates completed and pending tasks', () => {
  const metrics = aggregateDailyMetrics('2026-10-25', mockSessions, mockTasks);
  assert.strictEqual(metrics.completedTasks.length, 2);
  assert.strictEqual(metrics.pendingTasks.length, 1);
  assert.strictEqual(metrics.hasIncompleteData, false);
});

it('aggregateDailyMetrics flags hasIncompleteData when session duration is incomplete', () => {
  const incompleteSessions = [
    {
      id: 'si1',
      title: 'Antigravity IDE: incomplete-work',
      durationMinutes: 0,
      startedAt: '2026-10-25T10:00:00.000Z',
      completedAt: null,
      sessionType: 'focus',
      createdAt: '2026-10-25T10:00:00.000Z',
    },
  ];
  const metrics = aggregateDailyMetrics('2026-10-25', incompleteSessions, []);
  assert.strictEqual(metrics.hasIncompleteData, true);
});

// 4. generateDeterministicSummary
it('generateDeterministicSummary generates clear quantitative narrative and recommendations', () => {
  const metrics = aggregateDailyMetrics('2026-10-25', mockSessions, mockTasks);
  const summary = generateDeterministicSummary(metrics);
  assert.strictEqual(summary.isAiGenerated, false);
  assert.ok(summary.narrative.includes('1h 40m'), 'Mentions formatted focus time');
  assert.ok(summary.narrative.includes('smart-pet-assistant-web'), 'Mentions top project');
  assert.ok(summary.narrative.includes('Fix companion reconnect loop'), 'Mentions completed task');
  assert.ok(summary.recommendations.length > 0, 'Provides recommendations');
});

// 5. generateAiDailySummary fallback
await itAsync('generateAiDailySummary falls back to deterministic summary when provider is null', async () => {
  const metrics = aggregateDailyMetrics('2026-10-25', mockSessions, mockTasks);
  const result = await generateAiDailySummary(metrics, null);
  assert.strictEqual(result.isAiGenerated, false);
  assert.strictEqual(result.fallbackReason, 'No local AI provider available');
  assert.ok(result.narrative.length > 0);
});

await itAsync('generateAiDailySummary falls back cleanly when provider stream fails', async () => {
  const mockFailingProvider = {
    id: 'ollama',
    name: 'Ollama',
    checkStatus: async () => ({ state: 'connected', activeModel: 'test-model' }),
    isModelLoaded: true,
    lifecycleState: 'ready',
    activeModel: 'test-model',
    async sendChatStream() {
      throw new Error('Connection refused to localhost:11434');
    },
  };
  const metrics = aggregateDailyMetrics('2026-10-25', mockSessions, mockTasks);
  const result = await generateAiDailySummary(metrics, mockFailingProvider);
  assert.strictEqual(result.isAiGenerated, false);
  assert.ok(result.fallbackReason.includes('Connection refused'));
  assert.ok(result.narrative.includes('1h 40m'));
});

console.log(`\n[Daily Summary Tests]: ${passCount} passed, ${failCount} failed\n`);
if (failCount > 0) process.exit(1);
