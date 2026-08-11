import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getQuantizations,
  hardwareName,
  isComparableRun,
  toLocalPreset
} from './localMaxxing.js';

const run = {
  id: 'run-1',
  batchSize: 1,
  promptTokens: 512,
  outputTokens: 128,
  contextLength: 8192,
  tokSPrefill: 1604.010013,
  tokSOut: 31.671169,
  model: { hfId: 'org/model', displayName: 'Model 30B' },
  hardware: { hwClass: 'DISCRETE_GPU', gpuName: 'RTX 3090', gpuCount: 2, vramGb: 24 },
  engine: { engineName: 'llama.cpp', quantization: 'Q6_K_XL' },
  engineFlags: { concurrency: 1, numParallel: 1 }
};

test('accepts only single-stream runs with both measured speeds', () => {
  assert.equal(isComparableRun(run), true);
  assert.equal(isComparableRun({ ...run, batchSize: 8 }), false);
  assert.equal(isComparableRun({ ...run, tokSPrefill: null }), false);
  assert.equal(isComparableRun({ ...run, engineFlags: { concurrency: 2 } }), false);
});

test('maps a LocalMaxxing run to an exact visualizer preset', () => {
  const preset = toLocalPreset(run);
  assert.equal(preset.id, 'lmx:run-1');
  assert.equal(preset.prefillSpeed, 1604.010013);
  assert.equal(preset.decodeSpeed, 31.671169);
  assert.equal(preset.sourceUrl, 'https://localmaxxing.com/en/runs/run-1');
  assert.match(preset.name, /2× RTX 3090 24GB/);
});

test('sorts quantizations by available comparable run count', () => {
  const quants = getQuantizations([
    run,
    { ...run, id: 'run-2', engine: { ...run.engine, quantization: 'Q4_K_M' } },
    { ...run, id: 'run-3', engine: { ...run.engine, quantization: 'Q4_K_M' } }
  ]);
  assert.deepEqual(quants, ['Q4_K_M', 'Q6_K_XL']);
  assert.equal(hardwareName(run), '2× RTX 3090 24GB');
});
