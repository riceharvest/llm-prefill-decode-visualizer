import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

// #984 — JSON-native booleans must be honored on /api/best + what-if
// constraint sets, not just "true" strings (transport-dependent dialect).
// #986 — crossCheck must flag mixed-hardware baselines under non-default
// groupings instead of asserting comparability that doesn't hold.

const ROWS = [
  {
    id: 'big', batchSize: 1,
    tokSPrefill: 3000, tokSOut: 90,
    model: { hfId: 'test/huge', displayName: 'Huge', params: 400 },
    hardwareGroupKey: 'rigsmall', hardwareGroupLabel: 'Rig Small',
    hardware: { hwClass: 'discrete_gpu', gpuName: 'SmallGPU', gpuCount: 1, vramGb: 24 },
    engine: { engineName: 'llama.cpp', quantization: 'q4_k_m' }
  },
  {
    id: 'wide', batchSize: 1,
    tokSPrefill: 3000, tokSOut: 90,
    model: { hfId: 'test/huge', displayName: 'Huge', params: 400 },
    hardwareGroupKey: 'rigwide', hardwareGroupLabel: 'Rig Wide',
    hardware: { hwClass: 'discrete_gpu', gpuName: 'BigGPU', gpuCount: 8, vramGb: 80 },
    engine: { engineName: 'llama.cpp', quantization: 'q4_k_m' }
  }
];

let realFetch;
beforeEach(() => {
  realFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ rows: ROWS }) });
});
afterEach(() => { globalThis.fetch = realFetch; });

const { bestBody } = await import('../../api/_handlers/best.js');
const { crossCheck } = await import('../../api/_crosscheck.js');

async function rankedGroups(constraints) {
  const { status, body } = await bestBody({ limit: 10, ...constraints });
  assert.equal(status, 200);
  return body;
}

const rigKeys = b => b.results.map(r => r.hardwareKey).sort().join('|');

test('#984: {"fitCheck": true} (native bool) filters like {"fitCheck": "true"}', async () => {
  const none = await rankedGroups({});
  const asString = await rankedGroups({ fitCheck: 'true' });
  const asBool = await rankedGroups({ fitCheck: true });

  // Sanity: fitCheck must actually exclude the small rig for this fixture.
  assert.notEqual(rigKeys(none), rigKeys(asString), 'fixture broken: fitCheck=true did not change results');
  assert.equal(rigKeys(asBool), rigKeys(asString), 'native boolean was silently dropped (#984)');
});

test('#984: fitCheck:false stays off through the JSON path too', async () => {
  const none = await rankedGroups({});
  const explicitFalse = await rankedGroups({ fitCheck: false });
  assert.equal(rigKeys(explicitFalse), rigKeys(none));
});

const MIXED = [
  { modelFamily: 'm', quantization: 'q4', gpuCount: 1, decodeTokPerSec: 100, prefillTokPerSec: 500, gpu: 'GPU A', hardware: 'Rig A', hardwareKey: 'a' },
  { modelFamily: 'm', quantization: 'q4', gpuCount: 1, decodeTokPerSec: 300, prefillTokPerSec: 900, gpu: 'GPU B', hardware: 'Rig B', hardwareKey: 'b' },
  { modelFamily: 'm', quantization: 'q4', gpuCount: 2, decodeTokPerSec: 150, prefillTokPerSec: 700, gpu: 'GPU A', hardware: 'Rig A', hardwareKey: 'a' }
];

test('#986: mixed-hardware grouping flags baselineScope on crossCheck', () => {
  const flagged = crossCheck(MIXED, { hardwareHomogeneous: false });
  assert.equal(flagged.baselineHardwareHomogeneous, false);
  assert.match(flagged.baselineScope ?? '', /unrelated GPUs/);
});

test('#986: default (hardware-homogeneous) output is byte-compatible — no caveat fields', () => {
  const plain = crossCheck(MIXED);
  assert.ok(!('baselineScope' in plain));
  assert.ok(!('baselineHardwareHomogeneous' in plain));
  const homo = crossCheck(MIXED, { hardwareHomogeneous: true });
  assert.deepEqual(homo, plain);
});
