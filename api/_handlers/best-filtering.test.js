// Regression tests for /api/best filter-funnel telemetry (#780):
// 1. ?fitCheck computed an excludedByFit counter and discarded it — valid
//    constraints could eliminate most of the dataset with zero telemetry;
// 2. ?maxVramGb silently dropped rigs whose memory size is unknown, with no
//    signal that they were removed or why.
// Responses without these filters stay unchanged (no `filtering` key).

import test from 'node:test';
import assert from 'node:assert/strict';
import { bestBody } from './best.js';
import { invalidateCache } from '../_localmaxxing.js';

function row(id, extra = {}) {
  return {
    id, createdAt: '2026-08-10T00:00:00.000Z',
    tokSPrefill: 3800, tokSOut: 105, contextLength: 8192,
    hardwareGroupKey: `rig-${id}`, hardwareGroupLabel: `Rig ${id}`,
    hardware: { hwClass: 'DISCRETE_GPU', gpuName: 'RTX 4090', gpuCount: 1, vramGb: 24 },
    model: { hfId: 'unsloth/Qwen3-8B-GGUF', displayName: 'Qwen3 8B', params: 8 },
    engine: { engineName: 'llama.cpp', engineVersion: 'b6123', quantization: 'q4_k_m' },
    batchSize: 1,
    ...extra
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

test('#780: ?fitCheck exposes excludedByFit instead of discarding it', async () => {
  // rig-small (8 GB) cannot hold an 8B model @32k ctx; rig-big (24 GB) can.
  await withMockedUpstream([
    row('a1', { hardwareGroupKey: 'rig-small', hardwareGroupLabel: 'Rig Small', hardware: { hwClass: 'DISCRETE_GPU', gpuName: 'RTX 4060', gpuCount: 1, vramGb: 8 } }),
    row('b1', { hardwareGroupKey: 'rig-big', hardwareGroupLabel: 'Rig Big' })
  ], async () => {
    const { status, body } = await bestBody({ fitCheck: 'true' });
    assert.equal(status, 200);
    assert.equal(body.filtering.fitCheck.excludedByFit, 1);
    assert.equal(body.results.length, 1);
    assert.equal(body.results[0].hardwareKey, 'rig-big');
  });
});

test('#780: no filtering block when neither fitCheck nor maxVramGb engaged', async () => {
  await withMockedUpstream([row('a1')], async () => {
    const { status, body } = await bestBody({ by: 'decode' });
    assert.equal(status, 200);
    assert.equal(body.filtering, undefined);
    assert.ok(!body.warnings.some(w => w.includes('maxVramGb')));
  });
});

test('#780: ?maxVramGb reports unknown-memory drops in filtering + warnings', async () => {
  const unknown = row('u1', {
    hardwareGroupKey: 'rig-mystery', hardwareGroupLabel: 'Rig Mystery',
    hardware: { hwClass: 'DISCRETE_GPU', gpuName: 'Mystery GPU', gpuCount: 1 } // no vramGb
  });
  await withMockedUpstream([unknown, row('k1', { hardware: { hwClass: 'DISCRETE_GPU', gpuName: 'RTX 4090', gpuCount: 1, vramGb: 12 } })], async () => {
    const { status, body } = await bestBody({ maxVramGb: '16' });
    assert.equal(status, 200);
    assert.deepEqual(body.filtering.maxVramGb, { dropped: 1, unknownMemoryDropped: 1 });
    assert.ok(body.warnings.some(w => w.includes('memory size is unknown')), JSON.stringify(body.warnings));
  });
});

test('#780: ?maxVramGb with only known-memory drops reports dropped w/o warning', async () => {
  const big = row('big1', { hardware: { hwClass: 'DISCRETE_GPU', gpuName: 'A100', gpuCount: 1, vramGb: 80 } });
  await withMockedUpstream([big], async () => {
    const { status, body } = await bestBody({ maxVramGb: '16' });
    assert.equal(status, 200);
    assert.deepEqual(body.filtering.maxVramGb, { dropped: 1, unknownMemoryDropped: 0 });
    assert.ok(!body.warnings.some(w => w.includes('memory size is unknown')));
    assert.equal(body.results.length, 0);
  });
});
