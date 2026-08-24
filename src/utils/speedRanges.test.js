import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  SPEED_RANGES,
  clampSpeed,
  clampMeasuredSpeedPair,
  formatClampNotice
} from './speedRanges.js';

describe('SPEED_RANGES (#850)', () => {
  test('mirrors the declared SpeedControls slider bounds', () => {
    assert.deepEqual(SPEED_RANGES.prefill, { min: 50, max: 50000, step: 50 });
    assert.deepEqual(SPEED_RANGES.decode, { min: 2, max: 1000, step: 1 });
  });
});

describe('clampSpeed (#850)', () => {
  test('passes in-range values through unchanged', () => {
    assert.equal(clampSpeed(950, 'decode'), 950);
    assert.equal(clampSpeed(3800, 'prefill'), 3800);
    assert.equal(clampSpeed(50, 'prefill'), 50);
    assert.equal(clampSpeed(1000, 'decode'), 1000);
  });

  test('clamps measured community speeds beyond the range', () => {
    // Worst cases from production /api/runs cited in #850.
    assert.equal(clampSpeed(36716, 'decode'), 1000);
    assert.equal(clampSpeed(471382, 'prefill'), 50000);
  });

  test('floors sub-minimum values', () => {
    assert.equal(clampSpeed(1, 'decode'), 2);
    assert.equal(clampSpeed(10, 'prefill'), 50);
  });

  test('returns null for unusable input and unknown axes', () => {
    assert.equal(clampSpeed(NaN, 'decode'), null);
    assert.equal(clampSpeed(undefined, 'prefill'), null);
    assert.equal(clampSpeed(-5, 'decode'), null);
    assert.equal(clampSpeed(100, 'bogus'), null);
  });
});

describe('clampMeasuredSpeedPair (#850)', () => {
  test('in-range pair applies verbatim with no clamped entries', () => {
    const pair = clampMeasuredSpeedPair(3800, 105);
    assert.equal(pair.prefill, 3800);
    assert.equal(pair.decode, 105);
    assert.deepEqual(pair.clamped, []);
  });

  test('mixed pair clamps only the offending axis', () => {
    const pair = clampMeasuredSpeedPair(471382, 3.478);
    assert.equal(pair.prefill, 50000);
    assert.equal(pair.decode, 3.478);
    assert.deepEqual(pair.clamped, [
      { axis: 'prefill', requested: 471382, applied: 50000 }
    ]);
  });

  test('returns null when either axis is unusable (apply rejected)', () => {
    assert.equal(clampMeasuredSpeedPair(0, 100), null);
    assert.equal(clampMeasuredSpeedPair(1000, 'nope'), null);
  });

  test('regression: applied run never exceeds the slider max', () => {
    const worstDecode = clampMeasuredSpeedPair(10.2885223174, 36716);
    assert.ok(worstDecode.decode <= SPEED_RANGES.decode.max);
    const worstPrefill = clampMeasuredSpeedPair(471382, 900);
    assert.ok(worstPrefill.prefill <= SPEED_RANGES.prefill.max);
  });
});

describe('formatClampNotice (#850)', () => {
  test('empty string when nothing was clamped', () => {
    assert.equal(formatClampNotice([]), '');
    assert.equal(formatClampNotice(null), '');
  });

  test('names each clamped axis with requested → applied values', () => {
    const text = formatClampNotice([
      { axis: 'decode', requested: 36716, applied: 1000 }
    ]);
    assert.match(text, /decode/);
    assert.match(text, /36,716|36716/);
    assert.match(text, /1,000|1000/);
  });
});
