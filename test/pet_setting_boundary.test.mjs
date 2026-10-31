import assert from 'node:assert/strict';
import { normalizePetSettingInt } from '../src/lib/adapters.ts';

console.log('=== KURO PET SETTING BOUNDARY & UI CONTRACT VERIFICATION ===\n');

// 1. Boundary & UI contract tests
const cases = [
  { input: 0, expected: 0, desc: 'Zero (0%)' },
  { input: 0.01, expected: 1, desc: 'Small decimal 0.01 -> 1%' },
  { input: 0.5, expected: 50, desc: 'Half decimal 0.5 -> 50%' },
  { input: 0.85, expected: 85, desc: 'Standard decimal 0.85 -> 85%' },
  { input: 0.99, expected: 99, desc: 'High decimal 0.99 -> 99%' },
  { input: 1, expected: 1, desc: 'UI slider value 1 -> 1% (NOT 100%)' },
  { input: 1.5, expected: 2, desc: 'Fractional percentage 1.5 -> rounded 2%' },
  { input: 50, expected: 50, desc: 'Integer percentage 50%' },
  { input: 100, expected: 100, desc: 'Integer percentage 100%' },
  { input: -10, expected: 0, desc: 'Negative out-of-range clamped to 0%' },
  { input: 150, expected: 100, desc: 'High out-of-range clamped to 100%' },
  { input: null, expected: 70, desc: 'Null returns fallback (70)' },
  { input: undefined, expected: 70, desc: 'Undefined returns fallback (70)' },
  { input: undefined, fallback: 85, expected: 85, desc: 'Undefined returns custom fallback (85)' },
  { input: '0.85', expected: 85, desc: 'String decimal "0.85" -> 85%' },
  { input: '1', expected: 1, desc: 'String "1" -> 1%' },
  { input: '50', expected: 50, desc: 'String "50" -> 50%' },
  { input: '', expected: 70, desc: 'Empty string returns fallback' },
  { input: 'invalid', expected: 70, desc: 'Invalid string returns fallback' },
  { input: NaN, expected: 70, desc: 'NaN returns fallback' },
];

let passCount = 0;
for (const tc of cases) {
  const result = normalizePetSettingInt(tc.input, tc.fallback ?? 70);
  assert.equal(
    result,
    tc.expected,
    `Failed for ${tc.desc}: got ${result}, expected ${tc.expected}`
  );
  console.log(`  ✓ PASS: ${tc.desc.padEnd(45)} -> ${result}`);
  passCount++;
}

console.log(`\nAll ${passCount} normalizePetSettingInt boundary test assertions PASSED!\n`);

