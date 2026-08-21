import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getQuantizations,
  hardwareName,
  isComparableRun,
  methodologyMismatch,
  runFreshness,
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

// Fixed clock for deterministic freshness assertions.
const NOW = new Date('2026-08-21T12:00:00.000Z');
const daysAgo = n => new Date(NOW.getTime() - n * 86400000).toISOString();

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

test('runFreshness stamps age and tier; undated runs stay unknown', () => {
  assert.deepEqual(runFreshness({ ...run, createdAt: daysAgo(5) }, NOW), { ageDays: 5, tier: 'fresh' });
  assert.deepEqual(runFreshness({ ...run, createdAt: daysAgo(200) }, NOW), { ageDays: 200, tier: 'aging' });
  assert.deepEqual(runFreshness({ ...run, createdAt: daysAgo(400) }, NOW), { ageDays: 400, tier: 'stale' });
  assert.deepEqual(runFreshness(run, NOW), { ageDays: null, tier: 'unknown' });
});

test('toLocalPreset carries methodology metadata (date, staleness, engine version)', () => {
  const preset = toLocalPreset({
    ...run,
    createdAt: daysAgo(120),
    engine: { ...run.engine, engineVersion: 'b6000' }
  }, NOW);
  assert.equal(preset.measuredAt, daysAgo(120));
  assert.equal(preset.ageDays, 120);
  assert.equal(preset.staleness, 'aging');
  assert.equal(preset.engineVersion, 'b6000');
});

test('methodologyMismatch flags engine and age differences between measured presets', () => {
  const presetA = toLocalPreset({ ...run, createdAt: daysAgo(10) }, NOW);
  const sameMethodology = toLocalPreset(
    { ...run, id: 'run-2', createdAt: daysAgo(20) },
    NOW
  );
  assert.deepEqual(methodologyMismatch(presetA, sameMethodology), []);

  const otherEngine = toLocalPreset(
    { ...run, id: 'run-3', createdAt: daysAgo(15), engine: { ...run.engine, engineName: 'vLLM' } },
    NOW
  );
  assert.match(
    methodologyMismatch(presetA, otherEngine).join('; '),
    /different engines \(llama\.cpp vs vLLM\)/
  );

  const stalePreset = toLocalPreset({ ...run, createdAt: daysAgo(500) }, NOW);
  assert.match(
    methodologyMismatch(presetA, stalePreset).join('; '),
    /different data ages \(fresh vs stale\)/
  );
  // Both stale → flagged even when tiers match
  const staleToo = toLocalPreset({ ...run, id: 'run-4', createdAt: daysAgo(600) }, NOW);
  assert.match(
    methodologyMismatch(stalePreset, staleToo).join('; '),
    /both measurements are stale/
  );

  // Static (non-LocalMaxxing) presets carry no methodology → no claim
  assert.deepEqual(methodologyMismatch({ localMaxxing: false }, presetA), []);
});
