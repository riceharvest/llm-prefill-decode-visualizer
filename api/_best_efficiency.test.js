import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rankGroups, efficiencyScore } from './_handlers/best.js';

// Synthetic groups in the shape rankGroups consumes (aggregate() output).
function group({ key, vramGb, unifiedMemoryGb, decode }) {
  const sample = {
    hardware: key,
    hardwareKey: key,
    hwClass: 'discrete_gpu',
    gpu: key,
    gpuCount: 1,
    vramGb,
    unifiedMemoryGb,
    modelFamily: 'm',
    modelName: `model-${key}`,
    quantization: 'q4_k_m',
    engine: 'llama.cpp',
    source: 'test'
  };
  return {
    key,
    bestRun: sample,
    runs: 3,
    confidence: { score: 50 },
    prefill: { median: 1000 },
    decode: { median: decode }
  };
}

test('#605 #611: by=efficiency ranks by decode tok/s per GB of memory, not decode', () => {
  const groups = [
    group({ key: 'fast-huge', vramGb: 80, decode: 160 }),   // 2 tok/s/GiB
    group({ key: 'small', vramGb: 12, decode: 60 }),        // 5 tok/s/GiB
    group({ key: 'mid', vramGb: 24, decode: 96 })           // 4 tok/s/GiB
  ];
  const ranked = rankGroups(groups, 'efficiency', { promptTokens: 0, outputTokens: 0 }, 10);
  assert.deepEqual(ranked.map(r => r.hardwareKey), ['small', 'mid', 'fast-huge']);
  // The metric is exposed per row so agents can see the ranking signal.
  assert.equal(ranked[0].efficiencyTokPerSecPerGbVram, 5);
  assert.equal(ranked[1].efficiencyTokPerSecPerGbVram, 4);
  assert.equal(ranked[2].efficiencyTokPerSecPerGbVram, 2);
});

test('#605 #611: by=decode still ranks raw decode speed (unchanged)', () => {
  const groups = [
    group({ key: 'fast-huge', vramGb: 80, decode: 160 }),
    group({ key: 'small', vramGb: 12, decode: 60 })
  ];
  const ranked = rankGroups(groups, 'decode', { promptTokens: 0, outputTokens: 0 }, 10);
  assert.deepEqual(ranked.map(r => r.hardwareKey), ['fast-huge', 'small']);
  // No efficiency field leaks into non-efficiency rankings.
  assert.equal('efficiencyTokPerSecPerGbVram' in ranked[0], false);
});

test('#605 #611: unknown-memory groups sort last instead of leading', () => {
  const groups = [
    group({ key: 'unknown', vramGb: null, unifiedMemoryGb: null, decode: 999 }),
    group({ key: 'small', vramGb: 12, decode: 60 })
  ];
  const ranked = rankGroups(groups, 'efficiency', { promptTokens: 0, outputTokens: 0 }, 10);
  assert.deepEqual(ranked.map(r => r.hardwareKey), ['small', 'unknown']);
  // Unknown memory → no fabricated efficiency number.
  assert.equal('efficiencyTokPerSecPerGbVram' in ranked[1], false);
});

test('efficiencyScore falls back to unifiedMemoryGb and rejects bad input', () => {
  assert.equal(efficiencyScore({ vramGb: null, unifiedMemoryGb: 192, medianDecodeTokPerSec: 96 }), 0.5);
  assert.equal(efficiencyScore({ vramGb: 24, medianDecodeTokPerSec: NaN }), null);
  assert.equal(efficiencyScore({ vramGb: 0, medianDecodeTokPerSec: 100 }), null);
});
