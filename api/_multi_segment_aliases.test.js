// Routing tests for the single-segment alias layer that makes multi-segment
// agent endpoints reachable (issues #372 #373 #376 #381).
//
// Background: the platform edge never routes multi-segment /api/* paths to the
// catch-all function, so every advertised path like /api/calc/<id>,
// /api/watch/rss.xml and /api/agent/*.json 404s in production with Vercel's
// plain-text NOT_FOUND even though api/[...path].js handles them perfectly
// well once a request arrives. Fix: vercel.json rewrites each advertised
// multi-segment path to a single-segment alias (?id= / ?file= carry the
// original path parameters) and the router dispatches those aliases to the
// existing handlers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import handler from '../api/[...path].js';
import { computeBody } from '../api/_handlers/compute.js';
import { invalidateCache } from '../api/_localmaxxing.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

function mockRes({ raw = false } = {}) {
  const captured = { status: 0, headers: {}, body: null };
  const res = {
    captured,
    statusCode: 0,
    headers: {},
    setHeader(k, v) { this.headers[k] = v; },
    getHeader(k) { return this.headers[k]; },
    hasHeader(k) { return k.toLowerCase() in this.headers; },
    status(c) { this.statusCode = c; return this; },
    end(b) {
      captured.status = this.statusCode || 200;
      captured.headers = { ...this.headers };
      if (b == null) return;
      if (raw) { captured.body = String(b); return; }
      try { captured.body = JSON.parse(b); } catch { captured.body = String(b); }
    }
  };
  return res;
}

async function callRouter(url, query = {}, opts = {}) {
  const res = mockRes(opts);
  await handler({ method: 'GET', url, query, headers: { host: 'localhost' } }, res);
  return res.captured;
}

test('vercel.json rewrites every advertised multi-segment API path to a single-segment alias', () => {
  const vercel = JSON.parse(readFileSync(`${ROOT}/vercel.json`, 'utf8'));
  const rewrites = vercel.rewrites;
  const destFor = source => rewrites.find(r => r.source === source)?.destination;

  // calc replay (#376)
  assert.equal(destFor('/api/calc/:id'), '/api/calc-replay?id=:id');
  // watch feed + cron delivery (#373)
  assert.equal(destFor('/api/watch/rss.xml'), '/api/watch-rss');
  assert.equal(destFor('/api/watch/dispatch'), '/api/watch-dispatch');
  // agent discovery family (#372 #381)
  for (const f of ['capabilities', 'compute', 'benchmarks', 'scenario', 'freshness', 'confidence']) {
    assert.equal(destFor(`/api/agent/${f}.json`), `/api/agent-json?file=${f}.json`);
  }
  // /v1/ aliases must be rewritten BEFORE the generic /v1/:path* rule,
  // otherwise they land back on unreachable multi-segment paths.
  assert.equal(destFor('/v1/calc/:id'), '/api/calc-replay?id=:id');
  assert.equal(destFor('/v1/watch/rss.xml'), '/api/watch-rss');
  assert.equal(destFor('/v1/watch/dispatch'), '/api/watch-dispatch');
  for (const f of ['capabilities', 'compute', 'benchmarks', 'scenario', 'freshness', 'confidence']) {
    assert.equal(destFor(`/v1/agent/${f}.json`), `/api/agent-json?file=${f}.json`);
  }
  const genericIdx = rewrites.findIndex(r => r.source === '/v1/:path*');
  assert.ok(genericIdx > 0);
  for (const r of rewrites) {
    const path = r.destination.split('?')[0];
    if (path.startsWith('/api/') && path !== '/api/[...path]') {
      const segments = path.replace(/^\/api\//, '').split('/').filter(Boolean);
      assert.equal(segments.length, 1, `${r.destination} must be single-segment`);
    }
  }
});

const PARAMS = { model: 'singleTurn', promptTokens: 4096, outputTokens: 512, prefillSpeed: 3800, decodeSpeed: 105 };

test('#376 calc replay works through the /api/calc/<id> -> calc-replay alias', async () => {
  const minted = computeBody(PARAMS);
  assert.equal(minted.status, 200);

  const query = { id: minted.body.id, ...Object.fromEntries(Object.entries(PARAMS).map(([k, v]) => [k, String(v)])) };
  const { status, body } = await callRouter('/api/calc-replay?id=' + minted.body.id, query);
  assert.equal(status, 200);
  assert.equal(body.id, minted.body.id);
  assert.equal(body.verified, true);
});

test('#376 invalid calc ids get a JSON 400 through the alias, never a platform text 404', async () => {
  const { status, body } = await callRouter('/api/calc-replay', { id: 'not-an-id' });
  assert.equal(status, 400);
  assert.match(body.error, /Invalid calc id/);

  const missing = await callRouter('/api/calc-replay', { id: 'calc_9536a8f7358a' });
  assert.equal(missing.status, 400);
  assert.match(missing.body.error, /Missing request parameters/);
});

async function stubDataset(t) {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
    invalidateCache();
  });
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({ rows: [{
      id: 'r1', tokSPrefill: 1200, tokSOut: 100,
      hardwareGroupKey: 'rtx-4090', hardwareGroupLabel: 'RTX 4090',
      model: { hfId: 'org/Test-8B', displayName: 'Test 8B' },
      engine: { engineName: 'llama.cpp', quantization: 'q4_k_m' },
      batchSize: 1, createdAt: new Date().toISOString()
    }] })
  });
  invalidateCache();
}

test('#373 rss feed serves application/rss+xml through the watch-rss alias', async t => {
  await stubDataset(t);
  const { status, headers, body } = await callRouter('/api/watch-rss?model=Test+8B&hardware=RTX+4090', { model: 'Test 8B', hardware: 'RTX 4090' }, { raw: true });
  assert.equal(status, 200);
  assert.match(String(headers['Content-Type']), /application\/rss\+xml/);
  assert.ok(headers['X-Matched-Runs'] !== undefined);
  assert.ok(body.includes('<rss'), 'body should be an RSS document');
});

test('#373 dispatch endpoint answers JSON through the watch-dispatch alias', async () => {
  const { status, body } = await callRouter('/api/watch-dispatch', {});
  assert.equal(status, 200);
  assert.equal(body.dispatched, 0);
});

test('#372 #381 agent-json alias serves every advertised discovery document', async t => {
  await stubDataset(t);
  for (const [file, check] of [
    ['capabilities.json', b => Array.isArray(b.surfaces) && b.surfaces.length > 5],
    ['benchmarks.json', b => Array.isArray(b.runs)],
    ['freshness.json', b => typeof b.description === 'string' && b.generatedAt !== undefined],
    ['confidence.json', b => typeof b.description === 'string'],
  ]) {
    const { status, body } = await callRouter(`/api/agent-json?file=${file}`, { file });
    assert.equal(status, 200, file);
    assert.ok(check(body), `${file} payload shape`);
  }

  const scenario = await callRouter('/api/agent-json?file=scenario.json', { file: 'scenario.json' });
  assert.equal(scenario.status, 200, 'scenario.json reachable');

  const compute = await callRouter('/api/agent-json?file=compute.json', { file: 'compute.json' });
  assert.equal(compute.status, 200, 'compute.json reachable');

  const bogus = await callRouter('/api/agent-json?file=nope.json', { file: 'nope.json' });
  assert.equal(bogus.status, 404);
  assert.equal(bogus.body.error, 'Not found');
});
