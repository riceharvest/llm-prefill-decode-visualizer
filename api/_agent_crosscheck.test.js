// Tests for GET /api/agent/crosscheck.json:
//   - pure cohort/hoist helpers (api/_handlers/agent_crosscheck.js), and
//   - catch-all router dispatch for /api/agent/crosscheck.json (+ /v1/ alias)
//     against a stubbed upstream dataset.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  keyFnFor, toAgentCrosscheckGroup, hoistContradictions
} from './_handlers/agent_crosscheck.js';
import router from '../api/[...path].js';
import { invalidateCache } from './_localmaxxing.js';

// ---------- fixtures: already-normalized run shape (see _localmaxxing.slim) ----------

function run(overrides = {}) {
  return {
    runId: 'r1',
    createdAt: '2026-08-01T00:00:00Z',
    modelFamily: 'llama-3-8b',
    modelId: 'org/llama-3-8b',
    hardwareKey: 'rtx3090',
    hardware: 'RTX 3090',
    gpuCount: 1,
    gpu: 'RTX 3090',
    engine: 'llama.cpp',
    engineVersion: 'b4000',
    quantization: 'q4_k_m',
    prefillTokPerSec: 2000,
    decodeTokPerSec: 100,
    contextLength: 8192,
    ...overrides
  };
}

// ---------- pure helpers ----------

test('keyFnFor: default cohorts are rig × engine build; crossEngine merges to rig only', () => {
  const a = run(), b = run({ engineVersion: 'b5000' });
  const defaultKey = keyFnFor(false);
  assert.notEqual(defaultKey(a), defaultKey(b));
  assert.match(defaultKey(a), /^rtx3090\|/);

  const mergedKey = keyFnFor(true);
  assert.equal(mergedKey(a), mergedKey(b));
  assert.equal(mergedKey(a), 'rtx3090');
});

test('toAgentCrosscheckGroup: healthy multi-GPU scaling yields no contradictions', () => {
  const members = [
    run(),
    run({ runId: 'r2' }),
    run({ runId: 'm1', gpuCount: 2, decodeTokPerSec: 180, prefillTokPerSec: 3600 })
  ];
  const g = toAgentCrosscheckGroup('rtx3090|llama.cpp b4000', members);
  assert.equal(g.runsInGroup, 3);
  assert.equal(g.hardware, 'RTX 3090');
  assert.deepEqual(g.models, ['llama-3-8b']);
  assert.equal(g.relatedRigComparisons, 1);
  assert.deepEqual(g.contradictions, []);
  // confidence block rides along
  assert.equal(g.confidence.runs, 3);
  assert.ok(['low', 'medium', 'high'].includes(g.confidence.grade));
});

test('toAgentCrosscheckGroup: 2x rig slower than single card is flagged', () => {
  const members = [
    run(),
    run({ runId: 'm1', gpuCount: 2, decodeTokPerSec: 80 })
  ];
  const g = toAgentCrosscheckGroup('rtx3090|llama.cpp b4000', members);
  assert.equal(g.relatedRigComparisons, 1);
  assert.equal(g.contradictions.length, 1);
  assert.equal(g.contradictions[0].kind, 'slower_than_single');
  assert.equal(g.contradictions[0].gpuCount, 2);
});

test('toAgentCrosscheckGroup: different quant or model family is never compared', () => {
  const members = [
    run(),
    run({ runId: 'm1', gpuCount: 2, quantization: 'q8_0', decodeTokPerSec: 10 })
  ];
  const g = toAgentCrosscheckGroup('k', members);
  assert.equal(g.relatedRigComparisons, 0);
  assert.deepEqual(g.contradictions, []);
});

test('hoistContradictions: flat list tagged with cohort key, in item order', () => {
  const bad = toAgentCrosscheckGroup('rig-a|x', [
    run({ hardwareKey: 'rig-a' }),
    run({ runId: 'm1', hardwareKey: 'rig-a', gpuCount: 4, decodeTokPerSec: 50 })
  ]);
  const good = toAgentCrosscheckGroup('rig-b|x', [run({ hardwareKey: 'rig-b' })]);
  const hoisted = hoistContradictions([bad, good]);
  assert.equal(hoisted.length, bad.contradictions.length);
  assert.ok(hoisted.every(c => c.group === 'rig-a|x'));
  assert.equal(hoisted[0].kind, 'slower_than_single');
});

// ---------- router dispatch (stubbed upstream) ----------

function mockRes() {
  const captured = {};
  return {
    captured,
    setHeader(k, v) { captured.headers ??= {}; captured.headers[k] = v; },
    getHeader(k) { return captured.headers?.[k]; },
    status(c) { this.statusCode = c; return this; },
    end(body) {
      captured.status = this.statusCode;
      captured.body = JSON.parse(body);
    }
  };
}

async function callRouter(url, query = {}) {
  const res = mockRes();
  await router({ url, query }, res);
  return res.captured;
}

// Upstream leaderboard rows → slim()-ed by _localmaxxing before handlers see them.
const UPSTREAM_ROWS = [
  {
    id: 's1', tokSPrefill: 2000, tokSOut: 100, createdAt: '2026-08-01T00:00:00Z', batchSize: 1,
    hardwareGroupKey: 'rtx-3090', hardwareGroupLabel: 'RTX 3090',
    hardware: { gpuName: 'RTX 3090', gpuCount: 1 },
    model: { hfId: 'org/Test-8B', displayName: 'Test 8B' },
    engine: { engineName: 'llama.cpp', engineVersion: 'b4000', quantization: 'q4_k_m' }
  },
  {
    id: 'd1', tokSPrefill: 1500, tokSOut: 70, createdAt: '2026-08-02T00:00:00Z', batchSize: 1,
    hardwareGroupKey: 'rtx-3090', hardwareGroupLabel: '2x RTX 3090',
    hardware: { gpuName: 'RTX 3090', gpuCount: 2 },
    model: { hfId: 'org/Test-8B', displayName: 'Test 8B' },
    engine: { engineName: 'llama.cpp', engineVersion: 'b4000', quantization: 'q4_k_m' }
  },
  {
    id: 'x1', tokSPrefill: 900, tokSOut: 60, createdAt: '2026-08-03T00:00:00Z', batchSize: 1,
    hardwareGroupKey: 'rx-7900xtx', hardwareGroupLabel: 'RX 7900 XTX',
    hardware: { gpuName: 'RX 7900 XTX', gpuCount: 1 },
    model: { hfId: 'org/Test-8B', displayName: 'Test 8B' },
    engine: { engineName: 'vllm', engineVersion: '0.9', quantization: 'gptq' }
  }
];

async function withStubbedUpstream(fn) {
  const originalFetch = globalThis.fetch;
  let call = 0;
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({
      rows: call++ === 0 ? UPSTREAM_ROWS : [] // second page ends pagination
    })
  });
  invalidateCache();
  try {
    return await fn();
  } finally {
    globalThis.fetch = originalFetch;
    invalidateCache();
  }
}

test('router dispatches /api/agent/crosscheck.json and its /v1/ alias to the agent handler', async () => {
  await withStubbedUpstream(async () => {
    for (const url of ['/api/agent/crosscheck.json', '/api/v1/agent/crosscheck.json']) {
      const { status, body } = await callRouter(url);
      assert.equal(status, 200, url);
      assert.equal(body.endpoint, '/api/agent/crosscheck.json');
      assert.equal(body.schema_version, '1');
      assert.equal(body.total, 2); // rtx-3090 + rx-7900xtx cohorts
    }
  });
});

test('crosscheck report flags the misconfigured multi-GPU submission first', async () => {
  await withStubbedUpstream(async () => {
    const { body } = await callRouter('/api/agent/crosscheck.json');
    // The 2x RTX 3090 row reports LESS total throughput than a single card on
    // the same model+quant+engine — caught on both decode and prefill.
    assert.equal(body.overall.contradictions, 2);
    assert.equal(body.overall.cohortsWithContradictions, 1);
    assert.equal(body.contradictions.length, 2);
    assert.ok(body.contradictions.every(c => c.group === 'rtx-3090|llama.cpp b4000'));
    assert.ok(body.contradictions.every(c => c.kind === 'slower_than_single'));
    assert.deepEqual(body.contradictions.map(c => c.metric).sort(), ['decode', 'prefill']);
    assert.equal(body.contradictions.find(c => c.metric === 'decode').gpuCount, 2);

    // Most-suspicious-first ordering.
    assert.equal(body.items[0].key, 'rtx-3090|llama.cpp b4000');
    assert.equal(body.items[0].contradictions.length, 2);
    assert.deepEqual(body.items[1].contradictions, []);

    // Every cohort carries the shared confidence block.
    for (const g of body.items) {
      assert.equal(typeof g.confidence.grade, 'string');
      assert.equal(g.confidence.runs, g.runsInGroup);
    }

    // Self-describing surface agents rely on.
    assert.ok(body.description.includes('slower_than_single'));
    assert.ok(body.contradictionKinds.poor_scaling.length > 0);
    assert.ok(body.relatedEndpoints.openapiSpec === '/api/spec');
  });
});

test('filters narrow the cross-check report (?model= substring)', async () => {
  await withStubbedUpstream(async () => {
    const { body } = await callRouter('/api/agent/crosscheck.json', { model: 'no-such-model' });
    assert.equal(body.status ?? 200, 200);
    assert.equal(body.total, 0);
    assert.equal(body.overall.runsInDataset, 0);
    assert.deepEqual(body.contradictions, []);
  });
});
