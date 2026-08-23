// Tests for /api/agent/freshness.json (api/_handlers/agent_freshness.js).
// The endpoint WRAPS existing computations — groupFreshness/staleness tiers
// (_freshness.js), confidenceFor/aggregate (_localmaxxing.js), getCacheInfo
// (/api/health) — so these asserts check the wrap-not-duplicate contract:
// envelope shape, tier/grade semantics identical to the rest of the API,
// and cross-block consistency of the summary.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  default as handler,
  buildFreshnessBody,
  runFreshnessReport,
  confidenceGrade
} from '../api/_handlers/agent_freshness.js';
import { invalidateCache } from '../api/_localmaxxing.js';

const NOW = new Date('2026-08-23T12:00:00Z');
const daysAgo = n => new Date(new Date('2026-08-23T12:00:00Z').getTime() - n * 86400000).toISOString();

/** Synthetic slim run (same field names getAllRuns() produces). */
function run(overrides = {}) {
  return {
    runId: overrides.runId ?? Math.random().toString(36).slice(2),
    // Explicit null must survive (undated runs): ?? would swallow it.
    createdAt: Object.hasOwn(overrides, 'createdAt') ? overrides.createdAt : daysAgo(5),
    modelFamily: overrides.modelFamily ?? 'llama-3-8b',
    modelId: overrides.modelId ?? 'meta-llama/Meta-Llama-3-8B',
    hardwareKey: overrides.hardwareKey ?? 'rtx-4090',
    hardware: overrides.hardware ?? 'RTX 4090',
    quantization: overrides.quantization ?? 'q4_k_m',
    engine: overrides.engine ?? 'llama.cpp',
    engineVersion: overrides.engineVersion ?? null,
    prefillTokPerSec: overrides.prefillTokPerSec ?? 3000,
    decodeTokPerSec: overrides.decodeTokPerSec ?? 100
  };
}

test('confidenceGrade buckets match the documented thresholds', () => {
  assert.equal(confidenceGrade(100), 'high');
  assert.equal(confidenceGrade(70), 'high');
  assert.equal(confidenceGrade(69), 'medium');
  assert.equal(confidenceGrade(40), 'medium');
  assert.equal(confidenceGrade(39), 'low');
  assert.equal(confidenceGrade(0), 'low');
  assert.equal(confidenceGrade(NaN), 'unknown');
});

test('envelope carries the agent contract fields', () => {
  const { status, body } = buildFreshnessBody([run()], {}, { now: NOW });
  assert.equal(status, 200);
  for (const field of ['description', 'endpoint', 'generatedAt', 'filters', 'cache', 'dataset', 'groups', 'summary', 'caveats', 'relatedEndpoints']) {
    assert.ok(field in body, `missing envelope field: ${field}`);
  }
  assert.equal(body.endpoint, '/api/agent/freshness.json');
  assert.match(body.description, /fresh/i);
  // schema_version is stamped by sendJson at the HTTP layer, not here.
});

test('dataset block reports staleness tiers with the shared tier semantics', () => {
  const runs = [
    run({ runId: 'fresh', createdAt: daysAgo(10) }),   // <90d → fresh
    run({ runId: 'aging', createdAt: daysAgo(200) }),  // <365d → aging
    run({ runId: 'stale', createdAt: daysAgo(500) }),  // >=365d → stale
    run({ runId: 'unknown', createdAt: null })         // no date → unknown
  ];
  const { body } = buildFreshnessBody(runs, {}, { now: NOW });

  assert.deepEqual(body.dataset.stalenessTiers, { fresh: 1, aging: 1, stale: 1, unknown: 1 });
  assert.equal(body.dataset.totalRuns, 4);
  assert.equal(body.dataset.datedRuns, 3);
  assert.equal(body.dataset.undatedRuns, 1);
  // Overall window follows the NEWEST dated run (the fresh one).
  assert.equal(body.dataset.newestRunAt, daysAgo(10));
  assert.equal(body.dataset.staleness, 'fresh');
  assert.equal(body.dataset.newestAgeDays, 10);
});

test('each group carries confidence + freshness computed by the shared engine', () => {
  const runs = [
    run({ runId: 'a', decodeTokPerSec: 100 }),
    run({ runId: 'b', decodeTokPerSec: 101 }),
    run({ runId: 'c', decodeTokPerSec: 99 })
  ];
  const { body } = buildFreshnessBody(runs, {}, { now: NOW });

  assert.equal(body.groups.length, 1);
  const g = body.groups[0];
  assert.equal(g.key, 'rtx-4090|llama-3-8b');
  assert.equal(g.runs, 3);
  assert.ok(g.confidence.score >= 0 && g.confidence.score <= 100);
  assert.equal(g.confidence.grade, confidenceGrade(g.confidence.score));
  for (const f of ['newestRunAt', 'oldestRunAt', 'newestAgeDays', 'staleness']) {
    assert.ok(f in g.freshness, `group freshness missing ${f}`);
  }
  assert.equal(g.freshness.staleness, 'fresh');
});

test('groupBy=hardware|model regroups without re-implementing aggregation', () => {
  const runs = [
    run({ runId: 'a', hardwareKey: 'rtx-4090', modelFamily: 'llama-3-8b' }),
    run({ runId: 'b', hardwareKey: 'm3-ultra', modelFamily: 'llama-3-8b' })
  ];
  const hw = buildFreshnessBody(runs, { groupBy: 'hardware' }, { now: NOW }).body;
  assert.deepEqual(hw.groups.map(g => g.key).sort(), ['m3-ultra', 'rtx-4090']);

  const mdl = buildFreshnessBody(runs, { groupBy: 'model' }, { now: NOW }).body;
  assert.deepEqual(mdl.groups.map(g => g.key), ['llama-3-8b']);
});

test('filters echo back and actually filter (?model=, ?quant=, ?max_age=)', () => {
  const runs = [
    run({ runId: 'keep', quantization: 'q4_k_m' }),
    run({ runId: 'dropquant', quantization: 'q8_0' }),
    run({ runId: 'dropmodel', modelFamily: 'qwen-2.5-7b', modelId: 'Qwen/Qwen2.5-7B' }),
    run({ runId: 'dropold', createdAt: daysAgo(999) }),
    run({ runId: 'dropnodate', createdAt: null })
  ];
  const { body } = buildFreshnessBody(
    runs,
    { model: 'llama', quant: 'q4_k_m', max_age: '90' },
    { now: NOW }
  );

  assert.equal(body.filters.model, 'llama');
  assert.equal(body.filters.quant, 'q4_k_m');
  assert.equal(body.filters.maxAgeDays, 90);
  assert.equal(body.dataset.totalRuns, 1);
  // max_age drops undated runs too — an unverifiable date must not pass as fresh.
  assert.deepEqual(body.dataset.stalenessTiers.unknown, 0);
});

test('groups are sorted least-trustworthy first with a stable key tiebreak', () => {
  const many = Array.from({ length: 10 }, (_, i) =>
    run({ runId: `solid${i}`, hardwareKey: 'h100', decodeTokPerSec: 100 + i }));
  const few = [run({ runId: 'thin', hardwareKey: 'rpi5', decodeTokPerSec: 10 })];
  const { body } = buildFreshnessBody([...few, ...many], {}, { now: NOW });

  assert.equal(body.groups[0].key, 'rpi5|llama-3-8b');
  assert.equal(body.groups[body.groups.length - 1].key, 'h100|llama-3-8b');
});

test('summary aggregates grades and scores consistently across groups', () => {
  const many = Array.from({ length: 10 }, (_, i) =>
    run({ runId: `a${i}`, hardwareKey: 'h100', decodeTokPerSec: 100 + i }));
  const thin = [run({ runId: 'b', hardwareKey: 'rpi5', decodeTokPerSec: 42 })];
  const { body } = buildFreshnessBody([...many, ...thin], {}, { now: NOW });

  const s = body.summary;
  assert.equal(s.groups, body.groups.length);
  const gradeSum = s.confidence.grades.high + s.confidence.grades.medium + s.confidence.grades.low;
  assert.equal(gradeSum, body.groups.length);

  const expectedMean = Math.round(
    body.groups.reduce((acc, g) => acc + g.confidence.score, 0) / body.groups.length
  );
  assert.equal(s.confidence.meanScore, expectedMean);
  assert.equal(s.confidence.minScore, Math.min(...body.groups.map(g => g.confidence.score)));
  assert.equal(s.confidence.maxScore, Math.max(...body.groups.map(g => g.confidence.score)));
});

test('major-release boundary warnings surface for pre-V1 vLLM runs', () => {
  const runs = [
    run({ runId: 'old-vllm', engine: 'vLLM', createdAt: '2024-06-01T00:00:00Z' })
  ];
  const { body } = buildFreshnessBody(runs, {}, { now: NOW });

  assert.equal(body.dataset.stalenessTiers.stale, 1);
  const warnings = body.dataset.majorReleaseWarnings;
  assert.ok(warnings.length === 1 || warnings.length === body.groups[0].majorReleaseWarnings.length);
  if (warnings.length) {
    assert.equal(warnings[0].engine, 'vLLM');
    assert.match(warnings[0].message, /V1/);
  }
});

test('cache block mirrors getCacheInfo (empty before any dataset fetch)', () => {
  invalidateCache();
  const { body } = buildFreshnessBody([run()], {}, { now: NOW });
  assert.equal(body.cache.status, 'empty'); // nothing fetched yet in this process
  assert.equal(body.cache.ttlSeconds, 600);
  assert.ok(body.cache.source.includes('localmaxxing.com'));
});

test('live report resolves runs through resolveRuns and stamps snapshot metadata', async t => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
    invalidateCache();
  });
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({ rows: [{
      id: 'r1', tokSPrefill: 1200, tokSOut: 100, batchSize: 1,
      createdAt: daysAgo(3),
      hardwareGroupKey: 'rtx-4090', hardwareGroupLabel: 'RTX 4090',
      model: { hfId: 'org/Test-8B', displayName: 'Test 8B' },
      engine: { engineName: 'llama.cpp', quantization: 'q4_k_m' }
    }] })
  });
  invalidateCache();

  const { status, body } = await runFreshnessReport({}, { now: NOW });
  assert.equal(status, 200);
  assert.match(body.snapshot.id, /^snapshot-/);
  assert.equal(body.dataset.totalRuns, 1);
  assert.equal(body.dataset.staleness, 'fresh');
});

async function callHandler(url) {
  const captured = {};
  const res = {
    statusCode: 0,
    headers: {},
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
    getHeader(k) { return this.headers[k.toLowerCase()]; },
    end(bodyText) {
      captured.status = this.statusCode;
      captured.contentType = this.headers['content-type'];
      captured.body = JSON.parse(bodyText);
    }
  };
  await handler({ url, method: 'GET', query: {} }, res);
  return captured;
}

test('HTTP handler returns 200 JSON with schema_version and per-path endpoint field', async t => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
    invalidateCache();
  });
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({ rows: [{
      id: 'r1', tokSPrefill: 900, tokSOut: 60, batchSize: 1,
      createdAt: daysAgo(30),
      hardwareGroupKey: 'm3-ultra', hardwareGroupLabel: 'M3 Ultra',
      model: { hfId: 'org/Test-8B', displayName: 'Test 8B' },
      engine: { engineName: 'MLX', quantization: 'q4' }
    }] })
  });
  invalidateCache();

  const { status, contentType, body } = await callHandler('/api/agent/freshness.json');
  assert.equal(status, 200);
  assert.match(contentType, /^application\/json/);
  assert.equal(body.schema_version, '1');
  assert.equal(body.endpoint, '/api/agent/freshness.json');

  const alias = await callHandler('/api/agent/confidence.json');
  assert.equal(alias.status, 200);
  assert.equal(alias.body.endpoint, '/api/agent/confidence.json');
  // Same underlying numbers under either path.
  assert.deepEqual(alias.body.dataset.stalenessTiers, body.dataset.stalenessTiers);
});

test('HTTP handler rejects non-GET requests with 405', async () => {
  const captured = {};
  const res = {
    statusCode: 0,
    headers: {},
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
    getHeader(k) { return this.headers[k.toLowerCase()]; },
    end(bodyText) { captured.status = this.statusCode; captured.body = JSON.parse(bodyText); }
  };
  await handler({ url: '/api/agent/freshness.json', method: 'POST', query: {}, body: {} }, res);
  assert.equal(captured.status, 405);
});
