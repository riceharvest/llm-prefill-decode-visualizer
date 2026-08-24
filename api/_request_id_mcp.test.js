// Issue #946: /api/mcp is its own serverless function in production, so the
// catch-all's X-Request-Id echo never runs for it. The MCP handler must apply
// the identical correlation contract on every response path (OPTIONS, GET,
// JSON-RPC success, and errors).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import mcp from '../api/mcp.js';

function mockRes() {
  return {
    statusCode: 0,
    headers: {},
    setHeader(k, v) { this.headers[k] = v; },
    getHeader(k) { return this.headers[String(k).toLowerCase()]; },
    hasHeader(k) { return String(k).toLowerCase() in this.headers; },
    end(body) { this.body = body; }
  };
}

async function callMcp({ method = 'GET', headers = {}, body } = {}) {
  const res = mockRes();
  await mcp(
    body !== undefined
      ? { method, url: '/api/mcp', headers, body }
      : { method, url: '/api/mcp', headers },
    res
  );
  return res;
}

test('POST initialize echoes X-Request-Id on /api/mcp', async () => {
  const res = await callMcp({
    method: 'POST',
    headers: { 'x-request-id': 'mcp-init-corr' },
    body: { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['X-Request-Id'], 'mcp-init-corr');
});

test('GET discovery echoes X-Request-Id on /api/mcp', async () => {
  const res = await callMcp({ method: 'GET', headers: { 'x-request-id': 'mcp-get-corr' } });
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['X-Request-Id'], 'mcp-get-corr');
});

test('404 unknown-method JSON-RPC error still echoes X-Request-Id', async () => {
  const res = await callMcp({
    method: 'POST',
    headers: { 'x-request-id': 'mcp-err-corr' },
    body: { jsonrpc: '2.0', id: 2, method: 'no/such/method' }
  });
  assert.equal(res.statusCode, 404);
  assert.equal(res.headers['X-Request-Id'], 'mcp-err-corr');
});

test('OPTIONS preflight echoes X-Request-Id on /api/mcp', async () => {
  const res = await callMcp({ method: 'OPTIONS', headers: { 'x-request-id': 'mcp-preflight' } });
  assert.equal(res.statusCode, 204);
  assert.equal(res.headers['X-Request-Id'], 'mcp-preflight');
});

test('no X-Request-Id is invented when the client sends none', async () => {
  const res = await callMcp({ method: 'GET', headers: {} });
  assert.ok(!('X-Request-Id' in res.headers));
});
