/**
 * CORS preflight + expose-headers regression tests for /api/mcp (#750).
 *
 * Browser-hosted MCP clients die at preflight unless every non-simple
 * request header the Streamable HTTP spec requires is allowlisted, and
 * they cannot read session/rate-limit response headers unless those are
 * exposed.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import handler from '../api/mcp.js';

const ALLOWED_HEADERS =
  'Content-Type, Accept, Mcp-Session-Id, Mcp-Protocol-Version, Authorization, Last-Event-ID';
const EXPOSED_HEADERS =
  'Mcp-Session-Id, X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset';

function mockRes() {
  const headers = {};
  return {
    headers,
    statusCode: 200,
    ended: false,
    setHeader(name, value) {
      headers[name.toLowerCase()] = value;
    },
    end() {
      this.ended = true;
    }
  };
}

test('OPTIONS /api/mcp allowlists spec-required request headers', () => {
  const res = mockRes();
  handler({ method: 'OPTIONS' }, res);
  assert.equal(res.statusCode, 204);
  assert.equal(res.headers['access-control-allow-origin'], '*');
  assert.equal(res.headers['access-control-allow-methods'], 'POST, GET, OPTIONS');
  for (const header of ALLOWED_HEADERS.split(', ').map((h) => h.toLowerCase())) {
    assert.ok(
      res.headers['access-control-allow-headers']
        .toLowerCase()
        .split(', ')
        .includes(header),
      `preflight must allow ${header}`
    );
  }
});

for (const required of ['mcp-protocol-version', 'authorization', 'last-event-id']) {
  test(`preflight allows ${required}`, () => {
    const res = mockRes();
    handler({ method: 'OPTIONS' }, res);
    assert.ok(
      res.headers['access-control-allow-headers']
        .toLowerCase()
        .includes(required),
      `Access-Control-Allow-Headers must include ${required} (#750)`
    );
  });
}

test('preflight exposes session and rate-limit response headers', () => {
  const res = mockRes();
  handler({ method: 'OPTIONS' }, res);
  assert.equal(res.headers['access-control-expose-headers'], EXPOSED_HEADERS);
});

test('JSON responses also expose session/rate-limit headers', async () => {
  const res = mockRes();
  await handler({ method: 'GET' }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['access-control-expose-headers'], EXPOSED_HEADERS);
});
