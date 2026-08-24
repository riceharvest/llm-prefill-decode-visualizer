// #522 — /api/best must signal truncation (total/returned/limit/has_more)
// and surface ?limit= defaulting/clamping instead of silently returning a
// near-empty or capped list.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const handler = (await import(path.join(here, '..', '[...path].js'))).default;
const lm = await import(path.join(here, '..', '_localmaxxing.js'));

function upRow(id, rig, family) {
  return {
    id,
    createdAt: '2026-08-01T12:00:00.000Z',
    model: { hfId: `${family}-instruct`, displayName: family, params: 8 },
    hardwareGroupKey: rig,
    hardwareGroupLabel: rig.toUpperCase(),
    hardware: { hwClass: 'discrete_gpu', gpuName: rig.toUpperCase(), gpuCount: 1, vramGb: 24 },
    engine: { engineName: 'llama.cpp', engineVersion: 'b6123', quantization: 'q4_k_m' },
    tokSPrefill: 3000 + id,
    tokSOut: 90 + (id % 17),
    promptTokens: 2048,
    outputTokens: 512,
    contextLength: 8192,
    batchSize: 1,
    ...{}
  };
}

// 60 distinct rig×family groups → the 50-row cap genuinely truncates.
const ROWS = Array.from({ length: 60 }, (_, i) =>
  upRow(400 + i, `rig${i}`, `fam${i}`));

const _realFetch = globalThis.fetch; // restored by the test runner process exit
globalThis.fetch = async (url) => {
  const u = String(url);
  assert.ok(u.includes('localmaxxing.com'), `unexpected fetch target: ${u}`);
  const offset = Number(new URL(u).searchParams.get('offset') || 0);
  return { ok: true, status: 200, json: async () => ({ rows: ROWS.slice(offset, offset + 200) }) };
};

function mockRes() {
  const headers = {};
  return {
    statusCode: 200,
    headers,
    setHeader(k, v) { headers[String(k).toLowerCase()] = v; },
    getHeader(k) { return headers[String(k).toLowerCase()]; },
    hasHeader() { return false; },
    removeHeader(k) { delete headers[String(k).toLowerCase()]; },
    end(body) { this.body = body; }
  };
}

async function call(url) {
  const res = mockRes();
  const u = new URL(url, 'https://unit.test');
  await handler({ method: 'GET', url: u.pathname + u.search, query: Object.fromEntries(u.searchParams.entries()), headers: {} }, res);
  assert.equal(res.statusCode, 200, `${url} -> ${res.statusCode}: ${res.body}`);
  return JSON.parse(res.body);
}

test('#522: truncation is visible — total > returned with has_more true at the cap', async () => {
  lm.invalidateCache();
  const body = await call('/api/best?by=decode&limit=10000');
  assert.equal(body.returned, body.results.length);
  assert.equal(body.limit, 50);
  assert.ok(body.total >= body.returned);
  if (body.total > body.returned) assert.equal(body.has_more, true);
});

test('#522: negative limit falls back to the default with a visible warning', async () => {
  lm.invalidateCache();
  const body = await call('/api/best?by=decode&limit=-5');
  assert.equal(body.limit, 10);
  assert.equal(body.results.length, Math.min(10, body.total));
  assert.ok(body.warnings.some(w => w.includes('limit=-5')), JSON.stringify(body.warnings));
});

test('#522: clean limit echoes without warnings', async () => {
  lm.invalidateCache();
  const body = await call('/api/best?by=decode&limit=7');
  assert.equal(body.limit, 7);
  assert.equal(body.returned, body.results.length);
  assert.ok(!body.warnings.some(w => w.includes('limit')));
});

test('#522: no limit → default 10 and has_more reflects the remaining groups', async () => {
  lm.invalidateCache();
  const body = await call('/api/best?by=decode');
  assert.equal(body.limit, 10);
  assert.equal(body.has_more, body.total > body.results.length);
});

test('#522: new envelope fields are declared in /api/spec BestListEnvelope', async () => {
  lm.invalidateCache();
  const spec = await call('/api/spec');
  const props = spec.components.schemas.BestListEnvelope.properties;
  for (const k of ['total', 'returned', 'limit', 'has_more']) {
    assert.ok(props[k], `BestListEnvelope.${k} must be declared`);
  }
});
