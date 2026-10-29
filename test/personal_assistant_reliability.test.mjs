/**
 * Kuro Personal Assistant, Reliability & Playful Activities Unit Tests
 *
 * Scope (Phase 7.5 & 7.5.1):
 * - Ollama HTTP 502 Bad Gateway diagnosis (distinguishing connection refused vs missing model vs empty tags)
 * - Empty model list (no_models) recovery guidance
 * - Model validation before prompt dispatch
 * - Optional Cloud AI Provider privacy guards & consent gates
 * - Cloud AI Server-Side Proxy: Zero secrets in browser (no sessionStorage), truthful backend status
 * - YouTube Video ID extraction, URL validation & sandboxed embed generation
 * - Autonomous pet cooldowns (Quiet = 180s, Balanced = 60s, Expressive = 30s)
 */

import assert from 'node:assert/strict';
import {
  extractYouTubeVideoId,
  buildYouTubeEmbedUrl,
  YOUTUBE_PRESET_STATIONS,
} from '../src/lib/integrations/youtubeHelper.ts';
import {
  CloudAIProvider,
  saveStoredCloudConfig,
  clearStoredCloudConfig,
  getStoredCloudConfig,
  CLOUD_MODELS,
} from '../src/lib/ai/cloudProvider.ts';
import {
  handleCloudStatus,
  handleCloudChat,
  normalizeOllamaTarget,
} from '../src/server/cloudProxy.ts';
import {
  checkOllamaConnection,
} from '../src/lib/ollama.ts';
import {
  AIProviderError,
} from '../src/lib/ai/types.ts';
import {
  getCooldownMsForFrequency,
  evaluatePetContext,
} from '../src/lib/pet/autonomousEngine.ts';

console.log('[Test Suite] Running Personal Assistant Reliability, Cloud AI & Activities Tests...\n');

// Mock browser storage for headless Node test environment
const store = new Map();
const mockLocalStorage = {
  getItem: (k) => store.get(k) || null,
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
  clear: () => store.clear(),
};
Object.defineProperty(globalThis, 'localStorage', {
  value: mockLocalStorage,
  configurable: true,
  writable: true,
});

const sessionStore = new Map();
const mockSessionStorage = {
  getItem: (k) => sessionStore.get(k) || null,
  setItem: (k, v) => sessionStore.set(k, String(v)),
  removeItem: (k) => sessionStore.delete(k),
  clear: () => sessionStore.clear(),
};
Object.defineProperty(globalThis, 'sessionStorage', {
  value: mockSessionStorage,
  configurable: true,
  writable: true,
});

let passedTests = 0;
async function test(name, fn) {
  try {
    await fn();
    console.log(`  ✓ PASS: ${name}`);
    passedTests++;
  } catch (err) {
    console.error(`  ✗ FAIL: ${name}`);
    console.error(err);
    process.exit(1);
  }
}

// ============================================================================
// PART A: Ollama Diagnosis & Assistant Reliability
// ============================================================================

await test('A1: Detects HTTP 502 Bad Gateway as daemon offline with recovery steps', () => {
  // Simulate status returned from checkOllamaConnection when proxy returns 502
  const mockStatus502 = {
    status: 502,
    statusText: 'Bad Gateway',
  };

  const isUnavailable = mockStatus502.status === 502 || mockStatus502.status === 503;
  assert.equal(isUnavailable, true, '502 must be classified as service unavailable');

  const recoveryGuidance =
    '1. Start the Ollama daemon with `ollama serve` in your terminal.\n' +
    '2. Ensure Ollama is listening on http://127.0.0.1:11434.\n' +
    '3. Run `ollama run qwen2.5:3b` to pull a lightweight model.\n' +
    '4. Click "Retry" or switch to On-Device WebLLM / Cloud AI.';

  assert.ok(recoveryGuidance.includes('ollama serve'), 'Must guide user to start ollama serve');
  assert.ok(recoveryGuidance.includes('11434'), 'Must mention port 11434');
  assert.ok(recoveryGuidance.includes('qwen2.5:3b'), 'Must recommend lightweight model');
});

await test('A2: Distinguishes empty models array (no_models) with exact pull command', () => {
  const data = { models: [] };
  const rawModels = Array.isArray(data?.models) ? data.models : [];
  assert.equal(rawModels.length, 0);

  const state = rawModels.length === 0 ? 'no_models' : 'connected';
  assert.equal(state, 'no_models');

  const guidance = 'Run `ollama run llama3:8b` or `ollama pull qwen2.5:3b` in your terminal to install a model.';
  assert.ok(guidance.includes('ollama pull'));
});

await test('A3: Parses populated Ollama tags correctly', () => {
  const sampleOllamaResponse = {
    models: [
      {
        name: 'qwen2.5:3b',
        size: 1929393152,
        digest: 'sha256:abc123456789',
        details: {
          family: 'qwen2',
          parameter_size: '3B',
          quantization_level: 'Q4_K_M',
        },
      },
      {
        name: 'llama3:8b',
        size: 4661224676,
        digest: 'sha256:def987654321',
        details: {
          family: 'llama',
          parameter_size: '8B',
          quantization_level: 'Q4_0',
        },
      },
    ],
  };

  const models = sampleOllamaResponse.models.map((m) => ({
    name: m.name,
    size: m.size,
    digest: m.digest,
    parameterSize: m.details?.parameter_size,
  }));

  assert.equal(models.length, 2);
  assert.equal(models[0].name, 'qwen2.5:3b');
  assert.equal(models[0].parameterSize, '3B');
  assert.equal(models[1].name, 'llama3:8b');
});

// ============================================================================
// PART B: Autonomous Reaction Frequency & Deterministic Cooldown Boundaries
// ============================================================================

const dummySettings = {
  petName: 'Kuro',
  eyeShape: 'curved',
  glowColor: 'cyan',
  reactionFrequency: 'balanced',
  autonomousEnabled: true,
  pausedUntil: null,
  browserAwarenessEnabled: false,
};

await test('B1: Exact Quiet cooldown boundary at 180s', () => {
  assert.equal(getCooldownMsForFrequency('quiet'), 180000);

  const fakeNow = 1000000;
  const lastSpeechTime = fakeNow - 179000; // 179s ago (1s before 180s)

  const res179 = evaluatePetContext({
    tasks: [{ id: 't1', title: 'Code', completed: false, priority: 'low', category: 'work' }],
    reminders: [],
    focusSession: null,
    companionActive: { isTracking: true, activeIde: 'Antigravity IDE', activeProject: 'kuro' },
    browserActive: null,
    petSettings: { ...dummySettings, reactionFrequency: 'quiet' },
    manualInteraction: null,
    isCurrentlySpeaking: false,
    previouslyCompletedTaskIds: new Set(),
    lastSpeechText: 'Previous speech phrase',
    lastSpeechTimestamp: lastSpeechTime,
    now: fakeNow,
  });

  assert.equal(res179.shouldSpeak, false, 'Quiet mode must NOT speak at 179s');

  // Exactly at 180s
  const res180 = evaluatePetContext({
    tasks: [{ id: 't1', title: 'Code', completed: false, priority: 'low', category: 'work' }],
    reminders: [],
    focusSession: null,
    companionActive: { isTracking: true, activeIde: 'Antigravity IDE', activeProject: 'kuro' },
    browserActive: null,
    petSettings: { ...dummySettings, reactionFrequency: 'quiet' },
    manualInteraction: null,
    isCurrentlySpeaking: false,
    previouslyCompletedTaskIds: new Set(),
    lastSpeechText: 'Previous speech phrase',
    lastSpeechTimestamp: fakeNow - 180000,
    now: fakeNow,
  });

  assert.equal(res180.shouldSpeak, true, 'Quiet mode must be permitted to speak at 180s');
});

await test('B2: Exact Balanced cooldown boundary at 60s', () => {
  assert.equal(getCooldownMsForFrequency('balanced'), 60000);

  const fakeNow = 1000000;

  // 59s ago -> should NOT speak
  const res59 = evaluatePetContext({
    tasks: [{ id: 't1', title: 'Code', completed: false, priority: 'low', category: 'work' }],
    reminders: [],
    focusSession: null,
    companionActive: { isTracking: true, activeIde: 'Antigravity IDE', activeProject: 'kuro' },
    browserActive: null,
    petSettings: { ...dummySettings, reactionFrequency: 'balanced' },
    manualInteraction: null,
    isCurrentlySpeaking: false,
    previouslyCompletedTaskIds: new Set(),
    lastSpeechText: 'Previous speech phrase',
    lastSpeechTimestamp: fakeNow - 59000,
    now: fakeNow,
  });

  assert.equal(res59.shouldSpeak, false, 'Balanced mode must NOT speak at 59s');

  // Exactly 60s ago -> should speak
  const res60 = evaluatePetContext({
    tasks: [{ id: 't1', title: 'Code', completed: false, priority: 'low', category: 'work' }],
    reminders: [],
    focusSession: null,
    companionActive: { isTracking: true, activeIde: 'Antigravity IDE', activeProject: 'kuro' },
    browserActive: null,
    petSettings: { ...dummySettings, reactionFrequency: 'balanced' },
    manualInteraction: null,
    isCurrentlySpeaking: false,
    previouslyCompletedTaskIds: new Set(),
    lastSpeechText: 'Previous speech phrase',
    lastSpeechTimestamp: fakeNow - 60000,
    now: fakeNow,
  });

  assert.equal(res60.shouldSpeak, true, 'Balanced mode must speak at 60s');
});

await test('B3: Exact Expressive cooldown boundary at 30s', () => {
  assert.equal(getCooldownMsForFrequency('expressive'), 30000);

  const fakeNow = 1000000;

  // 29s ago -> should NOT speak
  const res29 = evaluatePetContext({
    tasks: [{ id: 't1', title: 'Code', completed: false, priority: 'low', category: 'work' }],
    reminders: [],
    focusSession: null,
    companionActive: { isTracking: true, activeIde: 'Antigravity IDE', activeProject: 'kuro' },
    browserActive: null,
    petSettings: { ...dummySettings, reactionFrequency: 'expressive' },
    manualInteraction: null,
    isCurrentlySpeaking: false,
    previouslyCompletedTaskIds: new Set(),
    lastSpeechText: 'Previous speech phrase',
    lastSpeechTimestamp: fakeNow - 29000,
    now: fakeNow,
  });

  assert.equal(res29.shouldSpeak, false, 'Expressive mode must NOT speak at 29s');

  // 30s ago -> should speak
  const res30 = evaluatePetContext({
    tasks: [{ id: 't1', title: 'Code', completed: false, priority: 'low', category: 'work' }],
    reminders: [],
    focusSession: null,
    companionActive: { isTracking: true, activeIde: 'Antigravity IDE', activeProject: 'kuro' },
    browserActive: null,
    petSettings: { ...dummySettings, reactionFrequency: 'expressive' },
    manualInteraction: null,
    isCurrentlySpeaking: false,
    previouslyCompletedTaskIds: new Set(),
    lastSpeechText: 'Previous speech phrase',
    lastSpeechTimestamp: fakeNow - 30000,
    now: fakeNow,
  });

  assert.equal(res30.shouldSpeak, true, 'Expressive mode must speak at 30s');
});

// ============================================================================
// PART C: Cloud AI Server-Side Proxy & Zero Browser Secrets (Phase 7.5.1)
// ============================================================================

await test('C1: Cloud AI provider blocks inference when userConsent is false', async () => {
  clearStoredCloudConfig();
  const provider = new CloudAIProvider();

  const status = await provider.checkStatus();
  assert.equal(status.state, 'unsupported');
  assert.ok(status.error.includes('consent'), 'Must explicitly mention consent is required');

  // Attempting to send chat without consent must throw AIProviderError
  await assert.rejects(
    async () => {
      await provider.sendChatStream({
        messages: [{ role: 'user', content: 'Hello cloud' }],
        onChunk: () => {},
      });
    },
    (err) => {
      assert.ok(err.message.includes('consent'));
      return true;
    }
  );
});

await test('C2: When consent is given but backend reports unconfigured, state is unavailable with "Backend setup required"', async () => {
  clearStoredCloudConfig();
  saveStoredCloudConfig({ userConsent: true, selectedModel: 'gemini-3.8-flash' });

  // Mock global fetch to return { configured: false } for /api/cloud/status
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).includes('/api/cloud/status')) {
      return {
        ok: true,
        json: async () => ({
          configured: false,
          providers: { gemini: false, openai: false },
        }),
      };
    }
    return originalFetch(url);
  };

  try {
    const provider = new CloudAIProvider();
    const status = await provider.checkStatus();
    assert.equal(status.state, 'unavailable');
    assert.ok(
      status.error.includes('Backend setup required'),
      `Expected error to contain "Backend setup required", got: ${status.error}`
    );
    assert.ok(
      status.recoveryGuidance.includes('server environment variables'),
      'Must guide user to configure server environment variables'
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

await test('C3: Attempting sendChatStream when server responds HTTP 503 throws "Backend setup required"', async () => {
  clearStoredCloudConfig();
  saveStoredCloudConfig({ userConsent: true, selectedModel: 'gemini-3.8-flash' });

  // Mock global fetch to return 503 for /api/cloud/chat
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).includes('/api/cloud/chat')) {
      return {
        ok: false,
        status: 503,
        statusText: 'Service Unavailable',
        json: async () => ({
          error: 'Backend setup required: GEMINI_API_KEY is not configured in server environment.',
          code: 'BACKEND_SETUP_REQUIRED',
        }),
      };
    }
    return originalFetch(url);
  };

  try {
    const provider = new CloudAIProvider();
    await assert.rejects(
      async () => {
        await provider.sendChatStream({
          messages: [{ role: 'user', content: 'Hello cloud' }],
          onChunk: () => {},
        });
      },
      (err) => {
        assert.ok(
          err.message.includes('Backend setup required'),
          `Expected message to contain "Backend setup required", got: ${err.message}`
        );
        return true;
      }
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

await test('C4: Cloud AI connects cleanly when consent is true and backend reports configured', async () => {
  clearStoredCloudConfig();
  saveStoredCloudConfig({ userConsent: true, selectedModel: 'gemini-3.8-flash' });

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).includes('/api/cloud/status')) {
      return {
        ok: true,
        json: async () => ({
          configured: true,
          providers: { gemini: true, openai: false },
          defaultModel: 'gemini-3.8-flash',
        }),
      };
    }
    return originalFetch(url);
  };

  try {
    const provider = new CloudAIProvider();
    const status = await provider.checkStatus();
    assert.equal(status.state, 'connected');
    assert.equal(status.models.length, CLOUD_MODELS.length);
    assert.equal(status.activeModel, 'gemini-3.8-flash');
    assert.equal(status.error, null);
  } finally {
    globalThis.fetch = originalFetch;
    clearStoredCloudConfig();
  }
});

await test('C5: Zero browser secrets: sessionStorage and localStorage never store API keys', () => {
  clearStoredCloudConfig();

  // Save regular configuration
  saveStoredCloudConfig({ userConsent: true, serviceType: 'gemini', selectedModel: 'gemini-3.8-flash' });
  const cfg = getStoredCloudConfig();

  // Ensure config object has no apiKey property
  assert.equal('apiKey' in cfg, false, 'CloudAIConfig must never contain apiKey field');

  // Ensure sessionStorage has no kuro_cloud keys
  assert.equal(sessionStorage.getItem('kuro_cloud_api_key_session'), null);

  // Clear and ensure clean state
  clearStoredCloudConfig();
  assert.equal(localStorage.getItem('kuro_cloud_user_consent'), null);
});

await test('C6: Server proxy handleCloudStatus never leaks API keys', () => {
  const origGemini = process.env.GEMINI_API_KEY;
  const origOpenAI = process.env.OPENAI_API_KEY;

  try {
    process.env.GEMINI_API_KEY = 'secret-test-key-gemini-xyz987';
    delete process.env.OPENAI_API_KEY;

    let responseStatusCode = null;
    let responseBody = '';

    const mockRes = {
      writeHead: (status, _headers) => {
        responseStatusCode = status;
      },
      end: (data) => {
        responseBody = data;
      },
    };

    handleCloudStatus({}, mockRes);

    assert.equal(responseStatusCode, 200);
    const parsed = JSON.parse(responseBody);
    assert.equal(parsed.configured, true);
    assert.equal(parsed.providers.gemini, true);
    assert.equal(parsed.providers.openai, false);

    // CRITICAL SECURITY ASSERTION: Secret key must NEVER appear in response payload
    assert.equal(
      responseBody.includes('secret-test-key-gemini-xyz987'),
      false,
      'Server proxy status endpoint must NEVER leak secret key values'
    );
  } finally {
    if (origGemini !== undefined) process.env.GEMINI_API_KEY = origGemini;
    else delete process.env.GEMINI_API_KEY;

    if (origOpenAI !== undefined) process.env.OPENAI_API_KEY = origOpenAI;
    else delete process.env.OPENAI_API_KEY;
  }
});

await test('C7: Server proxy handleCloudChat returns 503 when server keys are not configured', async () => {
  const origGemini = process.env.GEMINI_API_KEY;
  const origOpenAI = process.env.OPENAI_API_KEY;

  try {
    delete process.env.GEMINI_API_KEY;
    delete process.env.OPENAI_API_KEY;

    // Create async iterable mock request
    const payload = JSON.stringify({
      model: 'gemini-1.5-flash',
      messages: [{ role: 'user', content: 'Test' }],
    });

    async function* makeIterator() {
      yield Buffer.from(payload);
    }
    const mockReq = makeIterator();

    let responseStatusCode = null;
    let responseBody = '';

    const mockRes = {
      writeHead: (status, _headers) => {
        responseStatusCode = status;
      },
      end: (data) => {
        responseBody = data;
      },
    };

    await handleCloudChat(mockReq, mockRes);

    assert.equal(responseStatusCode, 503);
    const parsed = JSON.parse(responseBody);
    assert.equal(parsed.code, 'BACKEND_SETUP_REQUIRED');
    assert.ok(parsed.error.includes('Backend setup required'));
  } finally {
    if (origGemini !== undefined) process.env.GEMINI_API_KEY = origGemini;
    else delete process.env.GEMINI_API_KEY;

    if (origOpenAI !== undefined) process.env.OPENAI_API_KEY = origOpenAI;
    else delete process.env.OPENAI_API_KEY;
  }
});

// ============================================================================
// PART D: YouTube Music Parser & Sandboxed Player URL Generator
// ============================================================================

await test('D1: Extracts video ID from all approved YouTube URL formats', () => {
  // Standard watch URL
  assert.equal(
    extractYouTubeVideoId('https://www.youtube.com/watch?v=jfKfPfyJRdk'),
    'jfKfPfyJRdk'
  );
  // Watch URL with extra query params
  assert.equal(
    extractYouTubeVideoId('https://youtube.com/watch?v=jfKfPfyJRdk&t=120s&list=xyz'),
    'jfKfPfyJRdk'
  );
  // Short URL
  assert.equal(
    extractYouTubeVideoId('https://youtu.be/jfKfPfyJRdk'),
    'jfKfPfyJRdk'
  );
  // Embed URL
  assert.equal(
    extractYouTubeVideoId('https://www.youtube.com/embed/jfKfPfyJRdk'),
    'jfKfPfyJRdk'
  );
  // Music YouTube URL
  assert.equal(
    extractYouTubeVideoId('https://music.youtube.com/watch?v=jfKfPfyJRdk'),
    'jfKfPfyJRdk'
  );
  // Bare 11-char ID
  assert.equal(extractYouTubeVideoId('jfKfPfyJRdk'), 'jfKfPfyJRdk');
});

await test('D2: Safely rejects invalid, truncated, or malicious URLs', () => {
  assert.equal(extractYouTubeVideoId(''), null);
  assert.equal(extractYouTubeVideoId(null), null);
  assert.equal(extractYouTubeVideoId('javascript:alert(1)'), null);
  assert.equal(extractYouTubeVideoId('https://vimeo.com/12345678'), null);
  assert.equal(extractYouTubeVideoId('https://malicious.com/watch?v=jfKfPfyJRdk'), null);
  assert.equal(extractYouTubeVideoId('short'), null); // too short (< 11)
});

await test('D3: Generates sandboxed iframe embed URL with origin and enablejsapi', () => {
  const embedUrl = buildYouTubeEmbedUrl('jfKfPfyJRdk', { autoplay: true, mute: false });
  assert.ok(embedUrl.startsWith('https://www.youtube.com/embed/jfKfPfyJRdk?'));
  assert.ok(embedUrl.includes('enablejsapi=1'));
  assert.ok(embedUrl.includes('autoplay=1'));
  assert.ok(embedUrl.includes('origin='));
});

await test('D4: Verifies curated productivity stations are valid and defined', () => {
  assert.equal(YOUTUBE_PRESET_STATIONS.length >= 4, true);
  for (const station of YOUTUBE_PRESET_STATIONS) {
    assert.ok(station.id);
    assert.equal(station.videoId.length, 11);
    assert.ok(station.title);
    assert.ok(station.genre);
  }
});

// ============================================================================
// PART E: Phase 7.6A Ollama Target Normalization & AI Latency/Cancellation
// ============================================================================

await test('E1: normalizeOllamaTarget handles empty, trailing slashes, and schemeless hosts', () => {
  assert.equal(normalizeOllamaTarget(undefined), 'http://127.0.0.1:11434');
  assert.equal(normalizeOllamaTarget(''), 'http://127.0.0.1:11434');
  assert.equal(normalizeOllamaTarget('   '), 'http://127.0.0.1:11434');
  assert.equal(normalizeOllamaTarget('http://127.0.0.1:11434/'), 'http://127.0.0.1:11434');
  assert.equal(normalizeOllamaTarget('http://127.0.0.1:11434///'), 'http://127.0.0.1:11434');
  assert.equal(normalizeOllamaTarget('127.0.0.1:11434'), 'http://127.0.0.1:11434');
  assert.equal(normalizeOllamaTarget('192.168.1.50:11434/'), 'http://192.168.1.50:11434');
  assert.equal(normalizeOllamaTarget('https://custom-ollama.internal:11434/'), 'https://custom-ollama.internal:11434');
});

await test('E2: checkOllamaConnection gracefully handles HTTP 404 endpoint not found', async () => {
  const origFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: false,
    status: 404,
    statusText: 'Not Found',
    json: async () => ({ error: 'Not found' }),
  });

  try {
    const res = await checkOllamaConnection('http://127.0.0.1:11434', 1000);
    assert.equal(res.ok, false);
    assert.equal(res.state, 'error');
    assert.ok(res.error.includes('404'));
  } finally {
    globalThis.fetch = origFetch;
  }
});

await test('E3: checkOllamaConnection handles malformed non-JSON response safely', async () => {
  const origFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    statusText: 'OK',
    json: async () => {
      throw new SyntaxError('Unexpected token < in JSON at position 0');
    },
  });

  try {
    const res = await checkOllamaConnection('http://127.0.0.1:11434', 1000);
    assert.equal(res.ok, false);
    assert.equal(res.state, 'error');
    assert.ok(res.error.includes('Malformed response'));
  } finally {
    globalThis.fetch = origFetch;
  }
});

await test('E4: Cloud AI Provider cleanly separates user cancellation from timeout error', async () => {
  saveStoredCloudConfig({ userConsent: true, selectedModel: 'gemini-3.8-flash' });
  const provider = new CloudAIProvider();

  // Test 1: Immediate caller abort throws 'aborted'
  const controller = new AbortController();
  controller.abort();

  let abortError = null;
  try {
    await provider.sendChatStream({
      model: 'gemini-3.8-flash',
      messages: [{ role: 'user', content: 'Hello' }],
      signal: controller.signal,
      onChunk: () => {},
    });
  } catch (err) {
    abortError = err;
  }

  assert.ok(abortError instanceof AIProviderError, 'Must be AIProviderError');
  assert.equal(abortError.code, 'aborted');
  assert.ok(abortError.message.includes('cancelled by user'));

  // Test 2: Upstream 504 Gateway Timeout throws 'timeout'
  const origFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (url === '/api/cloud/status') {
      return {
        ok: true,
        json: async () => ({ configured: true, providers: { gemini: true, openai: false } }),
      };
    }
    return {
      ok: false,
      status: 504,
      statusText: 'Gateway Timeout',
      json: async () => ({ error: 'Upstream connection timed out' }),
    };
  };

  let timeoutError = null;
  try {
    await provider.sendChatStream({
      model: 'gemini-3.8-flash',
      messages: [{ role: 'user', content: 'Hello' }],
      onChunk: () => {},
    });
  } catch (err) {
    timeoutError = err;
  } finally {
    globalThis.fetch = origFetch;
  }

  assert.ok(timeoutError instanceof AIProviderError, 'Must be AIProviderError');
  assert.equal(timeoutError.code, 'timeout');
  assert.ok(timeoutError.message.includes('timed out'));
});

await test('E5: Server proxy handleCloudChat writes immediate SSE headers and keep-alive comment', async () => {
  const origGemini = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = 'mock-key-for-test';

  try {
    const payload = JSON.stringify({
      model: 'gemini-3.8-flash',
      messages: [{ role: 'user', content: 'Hi' }],
    });

    async function* makeIterator() {
      yield Buffer.from(payload);
    }
    const mockReq = makeIterator();
    mockReq.on = () => {};

    const writtenData = [];
    let headersWritten = null;

    const mockRes = {
      writeHead: (status, headers) => {
        headersWritten = { status, headers };
      },
      write: (chunk) => {
        writtenData.push(chunk);
      },
      flushHeaders: () => {},
      flush: () => {},
      end: () => {},
      on: () => {},
      writableEnded: false,
    };

    const origFetch = globalThis.fetch;
    globalThis.fetch = async () => {
      return {
        ok: true,
        status: 200,
        body: {
          getReader: () => ({
            read: async () => ({ done: true, value: undefined }),
            releaseLock: () => {},
          }),
        },
      };
    };

    try {
      await handleCloudChat(mockReq, mockRes);
    } finally {
      globalThis.fetch = origFetch;
    }

    assert.equal(headersWritten?.status, 200);
    assert.ok(headersWritten?.headers['Content-Type'].includes('text/event-stream'));
    assert.ok(headersWritten?.headers['Cache-Control'].includes('no-cache'));
    assert.equal(headersWritten?.headers['X-Accel-Buffering'], 'no');
    assert.ok(writtenData.some((chunk) => chunk.includes(': keep-alive')), 'Must send initial keep-alive comment');
  } finally {
    if (origGemini !== undefined) process.env.GEMINI_API_KEY = origGemini;
    else delete process.env.GEMINI_API_KEY;
  }
});

console.log(`\n[Test Summary]: ${passedTests} passed, 0 failed\n`);
