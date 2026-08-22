import test from 'node:test';
import assert from 'node:assert/strict';

import { aggregate, bootstrapMedianCI } from './_localmaxxing.js';

function run(i, prefill, decode) {
  return {
    runId: `r${i}`,
    modelFamily: 'llama-3-8b',
    hardwareKey: 'rtx4090',
    prefillTokPerSec: prefill,
    decodeTokPerSec: decode
  };
}

test('bootstrapMedianCI returns null for empty and single-run samples', () => {
  assert.equal(bootstrapMedianCI([]), null);
  assert.equal(bootstrapMedianCI([100]), null);
});

test('bootstrapMedianCI is deterministic for a given seed', () => {
  const data = [380, 390, 400, 410, 420, 430, 440, 450].sort((a, b) => a - b);
  const a = bootstrapMedianCI(data, { seed: 42 });
  const b = bootstrapMedianCI(data, { seed: 42 });
  assert.deepEqual(a, b);
});

test('bootstrapMedianCI covers the true median of a symmetric sample', () => {
  // Symmetric around 100 → resample medians stay within [90, 110].
  const data = [90, 95, 100, 105, 110];
  const ci = bootstrapMedianCI(data, { seed: 7 });
  assert.ok(ci.lo <= 100 && 100 <= ci.hi, `CI [${ci.lo}–${ci.hi}] should cover median 100`);
  assert.ok(ci.lo >= 90 && ci.hi <= 110, 'resample medians cannot leave the observed range');
});

test('bootstrapMedianCI brackets the sample median on skewed data', () => {
  const data = Array.from({ length: 60 }, (_, i) => 50 + i * i); // right-skewed
  const sorted = [...data].sort((a, b) => a - b);
  const mid = (sorted[29] + sorted[30]) / 2;
  const ci = bootstrapMedianCI(sorted, { seed: 123 });
  assert.ok(ci.lo <= mid, `lo ${ci.lo} should be <= median ${mid}`);
  assert.ok(ci.hi >= mid, `hi ${ci.hi} should be >= median ${mid}`);
  assert.ok(ci.lo < ci.hi, 'skewed sample should have a non-degenerate interval');
});

test('bootstrapMedianCI respects confidence level width ordering', () => {
  const data = [10, 20, 30, 45, 60, 70, 80];
  const wide = bootstrapMedianCI(data, { confidence: 0.99, seed: 5 });
  const narrow = bootstrapMedianCI(data, { confidence: 0.9, seed: 5 });
  assert.ok(wide.hi - wide.lo >= narrow.hi - narrow.lo);
});

test('aggregate attaches ci95 and label to prefill/decode stats', () => {
  const runs = [
    run(1, 3000, 90),
    run(2, 3400, 110),
    run(3, 3800, 120),
    run(4, 4200, 130)
  ];
  const [g] = aggregate(runs, r => r.hardwareKey);
  assert.equal(g.prefill.median, 3600);
  assert.ok(g.prefill.ci95 && Number.isFinite(g.prefill.ci95.lo) && Number.isFinite(g.prefill.ci95.hi));
  assert.ok(g.decode.ci95 && g.decode.ci95.lo <= g.decode.median && g.decode.median <= g.decode.ci95.hi);
  assert.match(g.decode.label, /^\d+ \[\d+–\d+\]$/);
});

test('aggregate CI is deterministic across calls with the same group key', () => {
  const runs = [
    run(1, 3000, 90),
    run(2, 3400, 110),
    run(3, 3800, 120),
    run(4, 4200, 130),
    run(5, 5000, 150)
  ];
  const [a] = aggregate(runs, r => r.hardwareKey);
  const [b] = aggregate(runs, r => r.hardwareKey);
  assert.deepEqual(a.decode.ci95, b.decode.ci95);
  assert.equal(a.decode.label, b.decode.label);
});

test('aggregate single-run group has null ci95 and bare-median label', () => {
  const runs = [run(1, 3000, 90)];
  const [g] = aggregate(runs, r => r.hardwareKey);
  assert.equal(g.prefill.ci95, null);
  assert.equal(g.prefill.label, '3000');
  assert.equal(g.decode.label, '90');
});
