// MCP transport metadata fidelity (issues #880 #946 #949).
//
// Pins three contracts on /api/mcp that previously only held on the REST
// catch-all surface:
//   #946 — a client-supplied X-Request-Id is echoed on every MCP response
//          (api/mcp.js wins file-routing over [...path].js, so it must apply
//          the shared echo middleware itself).
//   #880 — the initialize handshake reports the same release version as
//          /api/version (package.json), carries schemaVersion, and every
//          response stamps X-Schema-Version.
//   #949 — overlong request ids are truncated with an explicit
//          X-Request-Id-Truncated marker instead of silent amputation
//          (covered for both transports here).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import mcp from '../api/mcp.js';
import catchAll from '../api/[...path].js';

const PKG_VERSION = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8')
).version;

/** POST one JSON-RPC message at the MCP handler with mocked res/headers. */
async function rpc(message, headers = {}) {
  const captured = {};
  const res = {
    statusCode: 0,
    headers: {},
    setHeader(k, v) { this.headers[k] = v; },
    getHeader(k) { return this.headers[String(k).toLowerCase()]; },
    end(body) {
      captured.status = this.statusCode;
      captured.rawBody = body;
    }
  };
  await mcp({ method: 'POST', url: '/api/mcp', headers, body: message }, res);
  return {
    status: captured.status,
    headers: res.headers,
    body: captured.rawBody ? JSON.parse(captured.rawBody) : null
  };
}

test('#880: initialize reports the release version from package.json (same source as /api/version)', async () => {
  const { status, body } = await rpc({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
  assert.equal(status, 200);
  assert.equal(body.result.serverInfo.version, PKG_VERSION,
    'MCP serverInfo.version must match the app version /api/version reports');
  assert.notEqual(body.result.serverInfo.version, '1.0.0',
    'must no longer be the hardcoded third version vocabulary');
});

test('#880: initialize carries the wire schemaVersion matching X-Schema-Version', async () => {
  const { headers, body } = await rpc({ jsonrpc: '2.0', id: 2, method: 'initialize', params: {} });
  assert.equal(body.result.schemaVersion, '1');
  assert.equal(headers['X-Schema-Version'], '1');
});

test('#880: every JSON-RPC response stamps X-Schema-Version, including errors', async () => {
  const ok = await rpc({ jsonrpc: '2.0', id: 3, method: 'ping' });
  assert.equal(ok.headers['X-Schema-Version'], '1');

  const err = await rpc({ jsonrpc: '2.0', id: 4, method: 'resources/list' });
  assert.equal(err.status, 404);
  assert.equal(err.headers['X-Schema-Version'], '1');
});

test('#946: client-supplied X-Request-Id is echoed on MCP responses', async () => {
  const { headers } = await rpc(
    { jsonrpc: '2.0', id: 5, method: 'tools/list' },
    { 'x-request-id': 'mcp-req-abc-123' }
  );
  assert.equal(headers['X-Request-Id'], 'mcp-req-abc-123');
});

test('#946: echo also works on error responses and is CORS-exposed', async () => {
  const { headers } = await rpc(
    { jsonrpc: '2.0', id: 6, method: 'no/such/method' },
    { 'x-request-id': 'mcp-err-echo' }
  );
  assert.equal(headers['X-Request-Id'], 'mcp-err-echo');
  const expose = String(headers['Access-Control-Expose-Headers'] || '');
  const exposed = expose.split(',').map(s => s.trim());
  assert.ok(exposed.includes('X-Request-Id'), `got: ${expose}`);
  assert.ok(exposed.includes('X-Schema-Version'), `got: ${expose}`);
});

test('#946: no X-Request-Id header when the client sends none', async () => {
  const { headers } = await rpc({ jsonrpc: '2.0', id: 7, method: 'ping' });
  assert.ok(!('X-Request-Id' in headers), 'must not invent a request id');
});

test('#949: overlong ids are truncated WITH an explicit marker on /api/mcp', async () => {
  const huge = 'x'.repeat(1000);
  const { headers } = await rpc(
    { jsonrpc: '2.0', id: 8, method: 'ping' },
    { 'x-request-id': huge }
  );
  assert.equal(headers['X-Request-Id'], 'x'.repeat(200));
  assert.equal(headers['X-Request-Id-Truncated'], '1000',
    'marker must carry the ORIGINAL length so clients can detect oversized ids');
});

test('#949: no truncation marker when the id fits', async () => {
  const { headers } = await rpc(
    { jsonrpc: '2.0', id: 9, method: 'ping' },
    { 'x-request-id': 'short-id' }
  );
  assert.ok(!('X-Request-Id-Truncated' in headers));
});

// Same #949 contract on the REST catch-all transport (shared middleware).
async function rest(url, headers = {}) {
  const captured = {};
  const res = {
    statusCode: 0,
    headers: {},
    setHeader(k, v) { this.headers[k] = v; },
    getHeader(k) {
      // Case-insensitive like Node's ServerResponse.getHeader.
      const lk = String(k).toLowerCase();
      for (const [hk, hv] of Object.entries(this.headers)) {
        if (hk.toLowerCase() === lk) return hv;
      }
      return undefined;
    },
    hasHeader(k) {
      const lk = String(k).toLowerCase();
      for (const hk of Object.keys(this.headers)) {
        if (hk.toLowerCase() === lk) return true;
      }
      return false;
    },
    end(body) { captured.status = this.statusCode; captured.body = body; }
  };
  await catchAll({ url, query: {}, headers }, res);
  return { status: captured.status, headers: res.headers };
}

test('#949: REST catch-all emits the truncation marker too (shared middleware)', async () => {
  const huge = 'y'.repeat(500);
  const { headers } = await rest('/api/nope-does-not-exist', { 'x-request-id': huge });
  assert.equal(headers['X-Request-Id'], 'y'.repeat(200));
  assert.equal(headers['X-Request-Id-Truncated'], '500');
});

test('#949: REST short ids stay marker-free (no behavior change for well-formed clients)', async () => {
  const { headers } = await rest('/api/nope-does-not-exist', { 'x-request-id': 'fine' });
  assert.equal(headers['X-Request-Id'], 'fine');
  assert.ok(!('X-Request-Id-Truncated' in headers));
});
