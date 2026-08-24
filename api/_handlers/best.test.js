// Regression tests for /api/best exclusion telemetry (#780) and cost-mode
// power inputs (#1111).
//
// #780: the fitCheck exclusion counter was computed and discarded (the spec
// documents `excludedRuns` but the wire never emitted it), and ?maxVramGb
// silently dropped unknown-memory rigs indistinguishably from over-cap rigs.
// #1111: ?by=cost read only ?powerWatts (ignoring the /api/compute-documented
// ?powerDrawWatts spelling) and looked up DEFAULT_POWER_WATTS with the raw
// UPPERCASE wire hwClass, so every rig fell back to a flat 150 W.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bestBody } from './best.js';
import { invalidateCache } from '../_localmaxxing.js';

function row(id, over = {}) {
  return {
    id,
    createdAt: '2026-08-01T00:00:00.000Z',
    tokSPrefill: 3800,
    tokSOut: 100,
    contextLength: 8192,
    promptTokens: 2048,
    outputTokens: 512,
    hardwareGroupKey: `rig${id}`,
    hardwareGroupLabel: `Rig ${id}`,
    model: { hfId: 'unsloth/Qwen3.6-27B-MTP-GGUF', displayName: 'Qwen3.6 27B MTP', params: 27 },
    engine: { engineName: 'llama.cpp', engineVersion: 'b6123', quantization: 'q4_k_m' },
    batchSize: 1,
    ...over
  };
}

const ROWS = [
  // discrete GPU, known memory → DEFAULT_POWER_WATTS.discrete_gpu = 300
  row('r1', { hardware: { hwClass: 'DISCRETE_GPU', gpuName: 'RTX 4090', gpuCount: 1, vramGb: 24 } }),
  // unified memory, known → DEFAULT_POWER_WATTS.unified = 60
  row('r2', {
    tokSOut: 90,
    hardwareGroupKey: 'm3ultra',
    hardware: { hwClass: 'UNIFIED', gpuName: null, chipFamily: 'M3 Ultra', gpuCount: 1, unifiedMemoryGb: 64 }
  }),
  // cpu_only, known → DEFAULT_POWER_WATTS.cpu_only = 120
  row('r3', {
    tokSOut: 10,
    hardwareGroupKey: 'epyc',
    hardware: { hwClass: 'CPU_ONLY', gpuName: null, cpu: 'EPYC 9754', gpuCount: 1 }
  }),
  // discrete GPU with UNKNOWN memory → dropped by maxVramGb as unknown, not over-cap
  row('r4', {
    tokSOut: 80,
    hardware: { hwClass: 'DISCRETE_GPU', gpuName: 'Mystery GPU', gpuCount: 1 }
  })
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

test('#1111: by=cost falls back to per-hwClass watts even though wire hwClass is UPPERCASE', async () => {
  await withMockedUpstream(async () => {
    const { status, body } = await bestBody({ by: 'cost' });
    assert.equal(status, 200);
    const wattsByHwClass = new Map(body.results.map(r => [r.hwClass, r.costInputs.powerDrawWatts]));
    assert.equal(wattsByHwClass.get('DISCRETE_GPU'), 300);
    assert.equal(wattsByHwClass.get('UNIFIED'), 60);
    assert.equal(wattsByHwClass.get('CPU_ONLY'), 120);
  });
});

test('#1111: ?powerDrawWatts (the compute-documented spelling) is honored, not ignored', async () => {
  await withMockedUpstream(async () => {
    const { body } = await bestBody({ by: 'cost', powerDrawWatts: '450' });
    for (const r of body.results) assert.equal(r.costInputs.powerDrawWatts, 450);

    // explicit override wins over the per-class estimate; ?powerWatts still works
    const viaOldSpelling = await bestBody({ by: 'cost', powerWatts: '777' });
    for (const r of viaOldSpelling.body.results) assert.equal(r.costInputs.powerDrawWatts, 777);

    // when both are given, powerDrawWatts wins
    const both = await bestBody({ by: 'cost', powerWatts: '777', powerDrawWatts: '888' });
    for (const r of both.body.results) assert.equal(r.costInputs.powerDrawWatts, 888);
  });
});

test('#780: fitCheck emits excludedRuns + runsBeforeFit (spec-documented field now on the wire)', async () => {
  await withMockedUpstream(async () => {
    const { body } = await bestBody({ by: 'decode', contextLength: 131072, precisionBytes: 2 });
    assert.equal(typeof body.excludedRuns, 'number');
    assert.equal(typeof body.runsBeforeFit, 'number');
    assert.equal(body.excludedRuns, body.runsBeforeFit - body.matchedRuns);
    assert.ok(body.excludedRuns >= 0);

    // absent when fitCheck did not run — payloads stay byte-stable otherwise
    const plain = await bestBody({ by: 'decode' });
    assert.equal('excludedRuns' in plain.body, false);
    assert.equal('runsBeforeFit' in plain.body, false);
  });
});

test('#780: maxVramGb reports unknown-memory exclusions separately and warns', async () => {
  await withMockedUpstream(async () => {
    const { body } = await bestBody({ by: 'decode', maxVramGb: 8 });
    // r4 (no vramGb/unifiedMemoryGb) AND r3 (cpu_only, no memory field at all)
    // are excluded as UNKNOWN, not over-cap.
    assert.equal(body.excludedUnknownVramGb, 2);
    assert.ok(
      body.warnings.some(w => w.includes('?maxVramGb=8') && w.includes('unknown')),
      'expected an unknown-memory exclusion warning'
    );
    // matchedRuns excludes r3 + r4 (unknown) plus any over-cap rigs.
    assert.ok(body.matchedRuns <= ROWS.length - 2);

    // absent when the filter was not applied
    const plain = await bestBody({ by: 'decode' });
    assert.equal('excludedUnknownVramGb' in plain.body, false);
  });
});
