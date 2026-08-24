// Regression tests for /api/best?by=cost power-watt inputs (#1111):
// 1. per-hwClass DEFAULT_POWER_WATTS must apply regardless of wire hwClass
//    casing (live rows ship UPPERCASE 'DISCRETE_GPU'; the table is lowercase —
//    the old exact-key lookup always missed and priced every rig at 150 W);
// 2. ?powerDrawWatts (the spelling /api/compute model=cost documents) must be
//    honored, not silently dropped in favor of ?powerWatts only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { bestBody } from './best.js';
import { invalidateCache } from '../_localmaxxing.js';

function row(id, hwClass) {
  return {
    id, createdAt: '2026-08-10T00:00:00.000Z',
    tokSPrefill: 3800, tokSOut: 105, contextLength: 8192,
    hardwareGroupKey: `rig-${id}`, hardwareGroupLabel: `Rig ${id}`,
    hardware: { hwClass, gpuName: 'RTX 4090', gpuCount: 1, vramGb: 24 },
    model: { hfId: 'unsloth/Qwen3.6-27B-MTP-GGUF', displayName: 'Qwen3.6 27B MTP', params: 27 },
    engine: { engineName: 'llama.cpp', engineVersion: 'b6123', quantization: 'q4_k_m' },
    batchSize: 1
  };
}

async function withMockedUpstream(rows, fn) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ rows }) });
  invalidateCache();
  try {
    return await fn();
  } finally {
    globalThis.fetch = originalFetch;
    invalidateCache();
  }
}

const wattsOf = (body, i = 0) => body.results[i].costInputs.powerDrawWatts;

test('by=cost applies the per-hwClass default for UPPERCASE wire hwClass (was flat 150W)', async () => {
  await withMockedUpstream([row('r1', 'DISCRETE_GPU'), row('r2', 'UNIFIED'), row('r3', 'CPU_ONLY')], async () => {
    const { status, body } = await bestBody({ by: 'cost' });
    assert.equal(status, 200);
    assert.equal(body.rankedBy, 'cost');
    const byClass = Object.fromEntries(body.results.map(r => [r.hwClass, r.costInputs.powerDrawWatts]));
    // Class estimates, not the catch-all 150.
    assert.equal(byClass.DISCRETE_GPU, 300);
    assert.equal(byClass.UNIFIED, 60);
    assert.equal(byClass.CPU_ONLY, 120);
  });
});

test('by=cost still applies class defaults for lowercase hwClass (legacy fixture shape)', async () => {
  await withMockedUpstream([row('r1', 'discrete_gpu')], async () => {
    const { body } = await bestBody({ by: 'cost' });
    assert.equal(wattsOf(body), 300);
  });
});

test('by=cost honors ?powerDrawWatts (compute-documented spelling)', async () => {
  await withMockedUpstream([row('r1', 'DISCRETE_GPU')], async () => {
    const { body } = await bestBody({ by: 'cost', powerDrawWatts: '450' });
    assert.equal(wattsOf(body), 450);
  });
});

test('by=cost keeps honoring ?powerWatts (back-compat)', async () => {
  await withMockedUpstream([row('r1', 'DISCRETE_GPU')], async () => {
    const { body } = await bestBody({ by: 'cost', powerWatts: '200' });
    assert.equal(wattsOf(body), 200);
  });
});

test('by=cost falls back to 150W when hwClass is missing/unknown', async () => {
  await withMockedUpstream([row('r1', null), row('r2', 'quantum')], async () => {
    const { body } = await bestBody({ by: 'cost' });
    const watts = new Set(body.results.map(r => r.costInputs.powerDrawWatts));
    assert.deepEqual([...watts], [150]);
  });
});
