// Method-contract tests:
//  - #927: /api/og's intended 405 METHOD_NOT_ALLOWED must ship as a 405
//    problem+json, not a 500 INTERNAL — toApiError() now honors .status/.code
//    carried on plain Error instances (same pattern as _gguf/_hfconfig 502s).
//  - #981: every 405 response carries the RFC 9110 §15.5.5-mandatory `Allow`
//    header so agents learn the supported verb set without burning quota on
//    verb-by-verb probing.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { toApiError } = await import('../api/_errors.js');
const og = (await import('../api/_handlers/og.js')).default;
const localmaxxing = (await import('../api/_handlers/localmaxxing.js')).default;
const dispatch = (await import('../api/_handlers/dispatch.js')).default;
const agentFreshness = (await import('../api/_handlers/agent_freshness.js')).default;
const watch = (await import('../api/_watch_impl.js')).default;
const mcp = (await import('../api/mcp.js')).default;

function mockRes() {
  return {
    statusCode: 0,
    headers: {},
    body: undefined,
    setHeader(k, v) { this.headers[k] = v; },
    getHeader(k) {
      const want = String(k).toLowerCase();
      for (const [hk, hv] of Object.entries(this.headers)) {
        if (hk.toLowerCase() === want) return hv;
      }
      return undefined;
    },
    hasHeader(k) { return this.getHeader(k) !== undefined; },
    status(c) { this.statusCode = c; return this; },
    end(payload) { if (payload !== undefined) this.body = payload; }
  };
}

async function call(handlerFn, { method, url = '/api/x', query = {}, body } = {}) {
  const res = mockRes();
  const req = { method, url, query };
  if (body !== undefined) req.body = body;
  await handlerFn(req, res);
  let json = null;
  try { json = JSON.parse(res.body); } catch { /* binary or empty */ }
  return { res, json };
}

function allowMethods(res) {
  const allow = res.getHeader('Allow');
  return allow ? String(allow).split(',').map(s => s.trim()) : null;
}

test('#927: POST /api/og returns 405 problem+json, not 500 INTERNAL', async () => {
  const { res, json } = await call(og, { method: 'POST' });
  assert.equal(res.statusCode, 405, `expected 405, got ${res.statusCode}`);
  assert.equal(json.code, 'METHOD_NOT_ALLOWED');
  assert.equal(json.status, 405);
});

test('#981: POST /api/og carries Allow: GET, OPTIONS', async () => {
  const { res } = await call(og, { method: 'POST' });
  assert.deepEqual(allowMethods(res), ['GET', 'OPTIONS']);
});

test('#927: toApiError preserves status/code from plain Errors; garbage still INTERNAL', () => {
  const e1 = toApiError(Object.assign(new Error('nope'), { status: 405, code: 'METHOD_NOT_ALLOWED' }));
  assert.equal(e1.status, 405);
  assert.equal(e1.code, 'METHOD_NOT_ALLOWED');

  // _gguf/_hfconfig pattern: bare numeric status, no code → keeps 502, INTERNAL code
  const e2 = toApiError(Object.assign(new Error('upstream down'), { status: 502 }));
  assert.equal(e2.status, 502);

  // out-of-range / non-numeric statuses fall back to the registry default
  const e3 = toApiError(Object.assign(new Error('weird'), { status: 200 }));
  assert.equal(e3.status, 500);
  const e4 = toApiError(new TypeError('plain bug'));
  assert.equal(e4.code, 'INTERNAL');
  assert.equal(e4.status, 500);
});

test('#981: localmaxxing PUT → 405 + Allow GET, POST', async () => {
  const { res } = await call(localmaxxing, { method: 'PUT', url: '/api/localmaxxing' });
  assert.equal(res.statusCode, 405);
  assert.deepEqual(allowMethods(res), ['GET', 'POST']);
});

test('#981: watch PATCH → 405 + Allow GET, POST, DELETE', async () => {
  const { res } = await call(watch, { method: 'PATCH', url: '/api/watch' });
  assert.equal(res.statusCode, 405);
  assert.deepEqual(allowMethods(res), ['GET', 'POST', 'DELETE']);
});

test('#981: dispatch PUT → 405 + Allow GET, POST', async () => {
  const { res } = await call(dispatch, { method: 'PUT', url: '/api/watch/dispatch' });
  assert.equal(res.statusCode, 405);
  assert.deepEqual(allowMethods(res), ['GET', 'POST']);
});

test('#981: agent freshness PUT → 405 + Allow GET', async () => {
  const { res } = await call(agentFreshness, { method: 'PUT', url: '/api/agent/freshness.json' });
  assert.equal(res.statusCode, 405);
  assert.deepEqual(allowMethods(res), ['GET']);
});

test('#981: mcp PUT → 405 + Allow GET, POST, OPTIONS', async () => {
  const { res } = await call(mcp, { method: 'PUT', url: '/api/mcp' });
  assert.equal(res.statusCode, 405);
  assert.deepEqual(allowMethods(res), ['GET', 'POST', 'OPTIONS']);
});
