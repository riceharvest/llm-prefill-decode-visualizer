// Regression tests for /api/best exclusion telemetry (#780) and the
// ?by=cost power-input fixes (#1111).
//
// Run: node --test api/_handlers/best.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { bestBody } from './best.js';
import { invalidateCache } from '../_localmaxxing.js';

// Upstream-shaped rows (as returned by the leaderboard fetch, before slim()).
// hwClass is deliberately UPPERCASE — that is what the wire carries (#482) and
// what used to make the DEFAULT_POWER_WATTS lookup dead code (#1111).
const MOCK_ROWS = [
  {
    id: 'r1', createdAt: '2026-08-10T00:00:00.000Z',
    tokSPrefill: 3820, tokSOut: 108, contextLength: 8192, promptTokens: 2048, outputTokens: 512,
    hardwareGroupKey: 'rtx4090', hardwareGroupLabel: 'RTX 4090 24GB',
    hardware: { hwClass: 'DISCRETE_GPU', gpuName: 'RTX 4090', gpuCount: 1, vramGb: 24 },
    model: { hfId: 'unsloth/Qwen3.6-27B-GGUF', displayName: 'Qwen3.6 27B', params: 27 },
    engine: { engineName: 'llama.cpp', engineVersion: 'b6123', quantization: 'q4_k_m' },
    batchSize: 1
  },
  {
    id: 'r2', createdAt: '2026-08-11T00:00:00.000Z',
    tokSPrefill: 3600, tokSOut: 99, contextLength: 8192, promptTokens: 2048, outputTokens: 512,
    hardwareGroupKey: 'rtx4090', hardwareGroupLabel: 'RTX 4090 24GB',
    hardware: { hwClass: 'DISCRETE_GPU', gpuName: 'RTX 4090', gpuCount: 1, vramGb: 24 },
    model: { hfId: 'unsloth/Qwen3.6-27B-GGUF', displayName: 'Qwen3.6 27B', params: 27 },
    engine: { engineName: 'llama.cpp', engineVersion: 'b6123', quantization: 'q4_k_m' },
    batchSize: 1
  },
  {
    id: 'r3', createdAt: '2026-08-12T00:00:00.000Z',
    tokSPrefill: 2100, tokSOut: 60, contextLength: 8192, promptTokens: 2048, outputTokens: 512,
    hardwareGroupKey: 'm3max', hardwareGroupLabel: 'Mac Studio M3 Max',
    hardware: { hwClass: 'UNIFIED', gpuName: null, gpuCount: 1, chipVariant: 'M3 Max', unifiedMemoryGb: 36 },
    model: { hfId: 'unsloth/Qwen3.6-27B-GGUF', displayName: 'Qwen3.6 27B', params: 27 },
    engine: { engineName: 'llama.cpp', engineVersion: 'b6123', quantization: 'q4_k_m' },
    batchSize: 1
  },
  {
    // Unknown memory on both fields — dropped silently by ?maxVramGb before #780.
    id: 'r4', createdAt: '2026-08-13T00:00:00.000Z',
    tokSPrefill: 1500, tokSOut: 45, contextLength: 8192, promptTokens: 2048, outputTokens: 512,
    hardwareGroupKey: 'mysterybox', hardwareGroupLabel: 'Mystery Box',
    hardware: { hwClass: 'CPU_ONLY', gpuName: null, gpuCount: 1 },
    model: { hfId: 'unsloth/Qwen3.6-27B-GGUF', displayName: 'Qwen3.6 27B', params: 27 },
    engine: { engineName: 'llama.cpp', engineVersion: 'b6123', quantization: 'q4_k_m' },
    batchSize: 1
  }
];

async function withMockedUpstream(fn) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ rows: MOCK_ROWS }) });
  invalidateCache();
  try {
    return await fn();
  } finally {
    globalThis.fetch = originalFetch;
    invalidateCache();
  }
}

test('#780: filterFunnel always reports the raw survivor count and per-stage drops', async () => {
  await withMockedUpstream(async () => {
    const { status, body } = await bestBody({ by: 'decode' });
    assert.equal(status, 200);
    assert.equal(body.filterFunnel.raw, MOCK_ROWS.length);
    // No constraints applied → only the raw stage exists.
    assert.deepEqual(Object.keys(body.filterFunnel), ['raw']);
    assert.equal(body.matchedRuns, body.filterFunnel.raw);

    // A model constraint records its stage…
    const filtered = await bestBody({ by: 'decode', minDecode: 50 });
    assert.equal(filtered.body.filterFunnel.afterMinDecode, 3);
    assert.equal(filtered.body.matchedRuns, 3);
  });
});

test('#780: fitCheck emits the documented excludedRuns counter wired to matchedRuns', async () => {
  await withMockedUpstream(async () => {
    const { status, body } = await bestBody({ by: 'decode', contextLength: 131072 });
    assert.equal(status, 200);
    assert.ok(Number.isInteger(body.excludedRuns), 'excludedRuns present when fitCheck ran');
    assert.ok(body.excludedRuns >= 0);
    assert.equal(body.filterFunnel.afterFitCheck, body.matchedRuns);
    assert.equal(body.filterFunnel.raw - body.filterFunnel.afterFitCheck, body.excludedRuns);
  });
});

test('#780: ?maxVramGb counts unknown-memory drops separately from cap violations', async () => {
  await withMockedUpstream(async () => {
    const { status, body } = await bestBody({ by: 'decode', maxVramGb: 48 });
    assert.equal(status, 200);
    // Only r4 has unknown memory; its drop must be reported as a data gap.
    assert.equal(body.excludedUnknownVramGb, 1);
    assert.equal(body.filterFunnel.afterMaxVramGb, body.matchedRuns);
    assert.equal(body.matchedRuns, 3);
  });
});

test('#1111: DEFAULT_POWER_WATTS lookup is case-insensitive (uppercase wire hwClass)', async () => {
  await withMockedUpstream(async () => {
    const { status, body } = await bestBody({ by: 'cost' });
    assert.equal(status, 200);
    const byKey = new Map(body.results.map(r => [r.hardwareKey, r]));
    // 'DISCRETE_GPU' (wire casing) must hit the 300W discrete estimate, not the 150W fallback.
    assert.equal(byKey.get('rtx4090').costInputs.powerDrawWatts, 300);
    // 'UNIFIED' must hit the 60W unified estimate.
    assert.equal(byKey.get('m3max').costInputs.powerDrawWatts, 60);
  });
});

test('#1111: ?powerDrawWatts alias is honored identically to ?powerWatts', async () => {
  await withMockedUpstream(async () => {
    const viaAlias = await bestBody({ by: 'cost', powerDrawWatts: 450 });
    const viaOld = await bestBody({ by: 'cost', powerWatts: 450 });
    assert.equal(viaAlias.status, 200);
    for (const row of viaAlias.body.results) {
      assert.equal(row.costInputs.powerDrawWatts, 450);
    }
    assert.deepEqual(
      viaAlias.body.results.map(r => r.costUsdPerMillionTokens),
      viaOld.body.results.map(r => r.costUsdPerMillionTokens)
    );
  });
});
