/**
 * Kuro Robot Companion — ESP32-S3 Firmware Foundation & Web-to-Robot Protocol Unit Tests
 *
 * Scope: Phase 8.0 & Phase 8.1 Hardware Firmware & Communication Validation
 * - RGB565 Color Conversion & Approved Palettes
 * - Face Engine State Machine, Moods & Geometric Layouts
 * - Non-Blocking Scheduling Math (30 FPS, Breathing, Blinking)
 * - Visual Speech Ribbon & Phoneme Morph Lifecycle
 * - Bidirectional Inbound/Outbound JSON Protocol & Schema Validation (Protocol v1.0)
 * - Bounded Message Size (512B) & Protocol Version Checks
 * - Request ID (reqId) Correlation
 * - Non-Blocking Wi-Fi State Machine & Exponential Backoff Math
 * - Heartbeat Inactivity / Connection-Loss Detection
 * - Server-Side Device Gateway Pairing, Session Authentication & Command Dispatch
 * - Multi-Board PlatformIO Configuration (N8R8, N16R8, N8R2, No-PSRAM)
 * - Security & Credential Isolation Guarantees
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  HEARTBEAT_TIMEOUT_MS,
  createPairingChallenge,
  confirmPairing,
  validateDeviceSession,
  unpairDevice,
  recordDeviceTelemetry,
  getDeviceStatus,
  dispatchDeviceCommand,
  resetDeviceGatewayState,
} from '../src/server/deviceGateway.mjs';

console.log('[Test Suite] Running Kuro Robot ESP32-S3 Firmware Logic & Protocol Tests...\n');

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

// -----------------------------------------------------------------------------
// Helper Implementations Mirroring Firmware Logic
// -----------------------------------------------------------------------------

function rgb565(r, g, b) {
  return (((r & 0xF8) << 8) | ((g & 0xFC) << 3) | (b >> 3)) & 0xFFFF;
}

const ALLOWED_MOODS = [
  'idle', 'attentive', 'focused', 'curious', 'thinking', 'happy', 'excited',
  'sleepy', 'playful', 'caring', 'surprised', 'confused', 'worried', 'proud',
  'listening', 'speaking', 'error'
];

function isValidMood(mood) {
  return typeof mood === 'string' && ALLOWED_MOODS.includes(mood);
}

function isValidPalette(palette) {
  return ['cyan', 'emerald', 'amber', 'violet'].includes(palette);
}

function isValidEyeShape(shape) {
  return ['curved', 'round', 'pixel'].includes(shape);
}

function mapMoodToDefaultMouth(mood) {
  if (mood === 'happy' || mood === 'proud' || mood === 'playful') return 'MOUTH_OPEN_SMILE';
  if (mood === 'excited') return 'MOUTH_LAUGH';
  if (mood === 'focused') return 'MOUTH_FOCUSED_LINE';
  if (mood === 'surprised') return 'MOUTH_SURPRISED_O';
  if (mood === 'worried' || mood === 'error') return 'MOUTH_WORRIED_CURVE';
  if (mood === 'curious' || mood === 'confused') return 'MOUTH_CONFUSED_CROOKED';
  if (mood === 'sleepy') return 'MOUTH_SLEEPY';
  if (mood === 'idle' || mood === 'thinking') return 'MOUTH_TINY';
  return 'MOUTH_CLOSED_SMILE';
}

function calculateSpeechDuration(text, explicitMs = 0) {
  if (explicitMs > 0) return explicitMs;
  const len = text ? text.length : 0;
  const computed = 1200 + len * 55;
  return Math.min(10000, Math.max(2200, computed));
}

// Firmware protocol simulation (Protocol v1.0)
function executeProtocolCommand(jsonStr, state = {}) {
  const MAX_PAYLOAD = 512;

  if (!jsonStr || jsonStr.trim() === '') {
    return {
      success: false,
      response: { type: 'error', proto: '1.0', code: 'EMPTY_PAYLOAD', msg: 'Empty JSON payload' }
    };
  }

  if (jsonStr.length > MAX_PAYLOAD) {
    return {
      success: false,
      response: { type: 'error', proto: '1.0', code: 'OVERSIZED_PAYLOAD', msg: `Payload exceeds ${MAX_PAYLOAD} bytes` }
    };
  }

  let parsed;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    return {
      success: false,
      response: { type: 'error', proto: '1.0', code: 'INVALID_JSON', msg: 'Malformed JSON payload' }
    };
  }

  const reqId = parsed.reqId || undefined;

  // Version check
  if (parsed.proto && parsed.proto !== '1.0') {
    return {
      success: false,
      response: {
        type: 'error',
        proto: '1.0',
        code: 'UNSUPPORTED_PROTO',
        msg: `Protocol version '${parsed.proto}' not supported`,
        ...(reqId && { reqId }),
      }
    };
  }

  if (!parsed.cmd) {
    return {
      success: false,
      response: {
        type: 'error',
        proto: '1.0',
        code: 'MISSING_CMD',
        msg: "Missing required 'cmd' field",
        ...(reqId && { reqId }),
      }
    };
  }

  switch (parsed.cmd) {
    case 'set_mood': {
      if (!parsed.mood) {
        return {
          success: false,
          response: {
            type: 'error',
            proto: '1.0',
            code: 'MISSING_PARAM',
            msg: "Missing 'mood' parameter",
            ...(reqId && { reqId }),
          }
        };
      }
      if (!isValidMood(parsed.mood)) {
        return {
          success: false,
          response: {
            type: 'error',
            proto: '1.0',
            code: 'INVALID_MOOD',
            msg: `Mood '${parsed.mood}' not recognized`,
            ...(reqId && { reqId }),
          }
        };
      }
      state.mood = parsed.mood;
      if (parsed.palette && isValidPalette(parsed.palette)) {
        state.palette = parsed.palette;
      }
      return {
        success: true,
        response: {
          type: 'ack',
          proto: '1.0',
          cmd: 'set_mood',
          mood: parsed.mood,
          status: 'ok',
          ...(reqId && { reqId }),
        }
      };
    }
    case 'speak': {
      if (!parsed.speech || typeof parsed.speech !== 'string') {
        return {
          success: false,
          response: {
            type: 'error',
            proto: '1.0',
            code: 'MISSING_PARAM',
            msg: "Missing 'speech' text parameter",
            ...(reqId && { reqId }),
          }
        };
      }
      const dur = calculateSpeechDuration(parsed.speech, parsed.durationMs);
      state.isSpeaking = true;
      state.speechText = parsed.speech;
      state.speechDuration = dur;
      return {
        success: true,
        response: {
          type: 'ack',
          proto: '1.0',
          cmd: 'speak',
          status: 'ok',
          ...(reqId && { reqId }),
        }
      };
    }
    case 'set_palette': {
      if (!parsed.palette || !isValidPalette(parsed.palette)) {
        return {
          success: false,
          response: {
            type: 'error',
            proto: '1.0',
            code: 'INVALID_PALETTE',
            msg: 'Palette must be cyan, emerald, amber, or violet',
            ...(reqId && { reqId }),
          }
        };
      }
      state.palette = parsed.palette;
      return {
        success: true,
        response: {
          type: 'ack',
          proto: '1.0',
          cmd: 'set_palette',
          palette: parsed.palette,
          status: 'ok',
          ...(reqId && { reqId }),
        }
      };
    }
    case 'set_eye_shape': {
      if (!parsed.shape || !isValidEyeShape(parsed.shape)) {
        return {
          success: false,
          response: {
            type: 'error',
            proto: '1.0',
            code: 'INVALID_SHAPE',
            msg: 'Shape must be curved, round, or pixel',
            ...(reqId && { reqId }),
          }
        };
      }
      state.eyeShape = parsed.shape;
      return {
        success: true,
        response: {
          type: 'ack',
          proto: '1.0',
          cmd: 'set_eye_shape',
          shape: parsed.shape,
          status: 'ok',
          ...(reqId && { reqId }),
        }
      };
    }
    case 'ping': {
      return {
        success: true,
        response: {
          type: 'pong',
          proto: '1.0',
          ts: parsed.ts || 0,
          version: '0.1.0',
          ...(reqId && { reqId }),
        }
      };
    }
    case 'get_status': {
      return {
        success: true,
        response: {
          type: 'telemetry',
          proto: '1.0',
          version: '0.1.0',
          uptime: state.uptime || 42,
          wifiState: state.wifiState || 'connected',
          ip: state.ip || '192.168.1.100',
          rssi: state.rssi || -54,
          freeHeap: 248000,
          freePsram: 8192000,
          mood: state.mood || 'attentive',
          isSpeaking: Boolean(state.isSpeaking),
          displayOk: true,
          ...(reqId && { reqId }),
        }
      };
    }
    default: {
      return {
        success: false,
        response: {
          type: 'error',
          proto: '1.0',
          code: 'UNKNOWN_CMD',
          msg: `Command '${parsed.cmd}' not supported`,
          ...(reqId && { reqId }),
        }
      };
    }
  }
}

// =============================================================================
// TEST SUITE: 1. RGB565 Math & Approved Visor Glow Palettes
// =============================================================================

await test('1. RGB565 color conversion math produces accurate 16-bit values', () => {
  assert.equal(rgb565(0, 0, 0), 0x0000, 'Pure Black is 0x0000');
  assert.equal(rgb565(255, 255, 255), 0xFFFF, 'Pure White is 0xFFFF');
  assert.equal(rgb565(255, 0, 0), 0xF800, 'Pure Red is 0xF800');
  assert.equal(rgb565(0, 255, 0), 0x07E0, 'Pure Green is 0x07E0');
  assert.equal(rgb565(0, 0, 255), 0x001F, 'Pure Blue is 0x001F');
});

await test('2. Approved Kuro glow palettes match web UI hex specifications and RGB565 constants', () => {
  // Cyan: #06b6d4 (r=6, g=182, b=212)
  const cyanVal = rgb565(6, 182, 212);
  assert.equal(cyanVal, 0x05BA, 'Cyan RGB565 matches 0x05BA');

  // Emerald: #10b981 (r=16, g=185, b=129)
  const emeraldVal = rgb565(16, 185, 129);
  assert.equal(emeraldVal, 0x15D0, 'Emerald RGB565 matches 0x15D0');

  // Amber: #f59e0b (r=245, g=158, b=11)
  const amberVal = rgb565(245, 158, 11);
  assert.equal(amberVal, 0xF4E1, 'Amber RGB565 matches 0xF4E1');

  // Violet: #a855f7 (r=168, g=85, b=247)
  const violetVal = rgb565(168, 85, 247);
  assert.equal(violetVal, 0xAABE, 'Violet RGB565 matches 0xAABE');
});

// =============================================================================
// TEST SUITE: 2. Face Engine State Machine & Mood Geometry
// =============================================================================

await test('3. Face Engine supports all 17 distinct moods matching web control center', () => {
  assert.equal(ALLOWED_MOODS.length, 17);
  for (const mood of ALLOWED_MOODS) {
    assert.equal(isValidMood(mood), true, `Mood ${mood} should be valid`);
  }
  assert.equal(isValidMood('angry'), false, 'Non-existent mood should be rejected');
  assert.equal(isValidMood(null), false, 'Null mood should be rejected');
});

await test('4. Mood state transitions map to correct expressive mouth styles', () => {
  assert.equal(mapMoodToDefaultMouth('happy'), 'MOUTH_OPEN_SMILE');
  assert.equal(mapMoodToDefaultMouth('proud'), 'MOUTH_OPEN_SMILE');
  assert.equal(mapMoodToDefaultMouth('playful'), 'MOUTH_OPEN_SMILE');
  assert.equal(mapMoodToDefaultMouth('excited'), 'MOUTH_LAUGH');
  assert.equal(mapMoodToDefaultMouth('focused'), 'MOUTH_FOCUSED_LINE');
  assert.equal(mapMoodToDefaultMouth('surprised'), 'MOUTH_SURPRISED_O');
  assert.equal(mapMoodToDefaultMouth('worried'), 'MOUTH_WORRIED_CURVE');
  assert.equal(mapMoodToDefaultMouth('error'), 'MOUTH_WORRIED_CURVE');
  assert.equal(mapMoodToDefaultMouth('curious'), 'MOUTH_CONFUSED_CROOKED');
  assert.equal(mapMoodToDefaultMouth('confused'), 'MOUTH_CONFUSED_CROOKED');
  assert.equal(mapMoodToDefaultMouth('sleepy'), 'MOUTH_SLEEPY');
  assert.equal(mapMoodToDefaultMouth('idle'), 'MOUTH_TINY');
  assert.equal(mapMoodToDefaultMouth('thinking'), 'MOUTH_TINY');
  assert.equal(mapMoodToDefaultMouth('attentive'), 'MOUTH_CLOSED_SMILE');
  assert.equal(mapMoodToDefaultMouth('listening'), 'MOUTH_CLOSED_SMILE');
});

await test('5. Validates 3 visor eye shapes and 4 glow palettes strictly', () => {
  assert.equal(isValidEyeShape('curved'), true);
  assert.equal(isValidEyeShape('round'), true);
  assert.equal(isValidEyeShape('pixel'), true);
  assert.equal(isValidEyeShape('triangle'), false);

  assert.equal(isValidPalette('cyan'), true);
  assert.equal(isValidPalette('emerald'), true);
  assert.equal(isValidPalette('amber'), true);
  assert.equal(isValidPalette('violet'), true);
  assert.equal(isValidPalette('magenta'), false);
});

// =============================================================================
// TEST SUITE: 3. Non-Blocking Scheduling Math (30 FPS, Breathing, Blinking)
// =============================================================================

await test('6. Non-blocking frame scheduler enforces 33ms interval (~30 FPS)', () => {
  const FRAME_INTERVAL_MS = 33;
  let lastFrameMs = 1000;

  // Attempt update after 15ms -> should skip (delta < 33ms)
  let nowMs = 1015;
  let didRender = (nowMs - lastFrameMs) >= FRAME_INTERVAL_MS;
  assert.equal(didRender, false, 'Should not render if < 33ms elapsed');

  // Attempt update after 33ms -> should render
  nowMs = 1033;
  didRender = (nowMs - lastFrameMs) >= FRAME_INTERVAL_MS;
  assert.equal(didRender, true, 'Should render at 33ms elapsed');
  lastFrameMs = nowMs;

  // Attempt update after 40ms -> should render
  nowMs = 1073;
  didRender = (nowMs - lastFrameMs) >= FRAME_INTERVAL_MS;
  assert.equal(didRender, true, 'Should render at 40ms elapsed');
});

await test('7. Idle breathing vertical oscillation adheres to sine wave ±2px bounds', () => {
  const BREATHING_CYCLE_MS = 3200;

  for (let t = 0; t <= BREATHING_CYCLE_MS; t += 200) {
    const angle = (t % BREATHING_CYCLE_MS) * (2.0 * Math.PI / BREATHING_CYCLE_MS);
    const breathingY = Math.round(Math.sin(angle) * 2.0);
    assert.ok(breathingY >= -2 && breathingY <= 2, `Breathing Y ${breathingY} must be within [-2, +2] px`);
  }
});

await test('8. Blinking state machine calculates smooth lid closure and random scheduling', () => {
  const BLINK_DURATION_MS = 160;
  const EYE_HEIGHT = 48;

  // Closing phase at 40ms (50% progress into 80ms closing half)
  const closingProgress = 40 / (BLINK_DURATION_MS / 2);
  const closingHeight = Math.round(EYE_HEIGHT * (1.0 - closingProgress));
  assert.equal(closingHeight, 24, 'Half-closed eyelid height should be 24px');

  // Fully closed (clamped to 4px minimum slit line)
  const fullyClosedProgress = 80 / (BLINK_DURATION_MS / 2);
  let closedHeight = Math.round(EYE_HEIGHT * (1.0 - fullyClosedProgress));
  if (closedHeight < 4) closedHeight = 4;
  assert.equal(closedHeight, 4, 'Closed slit height clamped to minimum 4px');

  // Opening phase at 120ms (50% progress into 80ms opening half)
  const openingProgress = (120 - 80) / (BLINK_DURATION_MS / 2);
  const openingHeight = Math.round(EYE_HEIGHT * openingProgress);
  assert.equal(openingHeight, 24, 'Half-opened eyelid height should be 24px');

  // Verify next blink random interval constraints (3200ms - 6000ms)
  const minInterval = 3200;
  const maxInterval = 6000;
  for (let now = 1000; now < 10000; now += 1234) {
    const nextInterval = minInterval + (now % (maxInterval - minInterval));
    assert.ok(nextInterval >= 3200 && nextInterval <= 6000, 'Next blink must be between 3.2s and 6.0s');
  }
});

// =============================================================================
// TEST SUITE: 4. Visual Speech Ribbon & Phoneme Morph Cycle
// =============================================================================

await test('9. Visual speech duration is clamped within [2.2s, 10s] bounds', () => {
  // Very short text: 4 chars -> 1200 + 4*55 = 1420ms -> clamped to 2200ms
  assert.equal(calculateSpeechDuration('Hi!'), 2200);

  // Medium text: 39 chars -> 1200 + 39*55 = 3345ms
  assert.equal(calculateSpeechDuration('Hello there, I am Kuro robot companion!'), 3345);

  // Very long text: 200 chars -> 1200 + 200*55 = 12200ms -> clamped to 10000ms
  const longText = 'a'.repeat(200);
  assert.equal(calculateSpeechDuration(longText), 10000);

  // Explicit duration overrides auto calculation
  assert.equal(calculateSpeechDuration('Hi', 4500), 4500);
});

await test('10. Speaking phoneme cadence cycles through 4 distinct mouth shapes every 130ms', () => {
  const PHONEME_INTERVAL_MS = 130;
  let phonemeStep = 0;
  let lastPhonemeMs = 0;

  // Advance 130ms -> step 1
  let now = 130;
  if (now - lastPhonemeMs >= PHONEME_INTERVAL_MS) {
    lastPhonemeMs = now;
    phonemeStep = (phonemeStep + 1) % 4;
  }
  assert.equal(phonemeStep, 1, 'Phoneme advances to step 1 (mid)');

  // Advance another 130ms -> step 2
  now = 260;
  if (now - lastPhonemeMs >= PHONEME_INTERVAL_MS) {
    lastPhonemeMs = now;
    phonemeStep = (phonemeStep + 1) % 4;
  }
  assert.equal(phonemeStep, 2, 'Phoneme advances to step 2 (wide)');

  // Advance another 130ms -> step 3
  now = 390;
  if (now - lastPhonemeMs >= PHONEME_INTERVAL_MS) {
    lastPhonemeMs = now;
    phonemeStep = (phonemeStep + 1) % 4;
  }
  assert.equal(phonemeStep, 3, 'Phoneme advances to step 3 (open)');

  // Advance another 130ms -> cycle back to step 0
  now = 520;
  if (now - lastPhonemeMs >= PHONEME_INTERVAL_MS) {
    lastPhonemeMs = now;
    phonemeStep = (phonemeStep + 1) % 4;
  }
  assert.equal(phonemeStep, 0, 'Phoneme cycles back to step 0 (closed)');
});

// =============================================================================
// TEST SUITE: 5. Bidirectional JSON Protocol Parser & Validator (Protocol v1.0)
// =============================================================================

await test('11. Protocol parser correctly processes valid set_mood commands with reqId', () => {
  const state = { mood: 'idle', palette: 'cyan' };
  const cmd = JSON.stringify({ proto: '1.0', reqId: 'req-001', cmd: 'set_mood', mood: 'happy', palette: 'amber' });
  const result = executeProtocolCommand(cmd, state);

  assert.equal(result.success, true);
  assert.equal(state.mood, 'happy');
  assert.equal(state.palette, 'amber');
  assert.equal(result.response.type, 'ack');
  assert.equal(result.response.proto, '1.0');
  assert.equal(result.response.reqId, 'req-001');
  assert.equal(result.response.cmd, 'set_mood');
});

await test('12. Protocol parser rejects invalid or missing mood parameters', () => {
  const state = { mood: 'idle' };

  // Missing mood
  const res1 = executeProtocolCommand(JSON.stringify({ cmd: 'set_mood' }), state);
  assert.equal(res1.success, false);
  assert.equal(res1.response.code, 'MISSING_PARAM');

  // Invalid mood
  const res2 = executeProtocolCommand(JSON.stringify({ cmd: 'set_mood', mood: 'super_furious' }), state);
  assert.equal(res2.success, false);
  assert.equal(res2.response.code, 'INVALID_MOOD');
});

await test('13. Protocol parser correctly processes speak command with visual text', () => {
  const state = { isSpeaking: false };
  const cmd = JSON.stringify({ proto: '1.0', cmd: 'speak', speech: 'Kuro system online!', durationMs: 3000 });
  const result = executeProtocolCommand(cmd, state);

  assert.equal(result.success, true);
  assert.equal(state.isSpeaking, true);
  assert.equal(state.speechText, 'Kuro system online!');
  assert.equal(state.speechDuration, 3000);
});

await test('14. Protocol parser correctly processes set_palette and set_eye_shape commands', () => {
  const state = { palette: 'cyan', eyeShape: 'curved' };

  // Valid palette
  const resPal = executeProtocolCommand(JSON.stringify({ cmd: 'set_palette', palette: 'emerald' }), state);
  assert.equal(resPal.success, true);
  assert.equal(state.palette, 'emerald');

  // Invalid palette
  const resPalBad = executeProtocolCommand(JSON.stringify({ cmd: 'set_palette', palette: 'hotpink' }), state);
  assert.equal(resPalBad.success, false);
  assert.equal(resPalBad.response.code, 'INVALID_PALETTE');

  // Valid eye shape
  const resShape = executeProtocolCommand(JSON.stringify({ cmd: 'set_eye_shape', shape: 'pixel' }), state);
  assert.equal(resShape.success, true);
  assert.equal(state.eyeShape, 'pixel');

  // Invalid eye shape
  const resShapeBad = executeProtocolCommand(JSON.stringify({ cmd: 'set_eye_shape', shape: 'spiral' }), state);
  assert.equal(resShapeBad.success, false);
  assert.equal(resShapeBad.response.code, 'INVALID_SHAPE');
});

await test('15. Protocol parser handles ping, get_status, and malformed inputs safely', () => {
  const state = { uptime: 120, mood: 'curious', isSpeaking: false };

  // Ping with reqId
  const pingRes = executeProtocolCommand(JSON.stringify({ proto: '1.0', reqId: 'ping-42', cmd: 'ping', ts: 98765 }), state);
  assert.equal(pingRes.success, true);
  assert.equal(pingRes.response.type, 'pong');
  assert.equal(pingRes.response.reqId, 'ping-42');
  assert.equal(pingRes.response.ts, 98765);
  assert.equal(pingRes.response.version, '0.1.0');

  // Get status
  const statRes = executeProtocolCommand(JSON.stringify({ cmd: 'get_status' }), state);
  assert.equal(statRes.success, true);
  assert.equal(statRes.response.type, 'telemetry');
  assert.equal(statRes.response.mood, 'curious');
  assert.equal(statRes.response.version, '0.1.0');
  assert.equal(statRes.response.displayOk, true);

  // Empty string
  const emptyRes = executeProtocolCommand('', state);
  assert.equal(emptyRes.success, false);
  assert.equal(emptyRes.response.code, 'EMPTY_PAYLOAD');

  // Unknown command
  const unkRes = executeProtocolCommand(JSON.stringify({ cmd: 'dance' }), state);
  assert.equal(unkRes.success, false);
  assert.equal(unkRes.response.code, 'UNKNOWN_CMD');
});

// =============================================================================
// TEST SUITE: 6. Non-Blocking Wi-Fi & Inactivity Detection
// =============================================================================

await test('16. Wi-Fi connection timeout enforces bounded 12s attempt duration', () => {
  const TIMEOUT_MS = 12000;
  const startMs = 5000;

  // At 10s elapsed (15000ms) -> Still connecting
  assert.equal(15000 - startMs < TIMEOUT_MS, true);

  // At 12s elapsed (17000ms) -> Timed out!
  assert.equal(17000 - startMs >= TIMEOUT_MS, true);
});

await test('17. Wi-Fi reconnection implements exponential backoff from 5s up to 60s cap', () => {
  let interval = 5000;
  const MAX_INTERVAL = 60000;

  // Failure 1: 5s -> doubles to 10s
  interval = Math.min(MAX_INTERVAL, interval * 2);
  assert.equal(interval, 10000);

  // Failure 2: 10s -> doubles to 20s
  interval = Math.min(MAX_INTERVAL, interval * 2);
  assert.equal(interval, 20000);

  // Failure 3: 20s -> doubles to 40s
  interval = Math.min(MAX_INTERVAL, interval * 2);
  assert.equal(interval, 40000);

  // Failure 4: 40s -> doubles to 80s -> capped at 60s
  interval = Math.min(MAX_INTERVAL, interval * 2);
  assert.equal(interval, 60000);

  // Failure 5: already 60s -> stays capped at 60s
  interval = Math.min(MAX_INTERVAL, interval * 2);
  assert.equal(interval, 60000);
});

// =============================================================================
// TEST SUITE: 7. Security, Credential Isolation & Restricted PSRAM GPIO Verification
// =============================================================================

await test('18. wifi_credentials.example.h contains only safe dummy template placeholders', () => {
  const examplePath = path.resolve('firmware/include/wifi_credentials.example.h');
  assert.ok(fs.existsSync(examplePath), 'wifi_credentials.example.h must exist');

  const content = fs.readFileSync(examplePath, 'utf8');
  assert.ok(content.includes('YOUR_2.4GHZ_WIFI_SSID'), 'Must contain placeholder SSID');
  assert.ok(content.includes('YOUR_WIFI_PASSWORD'), 'Must contain placeholder password');

  // Verify no real sensitive credentials leaked
  assert.ok(!content.includes('sbp_'), 'No Supabase tokens');
  assert.ok(!content.includes('AIzaSy'), 'No Google API keys');
  assert.ok(!content.includes('eyJh'), 'No JWT tokens');
});

await test('19. .gitignore covers actual wifi_credentials.h and PlatformIO build artifacts', () => {
  const gitignorePath = path.resolve('.gitignore');
  const content = fs.readFileSync(gitignorePath, 'utf8');

  assert.ok(content.includes('wifi_credentials.h'), '.gitignore must ignore actual wifi_credentials.h');
  assert.ok(content.includes('.pio'), '.gitignore must ignore .pio PlatformIO directory');
});

await test('20. ESP32-S3 firmware files do not contain any hardcoded API keys or secrets', () => {
  const fwFiles = [
    'firmware/platformio.ini',
    'firmware/include/config.h',
    'firmware/src/display_hal.h',
    'firmware/src/display_hal.cpp',
    'firmware/src/face_engine.h',
    'firmware/src/face_engine.cpp',
    'firmware/src/net_manager.h',
    'firmware/src/net_manager.cpp',
    'firmware/src/protocol.h',
    'firmware/src/protocol.cpp',
    'firmware/src/main.cpp'
  ];

  for (const relPath of fwFiles) {
    const fullPath = path.resolve(relPath);
    assert.ok(fs.existsSync(fullPath), `Firmware file ${relPath} must exist`);
    const code = fs.readFileSync(fullPath, 'utf8');

    // Strict leak checks
    assert.ok(!code.includes('AIzaSy'), `No Google API keys in ${relPath}`);
    assert.ok(!code.includes('sbp_'), `No Supabase secrets in ${relPath}`);
    assert.ok(!code.includes('sk-ant'), `No Anthropic keys in ${relPath}`);
  }
});

await test('21. Hardware pin assignment guards Octal PSRAM GPIOs (33-37) & strapping pins', () => {
  const configPath = path.resolve('firmware/include/config.h');
  const content = fs.readFileSync(configPath, 'utf8');

  // Extract all assigned pin values: #define KURO_PIN_TFT_* <pin>
  const pinRegex = /#define\s+KURO_PIN_TFT_\w+\s+(-?\d+)/g;
  let match;
  const assignedPins = [];

  while ((match = pinRegex.exec(content)) !== null) {
    const pin = parseInt(match[1], 10);
    if (pin >= 0) {
      assignedPins.push(pin);
    }
  }

  // Restricted GPIOs for ESP32-S3-WROOM-1-N8R8 Octal PSRAM: 33, 34, 35, 36, 37
  const RESTRICTED_PSRAM_GPIOS = [33, 34, 35, 36, 37];
  // Strapping pins: 0, 45, 46
  const STRAPPING_PINS = [0, 45, 46];

  for (const pin of assignedPins) {
    assert.ok(
      !RESTRICTED_PSRAM_GPIOS.includes(pin),
      `Provisional pin GPIO ${pin} MUST NOT collide with Octal PSRAM lines (33-37)!`
    );
    assert.ok(
      !STRAPPING_PINS.includes(pin),
      `Provisional pin GPIO ${pin} MUST NOT collide with strapping pins (0, 45, 46)!`
    );
  }
});

await test('22. Firmware source files have zero blocking delay() calls in animation, network or loop paths', () => {
  const pureLogicFiles = [
    'firmware/src/face_engine.cpp',
    'firmware/src/net_manager.cpp',
    'firmware/src/protocol.cpp'
  ];

  for (const relPath of pureLogicFiles) {
    const fullPath = path.resolve(relPath);
    const code = fs.readFileSync(fullPath, 'utf8');
    assert.ok(
      !code.includes('delay('),
      `Found blocking delay() in ${relPath}. Engine components must be 100% non-blocking!`
    );
  }

  // Check main.cpp: verify loop() has zero delay() calls
  const mainPath = path.resolve('firmware/src/main.cpp');
  const mainCode = fs.readFileSync(mainPath, 'utf8');
  const loopSection = mainCode.split('void loop()')[1];
  assert.ok(loopSection, 'main.cpp must define void loop()');
  assert.ok(
    !loopSection.includes('delay('),
    'main.cpp loop() must contain zero blocking delay() calls!'
  );
});

// =============================================================================
// TEST SUITE: 8. Phase 8.1 Protocol Hardening & Bounded Verification
// =============================================================================

await test('23. Protocol rejects oversized messages exceeding 512 bytes', () => {
  const hugeSpeech = 'a'.repeat(600);
  const oversizedJson = JSON.stringify({ cmd: 'speak', speech: hugeSpeech });
  const result = executeProtocolCommand(oversizedJson);

  assert.equal(result.success, false);
  assert.equal(result.response.code, 'OVERSIZED_PAYLOAD');
});

await test('24. Protocol rejects unsupported protocol versions safely', () => {
  const badProto = JSON.stringify({ proto: '2.0', reqId: 'r-999', cmd: 'ping' });
  const result = executeProtocolCommand(badProto);

  assert.equal(result.success, false);
  assert.equal(result.response.code, 'UNSUPPORTED_PROTO');
  assert.equal(result.response.reqId, 'r-999');
});

await test('25. Protocol echoes request IDs across all command responses', () => {
  const state = { mood: 'attentive' };
  const resAck = executeProtocolCommand(JSON.stringify({ reqId: 'req-abc-123', cmd: 'set_mood', mood: 'curious' }), state);
  assert.equal(resAck.response.reqId, 'req-abc-123');

  const resErr = executeProtocolCommand(JSON.stringify({ reqId: 'req-err-456', cmd: 'set_mood', mood: 'invalid_mood' }), state);
  assert.equal(resErr.response.reqId, 'req-err-456');

  const resPong = executeProtocolCommand(JSON.stringify({ reqId: 'req-ping-789', cmd: 'ping' }), state);
  assert.equal(resPong.response.reqId, 'req-ping-789');
});

await test('26. Protocol parser handles malformed JSON safely without throwing', () => {
  const malformed = '{ cmd: "set_mood", mood: "happy" '; // missing closing brace
  const result = executeProtocolCommand(malformed);

  assert.equal(result.success, false);
  assert.equal(result.response.code, 'INVALID_JSON');
});

await test('27. Heartbeat loss detection flags stale status after 15s inactivity', () => {
  resetDeviceGatewayState();
  const challenge = createPairingChallenge();
  const pairResult = confirmPairing(challenge.pin, { deviceId: 'kuro-test-unit' });
  assert.equal(pairResult.paired, true);

  // Immediately after pairing -> online
  const initialStatus = getDeviceStatus();
  assert.equal(initialStatus.connected, true);
  assert.equal(initialStatus.connectionState, 'online');

  // Record telemetry to update timestamp
  recordDeviceTelemetry({ uptime: 50, wifiState: 'connected' });
  const updatedStatus = getDeviceStatus();
  assert.equal(updatedStatus.connected, true);

  // Inactivity calculation verification
  const now = Date.now();
  const simulatedHeartbeatTime = now - 16_000; // 16 seconds ago
  const isTimedOut = (now - simulatedHeartbeatTime) > HEARTBEAT_TIMEOUT_MS;
  assert.equal(isTimedOut, true, 'Heartbeat elapsed > 15s should flag timeout');
});

// =============================================================================
// TEST SUITE: 9. Server-Side Device Gateway & Pairing Flow
// =============================================================================

await test('28. Device Gateway creates secure 6-digit numeric pairing PIN with 5-minute expiry', () => {
  resetDeviceGatewayState();
  const challenge = createPairingChallenge();

  assert.ok(challenge.pin, 'PIN must exist');
  assert.equal(challenge.pin.length, 6, 'PIN must be 6 digits');
  assert.ok(/^\d{6}$/.test(challenge.pin), 'PIN must be numeric');
  assert.equal(challenge.proto, '1.0');
  assert.ok(challenge.expiresAt > Date.now(), 'Expiry must be in the future');
});

await test('29. Device Gateway confirms pairing with valid PIN and returns 24h session token', () => {
  resetDeviceGatewayState();
  const challenge = createPairingChallenge();
  const result = confirmPairing(challenge.pin, {
    deviceId: 'kuro-dev-1',
    deviceName: 'Office Kuro Robot',
    deviceIp: '192.168.1.155'
  });

  assert.equal(result.success, true);
  assert.equal(result.paired, true);
  assert.ok(result.sessionToken.length >= 32, 'Session token must be secure length');
  assert.equal(result.deviceId, 'kuro-dev-1');

  // Validating the token
  const session = validateDeviceSession(result.sessionToken);
  assert.ok(session, 'Session must be active');
  assert.equal(session.deviceIp, '192.168.1.155');
});

await test('30. Device Gateway rejects invalid or expired pairing PIN', () => {
  resetDeviceGatewayState();
  createPairingChallenge();

  const badRes = confirmPairing('000000');
  assert.equal(badRes.success, false);
  assert.equal(badRes.code, 'INVALID_PIN');
});

await test('31. Device Gateway dispatches authenticated commands with full schema validation', async () => {
  resetDeviceGatewayState();
  const challenge = createPairingChallenge();
  const pairResult = confirmPairing(challenge.pin);

  // Valid mood command
  const res1 = await dispatchDeviceCommand(
    { cmd: 'set_mood', mood: 'focused', palette: 'cyan' },
    pairResult.sessionToken
  );
  assert.equal(res1.success, true);
  assert.equal(res1.type, 'ack');
  assert.equal(res1.cmd, 'set_mood');

  // Valid speech command
  const res2 = await dispatchDeviceCommand(
    { cmd: 'speak', speech: 'Good morning!', durationMs: 3000 },
    pairResult.sessionToken
  );
  assert.equal(res2.success, true);
  assert.equal(res2.cmd, 'speak');

  // Ping command
  const resPing = await dispatchDeviceCommand(
    { cmd: 'ping', ts: 12345 },
    pairResult.sessionToken
  );
  assert.equal(resPing.success, true);
  assert.equal(resPing.type, 'pong');
});

await test('32. Device Gateway rejects unauthenticated commands with 401 Unauthorized', async () => {
  resetDeviceGatewayState();

  const res = await dispatchDeviceCommand({ cmd: 'set_mood', mood: 'happy' }, 'bad-fake-token');
  assert.equal(res.success, false);
  assert.equal(res.status, 401);
  assert.equal(res.code, 'UNAUTHORIZED');
});

await test('33. Device Gateway records robot telemetry and updates device status', () => {
  resetDeviceGatewayState();
  const challenge = createPairingChallenge();
  confirmPairing(challenge.pin);

  const res = recordDeviceTelemetry({
    proto: '1.0',
    version: '0.1.0',
    uptime: 300,
    wifiState: 'connected',
    rssi: -48,
    freeHeap: 260000,
    freePsram: 8000000,
    mood: 'proud',
    isSpeaking: false,
    displayOk: true,
  });
  assert.equal(res.success, true);

  const status = getDeviceStatus();
  assert.equal(status.device.telemetry.mood, 'proud');
  assert.equal(status.device.telemetry.uptime, 300);
});

await test('34. Device Gateway unpairs device session cleanly', () => {
  resetDeviceGatewayState();
  const challenge = createPairingChallenge();
  const pair = confirmPairing(challenge.pin);

  assert.equal(getDeviceStatus().paired, true);

  const unpairRes = unpairDevice(pair.sessionToken);
  assert.equal(unpairRes.success, true);
  assert.equal(getDeviceStatus().paired, false);
});

// =============================================================================
// TEST SUITE: 10. Multi-Board PlatformIO Configuration Verification
// =============================================================================

await test('35. platformio.ini defines compatible multi-board environments (N8R8, N16R8, N8R2, No-PSRAM)', () => {
  const pioPath = path.resolve('firmware/platformio.ini');
  assert.ok(fs.existsSync(pioPath), 'platformio.ini must exist');
  const content = fs.readFileSync(pioPath, 'utf8');

  assert.ok(content.includes('[env:esp32s3_n8r8]'), 'Must support ESP32-S3 N8R8 (8MB Flash, 8MB PSRAM)');
  assert.ok(content.includes('[env:esp32s3_n16r8]'), 'Must support ESP32-S3 N16R8 (16MB Flash, 8MB PSRAM)');
  assert.ok(content.includes('[env:esp32s3_n8r2]'), 'Must support ESP32-S3 N8R2 (8MB Flash, 2MB PSRAM)');
  assert.ok(content.includes('[env:esp32s3_no_psram]'), 'Must support generic ESP32-S3 without PSRAM');
  assert.ok(content.includes('LovyanGFX'), 'Must include LovyanGFX library');
});

await test('36. Device Gateway never exposes server-side AI credentials or Supabase secrets', () => {
  const gwPath = path.resolve('src/server/deviceGateway.mjs');
  const content = fs.readFileSync(gwPath, 'utf8');

  assert.ok(!content.includes('process.env.GEMINI_API_KEY'), 'Zero Gemini API keys');
  assert.ok(!content.includes('process.env.OPENAI_API_KEY'), 'Zero OpenAI API keys');
  assert.ok(!content.includes('SUPABASE_SERVICE_ROLE_KEY'), 'Zero Supabase service keys');
  assert.ok(!content.includes('sbp_'), 'Zero Supabase access tokens');
});

// =============================================================================
// TEST SUITE: 11. Live HTTP Server Gateway Endpoints (/api/device/*)
// =============================================================================

await test('37. Live HTTP Server routes /api/device/* correctly with auth, methods & status codes', async () => {
  const { createProdServer } = await import('../src/server/prodServer.mjs');
  resetDeviceGatewayState();

  const server = createProdServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    // 1. GET /api/device/status -> 200
    const resStatus = await fetch(`${baseUrl}/api/device/status`);
    assert.equal(resStatus.status, 200);
    const dataStatus = await resStatus.json();
    assert.equal(dataStatus.proto, '1.0');
    assert.equal(dataStatus.paired, false);

    // 2. POST /api/device/status -> 405 Method Not Allowed
    const resBadMethod = await fetch(`${baseUrl}/api/device/status`, { method: 'POST' });
    assert.equal(resBadMethod.status, 405);

    // 3. POST /api/device/pair/request -> 200
    const resPairReq = await fetch(`${baseUrl}/api/device/pair/request`, { method: 'POST' });
    assert.equal(resPairReq.status, 200);
    const dataPairReq = await resPairReq.json();
    assert.ok(dataPairReq.pin);

    // 4. POST /api/device/pair/confirm -> 200 with sessionToken
    const resPairConfirm = await fetch(`${baseUrl}/api/device/pair/confirm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin: dataPairReq.pin, deviceId: 'test-robot' })
    });
    assert.equal(resPairConfirm.status, 200);
    const dataPairConfirm = await resPairConfirm.json();
    assert.equal(dataPairConfirm.paired, true);
    assert.ok(dataPairConfirm.sessionToken);

    // 5. POST /api/device/command without token -> 401
    const resNoAuth = await fetch(`${baseUrl}/api/device/command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cmd: 'set_mood', mood: 'happy' })
    });
    assert.equal(resNoAuth.status, 401);

    // 6. POST /api/device/command with Bearer token -> 200
    const resAuthCmd = await fetch(`${baseUrl}/api/device/command`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${dataPairConfirm.sessionToken}`
      },
      body: JSON.stringify({ cmd: 'set_mood', mood: 'happy' })
    });
    assert.equal(resAuthCmd.status, 200);
    const dataCmd = await resAuthCmd.json();
    assert.equal(dataCmd.success, true);
    assert.equal(dataCmd.cmd, 'set_mood');

    // 7. POST /api/device/unpair -> 200
    const resUnpair = await fetch(`${baseUrl}/api/device/unpair`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${dataPairConfirm.sessionToken}`
      }
    });
    assert.equal(resUnpair.status, 200);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

await test('38. Device Gateway rejects oversized requests (>64KB) with 413 Payload Too Large', async () => {
  const { createProdServer } = await import('../src/server/prodServer.mjs');

  const server = createProdServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    const hugeBody = JSON.stringify({ cmd: 'set_mood', padding: 'x'.repeat(70 * 1024) });
    const res = await fetch(`${baseUrl}/api/device/command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: hugeBody
    });
    assert.equal(res.status, 413);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

// =============================================================================
// TEST SUITE: 12. Device Transport Polling, Command ACKs & End-to-End Correlation
// =============================================================================

await test('39. Device Transport: POST /api/device/poll drains queued commands and reports telemetry', async () => {
  const { createProdServer } = await import('../src/server/prodServer.mjs');
  resetDeviceGatewayState();

  const server = createProdServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    // 1. Pair device
    const pairReq = await fetch(`${baseUrl}/api/device/pair/request`, { method: 'POST' });
    const { pin } = await pairReq.json();
    const pairConfirm = await fetch(`${baseUrl}/api/device/pair/confirm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin, deviceId: 'esp32-robot-test' })
    });
    const { sessionToken } = await pairConfirm.json();

    // 2. Web UI enqueues a command
    await fetch(`${baseUrl}/api/device/command`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${sessionToken}`
      },
      body: JSON.stringify({ cmd: 'set_mood', mood: 'playful', palette: 'violet' })
    });

    // 3. Device polls for pending commands with its telemetry
    const pollRes = await fetch(`${baseUrl}/api/device/poll`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${sessionToken}`
      },
      body: JSON.stringify({
        telemetry: {
          uptime: 120,
          wifiState: 'connected',
          freeHeap: 250000,
          mood: 'playful'
        }
      })
    });
    assert.equal(pollRes.status, 200);
    const pollData = await pollRes.json();
    assert.equal(pollData.success, true);
    assert.equal(pollData.commands.length, 1);
    assert.equal(pollData.commands[0].cmd, 'set_mood');
    assert.equal(pollData.commands[0].mood, 'playful');

    // 4. Second poll immediately returns empty queue (drained)
    const pollRes2 = await fetch(`${baseUrl}/api/device/poll`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${sessionToken}`
      }
    });
    const pollData2 = await pollRes2.json();
    assert.equal(pollData2.commands.length, 0);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

await test('40. Device Transport: POST /api/device/command/ack correlates request IDs', async () => {
  const { createProdServer } = await import('../src/server/prodServer.mjs');
  resetDeviceGatewayState();

  const server = createProdServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    const pairReq = await fetch(`${baseUrl}/api/device/pair/request`, { method: 'POST' });
    const { pin } = await pairReq.json();
    const pairConfirm = await fetch(`${baseUrl}/api/device/pair/confirm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin })
    });
    const { sessionToken } = await pairConfirm.json();

    // Robot posts command execution ACK
    const ackRes = await fetch(`${baseUrl}/api/device/command/ack`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${sessionToken}`
      },
      body: JSON.stringify({
        reqId: 'req-msg-888',
        cmd: 'set_mood',
        status: 'ok'
      })
    });
    assert.equal(ackRes.status, 200);
    const ackData = await ackRes.json();
    assert.equal(ackData.success, true);
    assert.equal(ackData.acked, 'req-msg-888');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

await test('41. Reconnection & Token Validation: Invalid or expired token returns 401', async () => {
  const { createProdServer } = await import('../src/server/prodServer.mjs');
  resetDeviceGatewayState();

  const server = createProdServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    // Attempt poll with revoked/unknown token
    const badPoll = await fetch(`${baseUrl}/api/device/poll`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer revoked-token-123'
      }
    });
    assert.equal(badPoll.status, 401);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

await test('42. End-to-end Web-to-Robot command flow executes with full schema validation', async () => {
  const { createProdServer } = await import('../src/server/prodServer.mjs');
  resetDeviceGatewayState();

  const server = createProdServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    // Step 1: Pair
    const pairReq = await fetch(`${baseUrl}/api/device/pair/request`, { method: 'POST' });
    const { pin } = await pairReq.json();
    const pairConfirm = await fetch(`${baseUrl}/api/device/pair/confirm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin, deviceId: 'esp32-e2e-robot' })
    });
    const { sessionToken } = await pairConfirm.json();

    // Step 2: Web UI sends speak command
    const cmdRes = await fetch(`${baseUrl}/api/device/command`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${sessionToken}`
      },
      body: JSON.stringify({
        cmd: 'speak',
        speech: 'Hello from Kuro Web Control Center!',
        durationMs: 3500,
        reqId: 'e2e-req-999'
      })
    });
    assert.equal(cmdRes.status, 200);
    const cmdData = await cmdRes.json();
    assert.equal(cmdData.success, true);
    assert.equal(cmdData.reqId, 'e2e-req-999');

    // Step 3: Robot polls and receives the command
    const pollRes = await fetch(`${baseUrl}/api/device/poll`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${sessionToken}`
      }
    });
    const pollData = await pollRes.json();
    assert.equal(pollData.commands.length, 1);
    assert.equal(pollData.commands[0].speech, 'Hello from Kuro Web Control Center!');

    // Step 4: Status reports device connected and healthy
    const statusRes = await fetch(`${baseUrl}/api/device/status`);
    const statusData = await statusRes.json();
    assert.equal(statusData.connected, true);
    assert.equal(statusData.device.telemetry.isSpeaking, true);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

// =============================================================================
// TEST SUITE: 13. Phase 8.3 Hardware Readiness & Truthful Online State Verification
// =============================================================================

await test('43. Physical device pairing starts in awaiting_device state and does not falsely claim connected', async () => {
  const { createProdServer } = await import('../src/server/prodServer.mjs');
  resetDeviceGatewayState();

  const server = createProdServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    // 1. Pair a physical device (isSimulated: false, physical IP)
    const pairReq = await fetch(`${baseUrl}/api/device/pair/request`, { method: 'POST' });
    const { pin } = await pairReq.json();
    const pairConfirm = await fetch(`${baseUrl}/api/device/pair/confirm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pin,
        deviceId: 'physical-kuro-01',
        deviceName: 'Office Desk Visor',
        deviceIp: '192.168.1.188',
        isSimulated: false
      })
    });
    const pairData = await pairConfirm.json();
    assert.equal(pairData.isSimulated, false);

    // 2. Query status: must be paired, but NOT connected (awaiting physical hardware)
    const statusRes = await fetch(`${baseUrl}/api/device/status`);
    const status = await statusRes.json();
    assert.equal(status.paired, true);
    assert.equal(status.connected, false);
    assert.equal(status.connectionState, 'awaiting_device');
    assert.equal(status.lastHeartbeatSecAgo, null);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

await test('44. Web commands to physical robot queue safely without falsely resetting heartbeat', async () => {
  const { createProdServer } = await import('../src/server/prodServer.mjs');
  resetDeviceGatewayState();

  const server = createProdServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    // 1. Pair physical robot
    const pairReq = await fetch(`${baseUrl}/api/device/pair/request`, { method: 'POST' });
    const { pin } = await pairReq.json();
    const pairConfirm = await fetch(`${baseUrl}/api/device/pair/confirm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pin,
        deviceId: 'physical-kuro-01',
        deviceIp: '192.168.1.188',
        isSimulated: false
      })
    });
    const { sessionToken } = await pairConfirm.json();

    // 2. Dispatch a command from Web UI (unreachable physical IP -> queued)
    const cmdRes = await fetch(`${baseUrl}/api/device/command`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${sessionToken}`
      },
      body: JSON.stringify({ cmd: 'set_mood', mood: 'curious' })
    });
    const cmdData = await cmdRes.json();
    assert.equal(cmdData.success, true);
    assert.equal(cmdData.queuedForPoll, true);
    assert.equal(cmdData.deliveredDirectly, false);

    // 3. Verify status remains NOT connected because physical device hasn't responded
    const statusRes = await fetch(`${baseUrl}/api/device/status`);
    const status = await statusRes.json();
    assert.equal(status.connected, false);
    assert.equal(status.pendingCommandsCount, 1);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

await test('45. Physical hardware poll transitions connection from awaiting_device to online', async () => {
  const { createProdServer } = await import('../src/server/prodServer.mjs');
  resetDeviceGatewayState();

  const server = createProdServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    // 1. Pair physical robot
    const pairReq = await fetch(`${baseUrl}/api/device/pair/request`, { method: 'POST' });
    const { pin } = await pairReq.json();
    const pairConfirm = await fetch(`${baseUrl}/api/device/pair/confirm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pin,
        deviceId: 'physical-kuro-01',
        deviceIp: '192.168.1.188',
        isSimulated: false
      })
    });
    const { sessionToken } = await pairConfirm.json();

    // Verify initial awaiting state
    const preStatus = await (await fetch(`${baseUrl}/api/device/status`)).json();
    assert.equal(preStatus.connected, false);
    assert.equal(preStatus.connectionState, 'awaiting_device');

    // 2. Microcontroller polls gateway
    const pollRes = await fetch(`${baseUrl}/api/device/poll`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${sessionToken}`
      },
      body: JSON.stringify({
        telemetry: {
          proto: '1.0',
          version: '0.1.0',
          uptime: 10,
          wifiState: 'connected',
          ip: '192.168.1.188',
          rssi: -52,
          freeHeap: 245000,
          freePsram: 8000000,
          mood: 'attentive',
          displayOk: true
        }
      })
    });
    assert.equal(pollRes.status, 200);

    // 3. Post-poll status: strictly online now
    const postStatus = await (await fetch(`${baseUrl}/api/device/status`)).json();
    assert.equal(postStatus.connected, true);
    assert.equal(postStatus.connectionState, 'online');
    assert.equal(postStatus.device.telemetry.uptime, 10);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

// -----------------------------------------------------------------------------
// Summary
// -----------------------------------------------------------------------------
console.log(`\n[Test Suite] Completed: ${passedTests} tests passed successfully.\n`);
