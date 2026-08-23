// Request-id echo contract: the catch-all API function echoes a
// client-supplied X-Request-Id header back on every response (and exposes it
// to browser fetch() consumers via Access-Control-Expose-Headers). When the
// client sends no request id, none is invented.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import handler from '../api/[...path].js';

async function callHandler(url, headers = {}) {
  const captured = {};
  const res = {
    statusCode: 0,
    headers: {},
    setHeader(k, v) { this.headers[k] = v; },
    getHeader(k) { return this.headers[String(k).toLowerCase()]; },
    end(body) {
      captured.status = this.statusCode;
      captured.body = body;
    }
  };
  await handler({ url, query: {}, headers }, res);
  return { status: captured.status, headers: res.headers, body: captured.body };
}

test('echoes an incoming x-request-id back on the response', async () => {
  const { headers } = await callHandler('/api/nope-does-not-exist', {
    'x-request-id': 'agent-req-abc-123'
  });
  assert.equal(headers['X-Request-Id'], 'agent-req-abc-123');
});

test('echoed request id is exposed to browser fetch() consumers', async () => {
  const { headers } = await callHandler('/api/nope-does-not-exist', {
    'x-request-id': 'cors-check-1'
  });
  const expose = String(headers['Access-Control-Expose-Headers'] || '');
  assert.ok(expose.split(',').map(s => s.trim()).includes('X-Request-Id'),
    `expected X-Request-Id in Access-Control-Expose-Headers, got: ${expose}`);
});

test('echo works on a successful endpoint too, not just errors', async () => {
  const { status, headers, body } = await callHandler('/api/health', {
    'x-request-id': 'healthy-42'
  });
  assert.equal(status, 200);
  assert.equal(headers['X-Request-Id'], 'healthy-42');
  assert.equal(JSON.parse(body).ok, true);
});

test('no X-Request-Id is set when the client sends none', async () => {
  const { headers } = await callHandler('/api/nope-does-not-exist', {});
  assert.ok(!('X-Request-Id' in headers), 'must not invent a request id');
});

test('overlong request ids are truncated defensively', async () => {
  const huge = 'x'.repeat(1000);
  const { headers } = await callHandler('/api/nope-does-not-exist', {
    'x-request-id': huge
  });
  assert.equal(headers['X-Request-Id'], 'x'.repeat(200));
});
