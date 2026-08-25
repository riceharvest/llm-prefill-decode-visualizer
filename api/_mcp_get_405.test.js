// #491 — GET /api/mcp must follow the Streamable HTTP transport contract:
// a GET either opens an SSE stream or returns 405 Method Not Allowed (with an
// Allow header). It used to answer 200 application/json with a custom info
// document, which strict MCP clients read as a malformed open-stream attempt.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import mcp from '../api/mcp.js';

function mockRes() {
  const captured = {};
  return {
    res: {
      statusCode: 0,
      headers: {},
      setHeader(k, v) { this.headers[String(k).toLowerCase()] = v; },
      getHeader(k) { return this.headers[String(k).toLowerCase()]; },
      end(body) { captured.status = this.statusCode; captured.rawBody = body; }
    },
    captured
  };
}

async function call(method, headers = {}) {
  const { res, captured } = mockRes();
  await mcp({ method, url: '/api/mcp', headers }, res);
  return { status: captured.status, rawBody: captured.rawBody, headers: res.headers };
}

test('GET /api/mcp returns 405, not 200', async () => {
  const r = await call('GET');
  assert.equal(r.status, 405);
});

test('GET /api/mcp carries the RFC 9110 Allow header naming POST and OPTIONS', async () => {
  const r = await call('GET');
  assert.match(r.headers.allow || '', /POST/);
  assert.match(r.headers.allow || '', /OPTIONS/);
});

test('GET /api/mcp is 405 even when the client asks for an SSE stream', async () => {
  const r = await call('GET', { accept: 'text/event-stream' });
  assert.equal(r.status, 405);
  assert.notEqual((r.headers['content-type'] || ''), 'text/event-stream');
});

test('405 body still points agents at the discovery surfaces', async () => {
  const r = await call('GET');
  const body = JSON.parse(r.rawBody);
  assert.equal(body.error, 'Method not allowed');
  assert.equal(body.endpoints.manifest, '/.well-known/mcp.json');
  assert.equal(body.endpoints.spec, '/api/spec');
});

test('POST JSON-RPC still works on the same endpoint (no regression)', async () => {
  const { res, captured } = mockRes();
  await mcp(
    { method: 'POST', url: '/api/mcp', headers: {}, body: { jsonrpc: '2.0', id: 1, method: 'ping' } },
    res
  );
  const body = JSON.parse(captured.rawBody);
  assert.equal(captured.status, 200);
  assert.deepEqual(body.result, {});
});
