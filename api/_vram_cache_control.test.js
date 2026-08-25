// #516 — /api/vram error paths must ship cache-control: no-store.
// Error bodies depend on the caller's query string, so they must never be
// publicly cacheable; only successful estimates keep public, max-age=600.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import handler from './_handlers/vram.js';

function mockRes() {
  const headers = {};
  return {
    statusCode: 200,
    headers,
    setHeader(k, v) { headers[String(k).toLowerCase()] = v; },
    getHeader(k) { return headers[String(k).toLowerCase()]; },
    removeHeader(k) { delete headers[String(k).toLowerCase()]; },
    end(body) { this.body = body; }
  };
}

async function call(url, method = 'GET') {
  const res = mockRes();
  const u = new URL(url, 'https://unit.test');
  await handler({ method, query: Object.fromEntries(u.searchParams.entries()), url }, res);
  return res;
}

test('#516: 400 validation error ships cache-control: no-store', async () => {
  const res = await call('/api/vram'); // no hfId
  assert.equal(res.statusCode, 400);
  assert.equal(res.headers['cache-control'], 'no-store');
});

test('#516: successful estimate keeps the public CDN cache directive', async () => {
  const res = await call('/api/vram?hfId=meta-llama/Llama-3.1-8B-Instruct&context=32768');
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['cache-control'], 'public, max-age=600');
});

test('#516: upstream-failure error status is not cacheable either', async () => {
  // Unknown repo id that also fails the name-tag heuristic → thrown 404-ish
  // error rendered through the same json() helper with a non-200 status.
  const res = await call('/api/vram?hfId=definitely/not-a-real-model-xyzzy-42');
  assert.notEqual(res.statusCode, 200);
  assert.equal(res.headers['cache-control'], 'no-store');
});
