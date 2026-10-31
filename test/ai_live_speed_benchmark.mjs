/**
 * Kuro Companion — Phase 8.5B Live AI Response Speed Benchmark
 *
 * Runs 10 representative user prompts against local Ollama running qwen2.5:3b.
 * Measures:
 * - Model discovery (cold vs cached)
 * - Memory retrieval time
 * - Context preparation time
 * - Cold prompt latency (model loading / VRAM init)
 * - Warm prompt latencies
 * - Time to First Token (TTFT)
 * - Total duration & token evaluation rate (tokens/sec)
 * - Action proposal parsing
 */

import { sendOllamaChatStream, checkOllamaConnection, clearOllamaDiscoveryCache } from '../src/lib/ollama.ts';
import { buildSystemPrompt } from '../src/lib/ai/assistantPrompt.ts';
import { parseActionProposal } from '../src/lib/assistantActions.ts';

const OLLAMA_BASE_URL = 'http://localhost:11434';
const MODEL = 'qwen2.5:3b';

const REPRESENTATIVE_PROMPTS = [
  { id: 1, type: 'greeting', prompt: 'Hello Kuro! What can you help me with today?' },
  { id: 2, type: 'task_action', prompt: 'Create a task to review the pull request #42 by 3 PM today.' },
  { id: 3, type: 'reminder_action', prompt: 'Set a reminder for my focus stretch in 30 minutes.' },
  { id: 4, type: 'wellness', prompt: "I'm feeling a bit tired after coding for two hours. What should I do?" },
  { id: 5, type: 'planning', prompt: 'Can you give me a recommended work schedule for tomorrow morning?' },
  { id: 6, type: 'hardware', prompt: 'How do I configure my ESP32-S3 Wi-Fi connection with the Kuro control center?' },
  { id: 7, type: 'preference', prompt: 'I prefer working in 45-minute focus sprints with 10-minute breaks. Please note that.' },
  { id: 8, type: 'status_inquiry', prompt: 'What is the best way to track my daily coding milestones in Kuro?' },
  { id: 9, type: 'ergonomics', prompt: 'Give me three quick tips to avoid eye strain while working on a laptop.' },
  { id: 10, type: 'playfulness', prompt: 'Tell me a short 2-sentence encouraging joke or pet quip to boost my focus.' },
];

const MOCK_ACTIVE_MEMORIES = [
  { id: 'm1', userId: 'bench-user', category: 'work_pattern', fact: 'User works best in 45-minute focus intervals.', confidence: 0.95, createdAt: new Date().toISOString() },
  { id: 'm2', userId: 'bench-user', category: 'preference', fact: 'User prefers dark mode and emerald glow aesthetics.', confidence: 0.9, createdAt: new Date().toISOString() },
  { id: 'm3', userId: 'bench-user', category: 'hardware', fact: 'User has an ESP32-S3 box companion with 2.4-inch TFT display.', confidence: 0.85, createdAt: new Date().toISOString() },
];

async function runBenchmark() {
  console.log('================================================================');
  console.log(' KURO AI RESPONSE SPEED BENCHMARK — LIVE OLLAMA (qwen2.5:3b)');
  console.log('================================================================\n');

  // Verify Ollama connection before running benchmark
  const initialCheck = await checkOllamaConnection(OLLAMA_BASE_URL, 3000, true);
  if (initialCheck.state !== 'connected' || initialCheck.models.length === 0) {
    console.log(`[Status]: Ollama is not connected or has no models installed (${initialCheck.state}).`);
    console.log('To run live benchmarks: start Ollama (`ollama serve`) and pull a model (`ollama pull qwen2.5:3b`).');
    console.log('Skipping live prompt benchmark.\n');
    return;
  }

  // Step 1: Benchmark Model Discovery
  console.log('--- 1. Model Discovery Latency ---');
  clearOllamaDiscoveryCache();
  const discStartCold = performance.now();
  const coldStatus = await checkOllamaConnection(OLLAMA_BASE_URL, 10000, true);
  const coldDiscMs = performance.now() - discStartCold;

  const discStartCached = performance.now();
  const _cachedStatus = await checkOllamaConnection(OLLAMA_BASE_URL, 10000, false);
  const cachedDiscMs = performance.now() - discStartCached;

  console.log(`  Cold Discovery (uncached network query): ${coldDiscMs.toFixed(2)} ms (Status: ${coldStatus.state}, models: ${coldStatus.models.length})`);
  console.log(`  Cached Discovery (30s TTL cache):        ${cachedDiscMs.toFixed(4)} ms`);
  console.log(`  Discovery Cache Speedup:                 ${(coldDiscMs / Math.max(cachedDiscMs, 0.0001)).toFixed(0)}x\n`);

  // Step 2: Run 10 Representative Prompts
  console.log('--- 2. Executing 10 Representative Prompts ---');
  const results = [];

  for (const item of REPRESENTATIVE_PROMPTS) {
    const isCold = item.id === 1;
    process.stdout.write(`  [Prompt ${item.id}/10] "${item.prompt.slice(0, 42)}..." `);

    // Measure memory retrieval
    const memStart = performance.now();
    const activeMems = [...MOCK_ACTIVE_MEMORIES];
    const memoryRetrievalMs = performance.now() - memStart;

    // Measure context preparation
    const prepStart = performance.now();
    const systemPrompt = buildSystemPrompt(activeMems);
    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: item.prompt },
    ];
    const contextPrepMs = performance.now() - prepStart;

    // Send streaming request
    let firstChunkTime = null;
    let accumulatedText = '';
    const reqStartTime = performance.now();

    const streamResult = await sendOllamaChatStream({
      baseUrl: OLLAMA_BASE_URL,
      model: MODEL,
      messages,
      timeoutMs: 60000,
      options: {
        num_predict: 256,
        temperature: 0.6,
        top_p: 0.9,
      },
      onChunk: (_delta, fullText) => {
        if (firstChunkTime === null) {
          firstChunkTime = performance.now() - reqStartTime;
        }
        accumulatedText = fullText;
      },
    });

    const totalWallDurationMs = performance.now() - reqStartTime;
    const ttftMs = firstChunkTime || streamResult.ttftMs || 0;
    const evalCount = streamResult.evalCount || 0;
    const providerDurationMs = streamResult.totalDuration || Math.round(totalWallDurationMs);
    const generationDurationSec = (totalWallDurationMs - ttftMs) / 1000;
    const tokensPerSec = generationDurationSec > 0 && evalCount > 0
      ? (evalCount / generationDurationSec).toFixed(1)
      : 'N/A';

    // Parse action proposals if any
    const actionParsed = parseActionProposal(accumulatedText);

    results.push({
      id: item.id,
      type: item.type,
      isCold,
      memoryRetrievalMs,
      contextPrepMs,
      ttftMs,
      providerDurationMs,
      totalWallDurationMs,
      evalCount,
      tokensPerSec,
      hasProposal: Boolean(actionParsed.proposal),
      proposalType: actionParsed.proposal?.actionType || null,
      responseSnippet: accumulatedText.slice(0, 60).replace(/\n/g, ' '),
    });

    console.log(`-> TTFT: ${ttftMs.toFixed(0)}ms | Total: ${totalWallDurationMs.toFixed(0)}ms | Tok/s: ${tokensPerSec} | Tokens: ${evalCount}`);
  }

  // Step 3: Compute Summary Statistics
  console.log('\n--- 3. Benchmark Summary Statistics ---');
  const coldRun = results.find(r => r.isCold);
  const warmRuns = results.filter(r => !r.isCold);

  const avgWarmTTFT = warmRuns.reduce((s, r) => s + r.ttftMs, 0) / warmRuns.length;
  const avgWarmTotal = warmRuns.reduce((s, r) => s + r.totalWallDurationMs, 0) / warmRuns.length;
  const avgWarmPrep = warmRuns.reduce((s, r) => s + r.contextPrepMs, 0) / warmRuns.length;
  const avgWarmMem = warmRuns.reduce((s, r) => s + r.memoryRetrievalMs, 0) / warmRuns.length;
  const validTokRuns = warmRuns.filter(r => r.tokensPerSec !== 'N/A');
  const avgTokPerSec = validTokRuns.reduce((s, r) => s + parseFloat(r.tokensPerSec), 0) / validTokRuns.length;

  console.log(`  Cold Response (Model Init + First Run): TTFT = ${coldRun?.ttftMs.toFixed(0)} ms | Total = ${coldRun?.totalWallDurationMs.toFixed(0)} ms`);
  console.log(`  Warm Responses (Avg of 9 runs):         TTFT = ${avgWarmTTFT.toFixed(1)} ms | Total = ${avgWarmTotal.toFixed(1)} ms`);
  console.log(`  Context Prep Time (Avg):                ${avgWarmPrep.toFixed(4)} ms`);
  console.log(`  Memory Retrieval Time (Avg):            ${avgWarmMem.toFixed(4)} ms`);
  console.log(`  Average Generation Speed:               ${avgTokPerSec.toFixed(1)} tokens/sec`);

  // Step 4: Verification Table
  console.log('\n--- 4. Prompt-by-Prompt Breakdown Table ---');
  console.log('| ID | Category | Cold/Warm | Context Prep | TTFT | Total Duration | Tokens | Tokens/Sec | Action Proposal |');
  console.log('|---|---|---|---|---|---|---|---|---|');
  for (const r of results) {
    const actionLabel = r.hasProposal ? `\`${r.proposalType}\`` : 'None';
    console.log(`| ${r.id} | ${r.type} | ${r.isCold ? 'COLD' : 'WARM'} | ${r.contextPrepMs.toFixed(3)} ms | ${r.ttftMs.toFixed(0)} ms | ${r.totalWallDurationMs.toFixed(0)} ms | ${r.evalCount} | ${r.tokensPerSec} | ${actionLabel} |`);
  }
}

runBenchmark().catch(err => {
  console.error('[Benchmark Error]:', err);
  process.exit(1);
});
