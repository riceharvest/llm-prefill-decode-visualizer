// Request-id echo contract (#946 #949): BOTH api/[...path].js (REST catch-all)
// and api/mcp.js (which wins Vercel file-routing for /api/mcp) echo a
// client-supplied X-Request-Id header back on every response and expose it to
// browser fetch() consumers via Access-Control-Expose-Headers. When the client
// sends no request id, none is invented. Overlong ids are still bounded at 200
// chars, but the amputation is signalled via X-Request-Id-Truncated (#949).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import handler from '../api/[...path].js';
import mcpHandler from '../api/mcp.js';

// Minimal ServerResponse stand-in. Header keys are stored lower-cased like
// node:http does, so middleware chains that read back what they set behave
// the same as in production.
function mockRes(captured) {
  return {
    statusCode: 0,
    headers: {},
    setHeader(k, v) { this.headers[String(k).toLowerCase()] = v; },
    getHeader(k) { return this.headers[String(k).toLowerCase()]; },
    hasHeader(k) { return String(k).toLowerCase() in this.headers; },
    end(body) {
      captured.status = this.statusCode;
      captured.body = body;
    }
  };
}

async function callHandler(handlerFn, url, { method = 'GET', headers = {}, body } = {}) {
  const captured = {};
  const res = mockRes(captured);
  await handlerFn({ url, query: {}, method, headers, body }, res);
  return { status: captured.status, headers: res.headers, body: captured.body };
}

test('echoes an incoming x-request-id back on the response', async () => {
  const { headers } = await callHandler(handler, '/api/nope-does-not-exist', {
    headers: { 'x-request-id': 'agent-req-abc-123' }
  });
  assert.equal(headers['x-request-id'], 'agent-req-abc-123');
});

test('echoed request id is exposed to browser fetch() consumers', async () => {
  const { headers } = await callHandler(handler, '/api/nope-does-not-exist', {
    headers: { 'x-request-id': 'cors-check-1' }
  });
  const expose = String(headers['access-control-expose-headers'] || '');
  assert.ok(expose.split(',').map(s => s.trim()).includes('X-Request-Id'),
    `expected X-Request-Id in Access-Control-Expose-Headers, got: ${expose}`);
});

test('echo works on a successful endpoint too, not just errors', async () => {
  const { status, headers, body } = await callHandler(handler, '/api/health', {
    headers: { 'x-request-id': 'healthy-42' }
  });
  assert.equal(status, 200);
  assert.equal(headers['x-request-id'], 'healthy-42');
  assert.equal(JSON.parse(body).ok, true);
});

test('no X-Request-Id is set when the client sends none', async () => {
  const { headers } = await callHandler(handler, '/api/nope-does-not-exist');
  assert.ok(!('x-request-id' in headers), 'must not invent a request id');
});

test('overlong request ids are truncated defensively', async () => {
  const huge = 'x'.repeat(1000);
  const { headers } = await callHandler(handler, '/api/nope-does-not-exist', {
    headers: { 'x-request-id': huge }
  });
  assert.equal(headers['x-request-id'], 'x'.repeat(200));
});

// ---- #946: the MCP transport must echo too (api/mcp.js wins file-routing
// over the catch-all for /api/mcp, so it applies the shared middleware).

async function callMcp(method, { headers = {}, body } = {}) {
  const captured = {};
  const res = mockRes(captured);
  await mcpHandler({ method, headers, body }, res);
  return { status: captured.status, headers: res.headers, body: captured.body };
}

test('#946: POST initialize on /api/mcp echoes x-request-id', async () => {
  const { status, headers } = await callMcp('POST', {
    headers: { 'content-type': 'application/json', 'x-request-id': 'mcp-init-corr' },
    body: { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }
  });
  assert.equal(status, 200);
  assert.equal(headers['x-request-id'], 'mcp-init-corr');
});

test('#946: GET discovery on /api/mcp echoes x-request-id', async () => {
  const { headers } = await callMcp('GET', { headers: { 'x-request-id': 'mcp-get-corr' } });
  assert.equal(headers['x-request-id'], 'mcp-get-corr');
});

test('#946: OPTIONS preflight on /api/mcp echoes x-request-id', async () => {
  const { headers } = await callMcp('OPTIONS', { headers: { 'x-request-id': 'mcp-preflight' } });
  assert.equal(headers['x-request-id'], 'mcp-preflight');
});

test('#946: unknown JSON-RPC method (404) on /api/mcp echoes too', async () => {
  const { status, headers } = await callMcp('POST', {
    headers: { 'content-type': 'application/json', 'x-request-id': 'mcp-404-corr' },
    body: { jsonrpc: '2.0', id: 2, method: 'no/such/method' }
  });
  assert.equal(status, 404);
  assert.equal(headers['x-request-id'], 'mcp-404-corr');
});

test('#946: no X-Request-Id on /api/mcp when the client sends none', async () => {
  const { headers } = await callMcp('GET');
  assert.ok(!('x-request-id' in headers), 'must not invent a request id');
});

// ---- #949: truncation is observable; duplicates/whitespace resolve deterministically.

test('#949: overlong ids set X-Request-Id-Truncated: true', async () => {
  const { headers } = await callHandler(handler, '/api/nope-does-not-exist', {
    headers: { 'x-request-id': 'x'.repeat(250) }
  });
  assert.equal(headers['x-request-id'], 'x'.repeat(200));
  assert.equal(headers['x-request-id-truncated'], 'true');
});

test('#949: overlong ids are marked observable on /api/mcp too', async () => {
  const { headers } = await callMcp('GET', { headers: { 'x-request-id': 'y'.repeat(300) } });
  assert.equal(headers['x-request-id'], 'y'.repeat(200));
  assert.equal(headers['x-request-id-truncated'], 'true');
});

test('#949: ids within the cap carry no truncation marker', async () => {
  const { headers } = await callHandler(handler, '/api/nope-does-not-exist', {
    headers: { 'x-request-id': 'a'.repeat(200) }
  });
  assert.ok(!('x-request-id-truncated' in headers));
});

test('#949: duplicate headers resolve to the first value', async () => {
  const { headers } = await callHandler(handler, '/api/nope-does-not-exist', {
    headers: { 'x-request-id': 'first, second' }
  });
  assert.equal(headers['x-request-id'], 'first');
});

test('#949: whitespace padding is trimmed', async () => {
  const { headers } = await callHandler(handler, '/api/nope-does-not-exist', {
    headers: { 'x-request-id': '  padded id  ' }
  });
  assert.equal(headers['x-request-id'], 'padded id');
});
