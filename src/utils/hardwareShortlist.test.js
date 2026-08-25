import test from 'node:test';
import assert from 'node:assert/strict';
import { buildShortlist, effectiveVramGb, fetchHardwareShortlist, quantizationMatches } from './hardwareShortlist.js';

function run(overrides = {}) {
  return {
    runId: 'r1',
    modelFamily: 'llama-3',
    modelId: 'org/llama-3',
    modelName: 'Llama 3 8B',
    hardwareKey: 'gpu|3090|1',
    hardware: 'RTX 3090',
    hwClass: 'DISCRETE_GPU',
    gpuCount: 1,
    vramGb: 24,
    engine: 'llama.cpp',
    quantization: 'Q4_K_M',
    prefillTokPerSec: 1000,
    decodeTokPerSec: 30,
    ...overrides
  };
}

test('effectiveVramGb prefers discrete VRAM and falls back to unified memory', () => {
  assert.equal(effectiveVramGb({ vramGb: 24, unifiedMemoryGb: 96 }), 24);
  assert.equal(effectiveVramGb({ unifiedMemoryGb: 96 }), 96);
  assert.equal(effectiveVramGb({}), null);
});

test('filters by min decode, quantization, model and VRAM budget', () => {
  const runs = [
    run(),
    run({ runId: 'r2', decodeTokPerSec: 10 }), // too slow
    run({ runId: 'r3', quantization: 'Q8_0' }), // wrong quant
    run({ runId: 'r4', modelFamily: 'qwen-3', modelId: 'org/qwen-3' }), // wrong model
    run({ runId: 'r5', vramGb: 48 }) // over budget
  ];
  const list = buildShortlist(runs, { minDecode: 20, quant: 'q4_k_m', maxVramGb: 32, model: 'llama' });
  assert.equal(list.length, 1);
  assert.equal(list[0].hardwareKey, 'gpu|3090|1');
});

test('unified-memory rigs count their memory against the VRAM budget', () => {
  const mac = run({
    hwClass: 'UNIFIED', gpu: null, vramGb: null, unifiedMemoryGb: 36
  });
  const fits = buildShortlist([mac], { minDecode: 10, maxVramGb: 48 });
  const tooSmall = buildShortlist([mac], { minDecode: 10, maxVramGb: 24 });
  assert.equal(fits.length, 1);
  assert.equal(fits[0].effectiveVramGb, 36);
  assert.equal(tooSmall.length, 0);
});

test('groups rig × model pairs and ranks by median decode with source links', () => {
  const runs = [
    run({ runId: 'a', decodeTokPerSec: 40 }),
    run({ runId: 'b', decodeTokPerSec: 30 }),
    run({
      runId: 'c', hardwareKey: 'gpu|4090|1', hardware: 'RTX 4090', decodeTokPerSec: 25
    })
  ];
  const list = buildShortlist(runs, {});
  assert.equal(list.length, 2);
  assert.equal(list[0].hardwareKey, 'gpu|3090|1');
  assert.equal(list[0].medianDecodeTokPerSec, 35); // median of 30 & 40
  assert.equal(list[0].runsInGroup, 2);
  assert.match(list[0].source, /\/runs\/a$/); // links to the fastest run
});

// ---- Issue #832: a quant filter must yield the quant-specific median ------

test('buildShortlist with a quant filter reports the quant-specific median (#832)', () => {
  // Same rig × model at three quants: the all-quant median (667) must never be
  // reported when Q4_K_M is selected.
  const runs = [
    { ...run(), runId: 'q4', quantization: 'Q4_K_M', decodeTokPerSec: 600 },
    { ...run(), runId: 'f16', quantization: 'F16', decodeTokPerSec: 700 },
    { ...run(), runId: 'q8', quantization: 'Q8_0', decodeTokPerSec: 734 }
  ];
  const out = buildShortlist(runs, { minDecode: 0, quant: 'Q4_K_M' });
  assert.equal(out.length, 1);
  assert.equal(out[0].quantization, 'Q4_K_M');
  assert.equal(out[0].medianDecodeTokPerSec, 600, 'Q4_K_M median, not the all-quant median');
  assert.equal(out[0].runsInGroup, 1, 'counts runs AT the selected quant only');
});

test('fetchHardwareShortlist sends constraints server-side (#832)', async () => {
  const calls = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (path) => {
    calls.push(String(path));
    if (String(path).startsWith('/api/best')) {
      return { ok: true, json: async () => ({ matchedRuns: 10, results: [{ hardwareKey: 'gpu|3090|1', modelFamily: 'llama-3', medianDecodeTokPerSec: 600 }] }) };
    }
    return { ok: true, json: async () => ({ runs: [] }) };
  };
  try {
    const { results, source } = await fetchHardwareShortlist(
      { minDecode: 15, quant: 'Q4_K_M', maxVramGb: 24, model: 'llama' },
      undefined
    );
    assert.equal(source, 'api');
    assert.equal(results.length, 1);
    const bestCall = calls.find(c => c.startsWith('/api/best'));
    assert.ok(bestCall.includes('quant=Q4_K_M'), `quant sent server-side, got: ${bestCall}`);
    assert.ok(bestCall.includes('minDecode=15'));
    assert.ok(bestCall.includes('maxVramGb=24'));
    assert.ok(bestCall.includes('model=llama'));
  } finally {
    globalThis.fetch = realFetch;
  }

});

// --- #817: ?sq= share-link quant filter must be case-insensitive on BOTH
// sides, parity with /api/best?quant= which lowercases row + query. ---

test('quantizationMatches folds case on both row and query (#817)', () => {
  // lowercase URL value vs uppercase corpus string — the #817 repro
  assert.equal(quantizationMatches('Q4_K_M', 'q4_k_m'), true);
  assert.equal(quantizationMatches('FP8', 'fp8'), true);
  // uppercase restored sq vs lowercase rows
  assert.equal(quantizationMatches('q4_k_m', 'Q4_K_M'), true);
  // genuine mismatch still filters
  assert.equal(quantizationMatches('Q4_K_M', 'q8_0'), false);
  // empty/absent quant = no filter
  assert.equal(quantizationMatches('Q4_K_M', ''), true);
  assert.equal(quantizationMatches(undefined, 'q4'), false);
});
