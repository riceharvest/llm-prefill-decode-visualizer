import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_DRAFT_COST,
  specSpeedup,
  breakevenAcceptance,
  effectiveSpecSpeed,
  DRAFT_TARGET_PAIRS,
  suggestPairs,
  pairAcceptance
} from './specDecode.js';

test('breakeven acceptance equals the draft cost fraction in the linear model', () => {
  assert.equal(breakevenAcceptance(0.2), 0.2);
  assert.equal(breakevenAcceptance(0.1), 0.1);
  // At the breakeven rate, speedup is exactly 1 regardless of k.
  for (const k of [1, 2, 4, 8]) {
    assert.ok(Math.abs(specSpeedup(k, breakevenAcceptance(0.2), 0.2) - 1) < 1e-12);
  }
});

test('speculation above breakeven speeds up, below breakeven slows down', () => {
  assert.ok(specSpeedup(4, 0.7) > 1);
  assert.ok(specSpeedup(4, 0.15) < 1);
});

test('effective speed matches the api/_math speculative formula', () => {
  // base × (1 + k·α) / (1 + k·c), with base=105, k=4, α=0.7, c=0.2
  assert.ok(Math.abs(effectiveSpecSpeed(105, 4, 0.7, 0.2) - 105 * (1 + 4 * 0.7) / (1 + 4 * 0.2)) < 1e-9);
  assert.equal(effectiveSpecSpeed(0, 4, 0.7), 0);
  assert.equal(effectiveSpecSpeed(-5, 4, 0.7), 0);
});

test('every curated pairing is well-formed', () => {
  assert.ok(DRAFT_TARGET_PAIRS.length >= 5);
  for (const p of DRAFT_TARGET_PAIRS) {
    assert.ok(p.draft && p.target && p.source);
    assert.ok(p.suggestedK >= 2 && p.suggestedK <= 8);
    assert.ok(p.acceptanceRange[0] < p.acceptanceRange[1]);
    assert.ok(p.acceptanceRange[1] <= 1);
    assert.ok(p.speedupRange[0] < p.speedupRange[1]);
    // Midpoint acceptance must clear the breakeven, else the pair is not
    // actually "known-good" under the shipped model.
    assert.ok(pairAcceptance(p) > breakevenAcceptance(DEFAULT_DRAFT_COST));
  }
});

test('suggestPairs filters by family and sorts by best expected speedup', () => {
  const all = suggestPairs();
  assert.equal(all.length, DRAFT_TARGET_PAIRS.length);
  const qwen = suggestPairs('qwen');
  assert.ok(qwen.length >= 1);
  assert.ok(qwen.every(p => `${p.family} ${p.draft} ${p.target}`.toLowerCase().includes('qwen')));
  for (let i = 1; i < all.length; i++) {
    const mid = p => (p.speedupRange[0] + p.speedupRange[1]) / 2;
    assert.ok(mid(all[i - 1]) >= mid(all[i]));
  }
  assert.equal(suggestPairs('no-such-family').length, 0);
});

test('pairAcceptance clamps the midpoint into the UI slider range', () => {
  assert.ok(Math.abs(pairAcceptance({ acceptanceRange: [0.5, 0.7] }) - 0.6) < 1e-12);
  assert.equal(pairAcceptance({ acceptanceRange: [0.1, 0.2] }), 0.3); // clamped up
  assert.equal(pairAcceptance({ acceptanceRange: [0.92, 1] }), 0.95); // clamped down
});
