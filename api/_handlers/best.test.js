import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

// Mock the upstream leaderboard BEFORE imports so nothing hits the network.
// NOTE: hwClass ships UPPERCASE in the real dataset (#482) — fixtures
// reproduce that reality.
function row(id, rig, { decode = 100, vramGb } = {}) {
  return {
    id, batchSize: 1,
    tokSPrefill: 2000, tokSOut: decode,
    model: { hfId: 'meta-llama/Llama-3.1-8B-Instruct', displayName: 'Llama 3.1 8B', params: 8 },
    hardwareGroupKey: rig, hardwareGroupLabel: rig.toUpperCase(),
    hardware: { hwClass: 'DISCRETE_GPU', gpuName: `GPU ${rig}`, gpuCount: 1, vramGb },
    engine: { engineName: 'llama.cpp', quantization: 'q4_k_m' }
  };
}

const ROWS = [
  row('a1', 'big-rig', { decode: 120, vramGb: 24 }),
  row('a2', 'mid-rig', { decode: 100, vramGb: 16 }),
  row('a3', 'tiny-rig', { decode: 140, vramGb: 2 }),   // fails any fitCheck
  row('a4', 'mystery-rig', { decode: 80 })              // unknown memory
];

let realFetch;
beforeEach(() => {
  realFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ rows: ROWS }) });
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

const { invalidateCache } = await import('../_localmaxxing.js');
const { resetSnapshots } = await import('../_snapshots.js');
const { bestBody } = await import('./best.js');

beforeEach(() => {
  invalidateCache();
  resetSnapshots();
});

// ---------- #780: constraint-exclusion telemetry ----------

test('fitCheck emits the spec-declared excludedRuns counter (#780)', async () => {
  const { body } = await bestBody({ by: 'decode', fitCheck: 'true' });
  // Only rigs whose memory provably holds the model survive: tiny-rig (2 GB)
  // fails the fit and mystery-rig has no memory data at all.
  assert.equal(body.excludedRuns, 2);
  assert.equal(body.matchedRuns, 2);
});

test('no excludedRuns field when fitCheck did not run (#780)', async () => {
  const { body } = await bestBody({ by: 'decode' });
  assert.equal(body.excludedRuns, undefined);
});

test('?maxVramGb reports unknown-memory exclusions separately from over-budget drops (#780)', async () => {
  const { body } = await bestBody({ by: 'decode', maxVramGb: 32 });
  // mystery-rig has no vramGb/unifiedMemoryGb → dropped as unknown, not over budget.
  assert.equal(body.excludedUnknownVramGb, 1);
  assert.equal(body.matchedRuns, 3);
});
