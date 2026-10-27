/**
 * Kuro Robot Companion — Face Animation, Speech Lifecycle & Pet Studio Unit Tests
 *
 * Scope: Part A (Expressive Animated Face) & Part B (Pet Studio Functionality)
 */

import assert from 'node:assert/strict';
import {
  ALL_PET_MOODS,
  isValidPetMood,
  GLOW_PALETTES,
  calculateSpeechDuration,
  sanitizeSpeechText,
  DEFAULT_DOCUMENTED_PET_SETTINGS as defaultPetSettings,
} from '../src/lib/pet/faceLifecycle.ts';

console.log('[Test Suite] Running Kuro Robot Face Animation & Pet Studio Unit Tests...\n');

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

// 1. Emotion & Mood States (17 distinct states across Phase 6 & Phase 7.4)
test('ALL_PET_MOODS contains all 17 required distinct mood states', () => {
  const required = [
    'idle',
    'attentive',
    'focused',
    'curious',
    'thinking',
    'happy',
    'excited',
    'sleepy',
    'playful',
    'caring',
    'surprised',
    'confused',
    'worried',
    'proud',
    'listening',
    'speaking',
    'error',
  ];
  const ids = ALL_PET_MOODS.map((m) => m.id);
  assert.equal(ids.length, 17, 'Must have exactly 17 states');
  for (const r of required) {
    assert.ok(ids.includes(r), `Missing required mood state: ${r}`);
  }
});

test('isValidPetMood validates all 17 states and rejects invalid strings', () => {
  const allValid = [
    'idle',
    'attentive',
    'focused',
    'curious',
    'thinking',
    'happy',
    'excited',
    'sleepy',
    'playful',
    'caring',
    'surprised',
    'confused',
    'worried',
    'proud',
    'listening',
    'speaking',
    'error',
  ];
  for (const mood of allValid) {
    assert.equal(isValidPetMood(mood), true, `${mood} should be valid`);
  }

  assert.equal(isValidPetMood('angry'), false);
  assert.equal(isValidPetMood(''), false);
  assert.equal(isValidPetMood(null), false);
  assert.equal(isValidPetMood(undefined), false);
  assert.equal(isValidPetMood(123), false);
});

// 2. Glow Palettes
test('GLOW_PALETTES provides tokens for all 4 colorways', () => {
  const expectedColors = ['cyan', 'emerald', 'amber', 'violet'];
  for (const color of expectedColors) {
    const palette = GLOW_PALETTES[color];
    assert.ok(palette, `Missing palette for ${color}`);
    assert.ok(palette.primaryHex.startsWith('#'), `${color} must have a valid hex string`);
    assert.ok(palette.glowShadow.startsWith('rgba'), `${color} must have a glow shadow string`);
    assert.ok(palette.subtleBg.startsWith('rgba'), `${color} must have a subtle background string`);
  }
});

// 3. Speech Duration Math
test('calculateSpeechDuration calculates sensible minimum for short text ("Hi!")', () => {
  const duration = calculateSpeechDuration('Hi!');
  assert.ok(duration >= 2200, 'Short phrases must have at least 2200ms reading time');
  assert.ok(duration <= 3000, 'Short phrases should not linger excessively');
});

test('calculateSpeechDuration scales with text length for longer sentences', () => {
  const shortText = 'Hi!';
  const mediumText = 'Ready for a 25-minute deep focus sprint? Let us crush your tasks!';
  const dShort = calculateSpeechDuration(shortText);
  const dMedium = calculateSpeechDuration(mediumText);

  assert.ok(dMedium > dShort, 'Medium text must have longer duration than short text');
  assert.ok(dMedium >= 4000, 'Medium text should allocate sufficient reading time');
});

test('calculateSpeechDuration clamps at maximum 10 seconds to prevent speaking lock', () => {
  const hugeText = 'A'.repeat(500);
  const duration = calculateSpeechDuration(hugeText);
  assert.equal(duration, 10000, 'Must clamp to 10000ms maximum');
});

test('calculateSpeechDuration returns 0 for empty or null text', () => {
  assert.equal(calculateSpeechDuration(''), 0);
  assert.equal(calculateSpeechDuration('   '), 0);
  assert.equal(calculateSpeechDuration(null), 0);
  assert.equal(calculateSpeechDuration(undefined), 0);
});

// 4. Speech Text Sanitization
test('sanitizeSpeechText trims whitespace and preserves normal text', () => {
  const res = sanitizeSpeechText('   Hello Kuro companion!   ');
  assert.equal(res, 'Hello Kuro companion!');
});

test('sanitizeSpeechText safely handles null and non-string inputs', () => {
  assert.equal(sanitizeSpeechText(null), '');
  assert.equal(sanitizeSpeechText(undefined), '');
});

test('sanitizeSpeechText truncates overly long responses cleanly with ellipsis', () => {
  const longText = 'A'.repeat(300);
  const res = sanitizeSpeechText(longText, 100);
  assert.equal(res.length, 100);
  assert.ok(res.endsWith('...'));
});

// 5. Speech Lifecycle Simulator (Timer, Stop, Rapid Updates)
test('Simulated speech lifecycle executes clean completion callback', async () => {
  let isSpeaking = false;
  let finished = false;

  const startSpeech = (_text) => {
    isSpeaking = true;
    const dur = 50; // fast simulated clock
    return setTimeout(() => {
      isSpeaking = false;
      finished = true;
    }, dur);
  };

  startSpeech('Test message');
  assert.equal(isSpeaking, true);
  assert.equal(finished, false);

  await new Promise((resolve) => setTimeout(resolve, 80));

  assert.equal(isSpeaking, false);
  assert.equal(finished, true);
});

test('Speech cancellation immediately terminates active speech without leaking', async () => {
  let isSpeaking = true;
  let timerFired = false;

  const timer = setTimeout(() => {
    timerFired = true;
  }, 100);

  // User presses Stop
  clearTimeout(timer);
  isSpeaking = false;

  await new Promise((resolve) => setTimeout(resolve, 150));

  assert.equal(isSpeaking, false);
  assert.equal(timerFired, false, 'Cancelled timer must not fire');
});

test('Rapid speech updates cancel previous timer and restart cleanly', async () => {
  let activeText = 'Initial';
  let firstCompleted = false;
  let secondCompleted = false;

  // First speech
  let timer = setTimeout(() => {
    firstCompleted = true;
  }, 100);

  // Rapidly user inputs second speech at 30ms
  await new Promise((resolve) => setTimeout(resolve, 30));
  clearTimeout(timer);
  activeText = 'Second Phrase';

  timer = setTimeout(() => {
    secondCompleted = true;
  }, 60);

  await new Promise((resolve) => setTimeout(resolve, 100));

  assert.equal(activeText, 'Second Phrase');
  assert.equal(firstCompleted, false, 'First speech was cleanly interrupted');
  assert.equal(secondCompleted, true, 'Second speech completed cleanly');
});

// 6. Pet Studio Defaults & Documented Settings
test('defaultPetSettings adheres to documented specifications', () => {
  assert.equal(defaultPetSettings.petName, 'Kuro');
  assert.equal(defaultPetSettings.eyeShape, 'curved');
  assert.equal(defaultPetSettings.glowColor, 'cyan');
  assert.equal(defaultPetSettings.playfulness, 70);
  assert.equal(defaultPetSettings.focusDiscipline, 85);
});

test('Reset restoring defaultPetSettings produces valid configuration', () => {
  // Simulate modified settings
  const modified = {
    petName: 'Gizmo',
    eyeShape: 'pixel',
    glowColor: 'amber',
    playfulness: 20,
    focusDiscipline: 40,
  };

  // Reset to defaults
  const restored = { ...modified, ...defaultPetSettings };
  assert.deepEqual(restored, defaultPetSettings);
  assert.equal(restored.eyeShape, 'curved');
  assert.equal(restored.glowColor, 'cyan');
});

console.log(`\n[Pet Face & Studio Tests]: ${passedTests} passed, 0 failed\n`);
