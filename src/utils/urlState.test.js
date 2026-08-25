import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clampNum } from './urlState.js';

// clampNum backs the number-twin inputs (#409) and the URL-param clamps
// (#416): out-of-range values normalize to the slider bounds instead of
// leaving the field, the state and the share URL disagreeing.

test('clampNum keeps in-range values untouched', () => {
  assert.equal(clampNum(777, 2, 1000), 777);
  assert.equal(clampNum(0, -10, 10), 0);
  assert.equal(clampNum(5), 5);
});

test('clampNum clamps to the given bounds (#409 #416)', () => {
  assert.equal(clampNum(-100, 50, 50000), 50);
  assert.equal(clampNum(999999999, 50, 50000), 50000);
  assert.equal(clampNum(500, 1, 200), 200);
  // Open-ended bounds: only the provided side applies.
  assert.equal(clampNum(1e9, undefined, 200), 200);
  assert.equal(clampNum(-5, 1, undefined), 1);
});

test('clampNum resolves non-finite input deterministically', () => {
  // Non-finite input is treated as garbage and falls back to the lower bound
  // (deterministic — never NaN-poisons the simulation state).
  assert.equal(clampNum(NaN, 2, 1000), 2);
  assert.equal(clampNum(Infinity, 2, 1000), 2);
  assert.equal(clampNum('garbage', 2, 1000), 2);
  // No bounds at all: non-finite falls back to 0 rather than propagating NaN.
  assert.equal(clampNum(NaN), 0);
});
