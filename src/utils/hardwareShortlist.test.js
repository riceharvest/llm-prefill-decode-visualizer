import test from 'node:test';
import assert from 'node:assert/strict';
import { buildShortlist, effectiveVramGb } from './hardwareShortlist.js';

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
