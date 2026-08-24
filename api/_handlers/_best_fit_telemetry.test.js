// Regression tests for /api/best constraint-exclusion telemetry (#780).
//
// The handler computed `excludedByFit` and discarded it, and ?maxVramGb
// dropped unknown-memory rigs silently — a valid constraint eliminating 80%
// of the dataset was indistinguishable from a small dataset. These tests pin
// the surfaced counters: excludedByFit + runsBeforeFit (fit check) and
// excludedByMaxVramGb + excludedUnknownMemory (VRAM cap).
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { bestBody } from './best.js';
import { invalidateCache } from '../../api/_localmaxxing.js';

function row(id, hwOverrides = {}) {
  return {
    id, createdAt: '2026-08-20T00:00:00.000Z',
    tokSPrefill: 3800, tokSOut: 105, contextLength: 8192,
    promptTokens: 2048, outputTokens: 512,
    hardwareGroupKey: id, hardwareGroupLabel: id,
    hardware: { hwClass: 'DISCRETE_GPU', gpuName: id, gpuCount: 1, vramGb: 32 },
    model: { hfId: 'unsloth/Qwen3.6-27B-GGUF', displayName: 'Qwen3.6 27B', params: 27 },
    engine: { engineName: 'llama.cpp', engineVersion: 'b6123', quantization: 'q4_k_m' },
    batchSize: 1,
    ...hwOverrides
  };
}

const ROWS = [
  row('rtx5090', { hardware: { hwClass: 'DISCRETE_GPU', gpuName: 'RTX 5090', gpuCount: 1, vramGb: 32 } }),
  // Small card: survives an 8 GB cap but fails the 128k-context fit check.
  row('rtx5060ti', { hardware: { hwClass: 'DISCRETE_GPU', gpuName: 'RTX 5060 Ti', gpuCount: 1, vramGb: 8 } }),
  // Unknown memory: no vramGb/unifiedMemoryGb anywhere.
  row('mysterybox', {
    hardware: { hwClass: 'DISCRETE_GPU', gpuName: 'Mystery Box', gpuCount: 1 },
    unifiedMemoryGb: null
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

test('#780: unconstrained responses carry no telemetry fields (byte-stable)', async () => {
  await withMockedUpstream(async () => {
    const { status, body } = await bestBody({ by: 'decode' });
    assert.equal(status, 200);
    assert.equal(body.matchedRuns, 3);
    for (const k of ['excludedByFit', 'runsBeforeFit', 'excludedByMaxVramGb', 'excludedUnknownMemory']) {
      assert.equal(k in body, false, `${k} must be absent without the matching filter`);
    }
  });
});

test('#780: fit check reports runsBeforeFit + excludedByFit', async () => {
  await withMockedUpstream(async () => {
    const { body } = await bestBody({ by: 'decode', contextLength: '32768' });
    assert.equal(body.runsBeforeFit, 3);
    // Only the 32 GB rig holds 27B @ 32k fp16-KV; the rest are eliminated.
    assert.equal(body.excludedByFit, 2);
    assert.equal(body.matchedRuns, 1);
  });
});

test('#780: maxVramGb counts over-cap vs unknown-memory separately', async () => {
  await withMockedUpstream(async () => {
    const { body } = await bestBody({ by: 'decode', maxVramGb: '8' });
    assert.equal(body.excludedByMaxVramGb, 1); // RTX 5090 (32 GB) over cap
    assert.equal(body.excludedUnknownMemory, 1); // mystery box has no memory figure
    assert.equal(body.matchedRuns, 1);
  });
});

test('#780: no maxVramGb → its counters absent even when fitCheck runs', async () => {
  await withMockedUpstream(async () => {
    const { body } = await bestBody({ by: 'decode', fitCheck: 'true' });
    assert.equal('excludedByFit' in body, true);
    assert.equal('excludedByMaxVramGb' in body, false);
    assert.equal('excludedUnknownMemory' in body, false);
  });
});
