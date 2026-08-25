// Regression tests for #835 #836 #840:
// - #835: OpenAPI ComputeResult time metrics must be declared nullable
//   (`['number','null']`) because /api/compute emits literal null for
//   degenerate inputs (zero speeds); clients/typescript/schema.d.ts mirrors it.
// - #836: /api/best workload provenance must stay honest when an explicit
//   token override rides along a ?scenario= preset (source was lying as
//   'scenario:<id>' for mixed requests).
// - #840: unknown ?scenario= ids must be surfaced (warnings[] entry +
//   requestedScenario echo) instead of silently becoming default chat, and
//   ?scenario= must be declared in the /api/spec best operation.
//
// Run: node --test api/_handlers/_best_scenario.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { bestBody, resolveWorkload } from './best.js';
import computeHandler from './compute.js';
import specHandler from './spec.js';
import { invalidateCache } from '../_localmaxxing.js';
import { SCENARIO_PRESETS } from '../../src/utils/presets.js';

// ---------- harness (mirrors _spec_drift.test.js) ----------

function mockRes() {
  const headers = new Map();
  let statusCode = 200;
  let endedBody = null;
  return {
    get headers() { return Object.fromEntries(headers); },
    get endedBody() { return endedBody; },
    get statusCode() { return statusCode; },
    set statusCode(v) { statusCode = v; },
    status(v) { statusCode = v; return this; },
    setHeader(k, v) { headers.set(k.toLowerCase(), v); },
    getHeader(k) { return headers.get(String(k).toLowerCase()); },
    end(body) { endedBody = body ?? ''; }
  };
}

async function callHandler(handler, { query = {}, method = 'GET' } = {}) {
  const req = { method, query, url: '/api/test' };
  const res = mockRes();
  await handler(req, res);
  let parsed = null;
  try { parsed = JSON.parse(res.endedBody); } catch { /* non-JSON */ }
  return { status: res.statusCode, body: parsed, headers: res.headers };
}

const MOCK_ROWS = [
  {
    id: 'r1', createdAt: '2026-08-10T00:00:00.000Z',
    tokSPrefill: 3800, tokSOut: 105, contextLength: 4096,
    hardwareGroupKey: 'rtx4090', hardwareGroupLabel: 'RTX 4090 24GB',
    hardware: { hwClass: 'discrete_gpu', gpuName: 'RTX 4090', gpuCount: 1, vramGb: 24 },
    model: { hfId: 'unsloth/Qwen3.6-27B-MTP-GGUF', displayName: 'Qwen3.6 27B MTP', params: 27 },
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

async function getSpec() {
  return callHandler(specHandler);
}

// ---------- #836: honest workload provenance ----------

test('resolveWorkload: pure scenario request keeps source scenario:<id>', () => {
  const wl = resolveWorkload({ scenario: 'longdoc' });
  assert.equal(wl.promptTokens, 32768);
  assert.equal(wl.outputTokens, 256);
  assert.equal(wl.source, 'scenario:longdoc');
  assert.deepEqual(wl.overrides, []);
  assert.equal(wl.requestedScenario, 'longdoc');
  assert.equal(wl.scenarioKnown, true);
});

test('resolveWorkload (#836): single-axis override on a scenario is mixed, not pure scenario', () => {
  const wl = resolveWorkload({ scenario: 'longdoc', promptTokens: 100 });
  assert.equal(wl.promptTokens, 100, 'override must win for that axis');
  assert.equal(wl.outputTokens, 256, 'unset axis still comes from the preset');
  assert.equal(wl.source, 'mixed:longdoc+query');
  assert.deepEqual(wl.overrides, ['promptTokens']);
  assert.equal(wl.scenarioKnown, true);
});

test('resolveWorkload: both axes overridden is pure query regardless of scenario', () => {
  const wl = resolveWorkload({ scenario: 'longdoc', promptTokens: 100, outputTokens: 7 });
  assert.equal(wl.source, 'query');
  assert.deepEqual([...wl.overrides].sort(), ['outputTokens', 'promptTokens']);
});

test('resolveWorkload: single-axis override without a scenario is mixed vs default chat', () => {
  const wl = resolveWorkload({ promptTokens: 55 });
  assert.equal(wl.outputTokens, 512);
  assert.equal(wl.source, 'mixed:default+query');
  assert.deepEqual(wl.overrides, ['promptTokens']);
});

test('resolveWorkload: no inputs at all stays default:chat', () => {
  const wl = resolveWorkload({});
  assert.equal(wl.source, 'default:chat');
  assert.deepEqual(wl.overrides, []);
  assert.equal(wl.requestedScenario, null);
});

test('/api/best walltime response carries honest workload provenance (#836)', async () => {
  await withMockedUpstream(async () => {
    const { status, body } = await bestBody({ by: 'walltime', scenario: 'longdoc', promptTokens: 100 });
    assert.equal(status, 200);
    assert.equal(body.workload.promptTokens, 100);
    assert.equal(body.workload.outputTokens, 256);
    assert.equal(body.workload.source, 'mixed:longdoc+query',
      'source must NOT claim the pure longdoc preset when promptTokens came from the query');
    assert.ok(body.workload.overrides.includes('promptTokens'));
    assert.equal(body.workload.requestedScenario, 'longdoc');
    assert.equal(body.requestedScenario, 'longdoc');
  });
});

// ---------- #840: unknown scenario ids are surfaced, never silent ----------

test('resolveWorkload: unknown scenario id flagged via scenarioKnown=false', () => {
  const wl = resolveWorkload({ scenario: 'bogus123' });
  assert.equal(wl.scenarioKnown, false);
  assert.equal(wl.requestedScenario, 'bogus123');
  assert.equal(wl.source, 'default:chat');
  assert.equal(wl.scenarioLabel, null);
});

test('/api/best unknown ?scenario= warns + echoes instead of silent fallback (#840)', async () => {
  await withMockedUpstream(async () => {
    const { status, body } = await bestBody({ by: 'walltime', scenario: 'bogus123' });
    assert.equal(status, 200);
    assert.equal(body.requestedScenario, 'bogus123');
    const hit = body.warnings.find(w => typeof w === 'string' && w.includes('bogus123'));
    assert.ok(hit, 'warnings[] must name the rejected scenario id');
    for (const id of SCENARIO_PRESETS.map(s => s.id)) {
      assert.ok(hit.includes(id), `warning should list valid id '${id}'`);
    }
    assert.equal(body.workload.source, 'default:chat');
  });
});

test('/api/best known scenario produces no unknown-scenario warning', async () => {
  await withMockedUpstream(async () => {
    const { body } = await bestBody({ by: 'walltime', scenario: 'codegen' });
    assert.equal(body.requestedScenario, 'codegen');
    assert.ok(!body.warnings.some(w => typeof w === 'string' && w.toLowerCase().includes('unknown ?scenario')),
      'known id must not trigger the unknown-scenario warning');
    assert.match(body.workload.source, /^scenario:codegen$/);
  });
});

test('/api/spec declares ?scenario= on GET /api/best with the real preset-id enum (#840)', async () => {
  const { body: spec } = await getSpec();
  const param = spec.paths['/api/best'].get.parameters.find(p => p.name === 'scenario');
  assert.ok(param, 'GET /api/best must document the ?scenario= parameter');
  assert.deepEqual(
    [...param.schema.enum].sort(),
    [...SCENARIO_PRESETS.map(s => s.id)].sort()
  );
});

// ---------- #835: ComputeResult nullable time metrics ----------

test('/api/compute emits literal nulls for degenerate singleTurn inputs', async () => {
  const { status, body } = await callHandler(computeHandler, {
    query: { model: 'singleTurn', promptTokens: 100, outputTokens: 512, decodeSpeed: 0 }
  });
  assert.equal(status, 200);
  assert.equal(body.tpotMs, null);
  assert.equal(body.decodeSeconds, null);
  assert.equal(body.totalWalltimeSeconds, null);
  assert.equal(body.decodeSharePct, null);
  assert.equal(typeof body.ttftSeconds, 'number', 'prefill leg stays finite here');
});

test('spec declares ComputeResult time metrics nullable with null semantics (#835)', async () => {
  const { body: spec } = await getSpec();
  const result = spec.components.schemas.ComputeResult;
  for (const field of ['ttftSeconds', 'tpotMs', 'decodeSeconds', 'totalWalltimeSeconds', 'prefillSharePct', 'decodeSharePct']) {
    assert.deepEqual(result.properties[field].type, ['number', 'null'],
      `${field} must be declared number|null (wire emits null on degenerate inputs)`);
    assert.match(result.properties[field].description ?? '', /null/i,
      `${field} description must document what null means`);
  }
  // effectiveThroughputTokPerSec is fabricated as 0, not null — documented.
  assert.deepEqual(result.properties.effectiveThroughputTokPerSec.type, 'number');
  assert.match(result.properties.effectiveThroughputTokPerSec.description, /0/);
});

test('clients/typescript/schema.d.ts mirrors nullable ComputeResult metrics (#835)', async () => {
  const { readFileSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const { dirname, join } = await import('node:path');
  const dts = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../../clients/typescript/schema.d.ts'), 'utf8');
  const schemaStart = dts.indexOf('ComputeResult:');
  assert.ok(schemaStart > 0, 'ComputeResult block found in schema.d.ts');
  const nextBlock = dts.indexOf('ComputeResponse:', schemaStart);
  const block = dts.slice(schemaStart, nextBlock);
  for (const field of ['ttftSeconds', 'tpotMs', 'decodeSeconds', 'totalWalltimeSeconds', 'prefillSharePct', 'decodeSharePct']) {
    const m = block.match(new RegExp(`${field}\\?:\\s*([^;]+);`));
    assert.ok(m, `${field} present in generated d.ts`);
    assert.ok(m[1].includes('null'), `${field} must be typed number | null in schema.d.ts (got '${m[1]}')`);
  }
});
