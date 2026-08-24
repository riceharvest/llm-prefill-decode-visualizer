// Vary: Accept-Encoding on the file-routed /api/mcp transport + static agent
// index (#1002).
//
// Vercel serves api/mcp.js as its own function, so it bypasses the catch-all
// router's shared middleware (api/[...path].js) — and it was the only API
// route omitting `Vary: Accept-Encoding` entirely. The platform compresses
// per Accept-Encoding, so without Vary the CDN can cross-serve identity/gzip
// variants. The static /api/agent/index.json (served from public/ via the
// CDN, also with br/gzip variants and no Vary) is covered by a scoped
// vercel.json headers entry. Pinned here so neither regresses.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import mcp from '../api/mcp.js';

/** Invoke the MCP handler with a mock res and return status + headers. */
async function call({ method = 'POST', headers = {}, body = null, url = '/api/mcp' } = {}) {
  const captured = {};
  const res = {
    statusCode: 0,
    headers: {},
    setHeader(k, v) { this.headers[String(k).toLowerCase()] = v; },
    getHeader(k) { return this.headers[String(k).toLowerCase()]; },
    hasHeader(k) { return String(k).toLowerCase() in this.headers; },
    end(b) {
      captured.status = this.statusCode;
      captured.rawBody = b ?? '';
    }
  };
  await mcp({ method, url, headers, body }, res);
  return { status: captured.status, headers: res.headers };
}

test('every MCP response carries Vary: Accept-Encoding (#1002)', async () => {
  const post = await call({ body: { jsonrpc: '2.0', id: 1, method: 'tools/list' } });
  assert.equal(post.status, 200);
  assert.equal(post.headers['vary'], 'Accept-Encoding');

  // Discovery GET and the JSON-RPC error path must vary too.
  const get = await call({ method: 'GET' });
  assert.equal(get.headers['vary'], 'Accept-Encoding');
  const err = await call({ body: { jsonrpc: '2.0', id: 2, method: 'nope' } });
  assert.equal(err.status, 404);
  assert.equal(err.headers['vary'], 'Accept-Encoding');
});

test('OPTIONS preflight carries Vary as well', async () => {
  const { status, headers } = await call({ method: 'OPTIONS' });
  assert.equal(status, 204);
  assert.equal(headers['vary'], 'Accept-Encoding');
});

test('202 notifications/initialized response carries Vary', async () => {
  const { status, headers } = await call({
    body: { jsonrpc: '2.0', method: 'notifications/initialized' }
  });
  assert.equal(status, 202);
  assert.equal(headers['vary'], 'Accept-Encoding');
});

const here = path.dirname(fileURLToPath(import.meta.url));

test('static /api/agent/index.json gets Vary via vercel.json (#1002)', () => {
  const cfg = JSON.parse(readFileSync(path.join(here, '..', 'vercel.json'), 'utf8'));
  const entry = (cfg.headers || []).find(h => h.source === '/api/agent/index.json');
  assert.ok(entry, 'vercel.json must declare a headers entry for /api/agent/index.json');
  const vary = (entry.headers || []).find(h => h.key.toLowerCase() === 'vary');
  assert.ok(vary, 'that entry must set a Vary header');
  assert.equal(vary.value, 'Accept-Encoding');
});
