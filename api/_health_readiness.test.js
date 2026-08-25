// Tests for the /api/health readiness + components contract (#649 #654 #657)
// and the /api/vram projection truncation echo (#651).
//
// Run: node --test api/_health_readiness.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';

import healthHandler, { deriveReadiness } from './_handlers/health.js';
import vramHandler from './_handlers/vram.js';
import { probeWatchStore } from './_watch.js';
import { probeSubmitQueue } from './_submit.js';
import { invalidateCache } from './_localmaxxing.js';

function mockRes() {
  const headers = new Map();
  let statusCode = 200;
  let endedBody = null;
  return {
    get headers() { return Object.fromEntries(headers); },
    get endedBody() { return endedBody; },
    get statusCode() { return statusCode; },
    set statusCode(v) { statusCode = v; },
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

// ---------- deriveReadiness (#649): status -> readiness/degraded mapping ----------

test('deriveReadiness maps fresh->ready (not degraded)', () => {
  assert.deepEqual(deriveReadiness('fresh'), { readiness: 'ready', degraded: false });
});

test('deriveReadiness maps stale->degraded (status page parity: "Degraded — upstream data is stale")', () => {
  assert.deepEqual(deriveReadiness('stale'), { readiness: 'degraded', degraded: true });
});

test('deriveReadiness maps empty/unknown->starting+degraded (cold instance is not ready)', () => {
  assert.deepEqual(deriveReadiness('empty'), { readiness: 'starting', degraded: true });
  assert.deepEqual(deriveReadiness(undefined), { readiness: 'starting', degraded: true });
});

// ---------- handler wire contract (#649/#654/#657) ----------

test('/api/health stays a 200 liveness response and adds additive readiness fields', async () => {
  invalidateCache(); // deterministic cold-cache state, no network
  const r = await callHandler(healthHandler);
  assert.equal(r.status, 200);
  // legacy fields unchanged
  assert.equal(r.body.ok, true);
  for (const k of ['service', 'time', 'upstreamFreshness', 'cacheAge']) {
    assert.ok(k in r.body, `legacy field ${k} still present`);
  }
  // new additive fields
  for (const k of ['readiness', 'degraded', 'warming', 'components']) {
    assert.ok(k in r.body, `new field ${k} present`);
  }
});

test('/api/health cold cache reports warming:true / starting / degraded:true (#654)', async () => {
  invalidateCache();
  const r = await callHandler(healthHandler);
  assert.equal(r.body.upstreamFreshness.status, 'empty');
  assert.equal(r.body.warming, true);
  assert.equal(r.body.readiness, 'starting');
  assert.equal(r.body.degraded, true);
});

test('/api/health components block covers upstreamCache + watchStore + submitQueue (#657)', async () => {
  invalidateCache();
  const r = await callHandler(healthHandler);
  const c = r.body.components;
  assert.ok(c, 'components present');
  assert.deepEqual(Object.keys(c).sort(), ['submitQueue', 'upstreamCache', 'watchStore']);
  assert.equal(c.upstreamCache.status, 'empty');
  // On any normal runtime both stores live in a writable temp dir -> healthy.
  assert.equal(c.watchStore.ok, true);
  assert.equal(c.submitQueue.ok, true);
});

test('store probes are ok on a writable dir and report errors when it is not (#657)', async () => {
  const good = await probeWatchStore();
  assert.equal(good.ok, true);
  const goodQ = await probeSubmitQueue();
  assert.equal(goodQ.ok, true);

  const orig = process.env.WATCHES_DIR;
  process.env.WATCHES_DIR = '/nonexistent-afix-648-dir';
  try {
    const bad = await probeWatchStore();
    assert.equal(bad.ok, false);
    assert.match(String(bad.error), /.+/);
  } finally {
    if (orig === undefined) delete process.env.WATCHES_DIR;
    else process.env.WATCHES_DIR = orig;
  }
});

// ---------- /api/vram projection truncation echo (#651) ----------

const OFFLINE_HFID = 'meta-llama/Llama-3.1-8B-Instruct'; // resolves from built-in table

test('/api/vram echoes requestedNumTurns and flags truncation past the 200-turn window (#651)', async () => {
  const r = await callHandler(vramHandler, { query: { hfId: OFFLINE_HFID, numTurns: 500, tokensPerTurn: 100 } });
  assert.equal(r.status, 200);
  const p = r.body.projection;
  assert.ok(p, 'projection present');
  assert.equal(p.numTurns, 200, 'window still capped at 200 turns');
  assert.equal(p.requestedNumTurns, 500, 'requested count echoed');
  assert.equal(p.truncated, true, 'truncation flagged');
  assert.match(String(p.note), /capped at 200 of 500/, 'note names the window vs request');
  assert.equal(p.turns.length, 200);
});

test('/api/vram projection omits truncated flag when the window covers the request (#651)', async () => {
  const r = await callHandler(vramHandler, { query: { hfId: OFFLINE_HFID, numTurns: 50, tokensPerTurn: 2000 } });
  assert.equal(r.status, 200);
  const p = r.body.projection;
  assert.equal(p.numTurns, 50);
  assert.equal(p.requestedNumTurns, 50);
  assert.equal('truncated' in p, false, 'no truncated key when nothing was cut');
  assert.equal('note' in p, false);
});
