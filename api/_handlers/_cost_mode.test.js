// Regression tests for cost-mode input fidelity (#1111, #736).
//
// #1111: /api/best?by=cost only read ?powerWatts (ignoring compute's
// documented ?powerDrawWatts spelling) and looked DEFAULT_POWER_WATTS up with
// the raw wire hwClass — UPPERCASE on the live wire — so every rig fell back
// to a flat 150 W.
// #736: model=cost silently priced at $0.00/1M tokens when price/power
// defaulted to 0, with no warning.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { cost } from '../_math.js';
import { computeBody } from './compute.js';
import { bestBody } from './best.js';
import { invalidateCache } from '../_localmaxxing.js';

// Wire-shaped rows: hwClass UPPERCASE, as the upstream leaderboard ships it.
const ROWS = [
  {
    id: 'r-gpu', createdAt: '2026-08-20T00:00:00.000Z',
    tokSPrefill: 3800, tokSOut: 105, contextLength: 8192,
    promptTokens: 2048, outputTokens: 512,
    hardwareGroupKey: 'rtx5090', hardwareGroupLabel: 'RTX 5090',
    hardware: { hwClass: 'DISCRETE_GPU', gpuName: 'RTX 5090', gpuCount: 1, vramGb: 32 },
    model: { hfId: 'unsloth/Qwen3.6-27B-GGUF', displayName: 'Qwen3.6 27B', params: 27 },
    engine: { engineName: 'llama.cpp', engineVersion: 'b6123', quantization: 'q4_k_m' },
    batchSize: 1
  },
  {
    id: 'r-cpu', createdAt: '2026-08-20T00:00:00.000Z',
    tokSPrefill: 900, tokSOut: 30, contextLength: 8192,
    promptTokens: 2048, outputTokens: 512,
    hardwareGroupKey: 'ryzen9800x3d', hardwareGroupLabel: 'AMD Ryzen 7 9800X3D',
    hardware: { hwClass: 'CPU_ONLY', cpu: 'AMD Ryzen 7 9800X3D' },
    model: { hfId: 'unsloth/Qwen3.6-27B-GGUF', displayName: 'Qwen3.6 27B', params: 27 },
    engine: { engineName: 'llama.cpp', engineVersion: 'b6123', quantization: 'q4_k_m' },
    batchSize: 1
  }
];

async function withMockedUpstream(fn) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ rows: ROWS }) });
  invalidateCache();
  try {
    return await fn();
  } finally {
    globalThis.fetch = originalFetch;
    invalidateCache();
  }
}

test('#1111: per-class watt estimates apply despite UPPERCASE wire hwClass', async () => {
  await withMockedUpstream(async () => {
    const { status, body } = await bestBody({ by: 'cost' });
    assert.equal(status, 200);
    const byKey = new Map(body.results.map(r => [r.hardwareKey, r]));
    // DISCRETE_GPU → 300 W, CPU_ONLY → 120 W (not the 150 W catch-all).
    assert.equal(byKey.get('rtx5090').costInputs.powerDrawWatts, 300);
    assert.equal(byKey.get('ryzen9800x3d').costInputs.powerDrawWatts, 120);
  });
});

test('#1111: compute-documented ?powerDrawWatts spelling is honored on /api/best', async () => {
  await withMockedUpstream(async () => {
    const { status, body } = await bestBody({ by: 'cost', powerDrawWatts: '450' });
    assert.equal(status, 200);
    for (const r of body.results) {
      assert.equal(r.costInputs.powerDrawWatts, 450);
    }
  });
});

test('#1111: explicit ?powerWatts still wins over the class estimate', async () => {
  await withMockedUpstream(async () => {
    const { body } = await bestBody({ by: 'cost', powerWatts: '77' });
    for (const r of body.results) {
      assert.equal(r.costInputs.powerDrawWatts, 77);
    }
  });
});

test('#1111: /api/compute model=cost honors the ?powerWatts alias too', async () => {
  const { status, body } = await computeBody({ model: 'cost', powerWatts: '450' });
  assert.equal(status, 200);
  assert.equal(body.inputs.powerDrawWatts, 450);
});

test('#736: zero price and zero power are flagged, math unchanged', () => {
  const r = cost({ prefillSpeed: 3800, decodeSpeed: 105 });
  assert.equal(r.costUsdPerMillionTokens, 0); // unchanged behavior
  const codes = r.warnings.map(w => w.code);
  assert.deepEqual(codes.sort(), ['cost_missing_hardware_price', 'cost_missing_power_draw']);
  for (const w of r.warnings) {
    assert.ok(w.message.length > 20, 'warning carries an explanatory message');
  }
});

test('#736: fully-specified cost inputs produce no warnings', () => {
  const r = cost({
    hardwarePriceUsd: 2000, electricityRatePerKwh: 0.15,
    powerDrawWatts: 450, prefillSpeed: 3800, decodeSpeed: 105
  });
  assert.deepEqual(r.warnings, []);
});

test('#736: warnings appear on the live compute response shape', async () => {
  const { status, body } = await computeBody({ model: 'cost' });
  assert.equal(status, 200);
  const codes = body.warnings.map(w => w.code);
  assert.ok(codes.includes('cost_missing_hardware_price'));
  assert.ok(codes.includes('cost_missing_power_draw'));
});
