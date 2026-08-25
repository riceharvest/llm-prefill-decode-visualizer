// Rate-limit + schema-version surface for /api/mcp (#877 #880).
//
// Pins that the MCP Streamable HTTP transport no longer strips the agent
// quota signals at the proxy boundary: every response carries
// X-RateLimit-Limit/-Remaining/-Reset and X-Schema-Version, exhaustion gets
// a JSON-RPC-shaped 429 with Retry-After, and the initialize handshake
// reports the same release version as /api/version plus schema_version.
// (api/_mcp_envelope.test.js pins the CallToolResult shape; this file pins
// the transport's headers + handshake.)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Small bucket so the 429 path is drivable without hammering the handler;
// must be set before api/_ratelimit.js is first imported.
process.env.RATE_LIMIT_MAX = '3';
const { default: mcp } = await import('../api/mcp.js');
const { _resetRateLimits } = await import('../api/_ratelimit.js');

/** POST/GET/OPTIONS the MCP handler with a mocked res; capture headers+body. */
async function hit(method, message) {
  const captured = {};
  const res = {
    statusCode: 0,
    headers: {},
    setHeader(k, v) { this.headers[String(k).toLowerCase()] = v; },
    getHeader(k) { return this.headers[String(k).toLowerCase()]; },
    end(body) {
      captured.status = this.statusCode;
      captured.rawBody = body;
    }
  };
  await mcp(
    { method, url: '/api/mcp', headers: {}, body: message },
    res
  );
  return {
    status: captured.status,
    headers: res.headers,
    body: captured.rawBody ? JSON.parse(captured.rawBody) : null
  };
}

function assertRateLimitHeaders(headers) {
  assert.ok(headers['x-ratelimit-limit'], 'X-RateLimit-Limit present');
  assert.ok(headers['x-ratelimit-remaining'], 'X-RateLimit-Remaining present');
  assert.ok(headers['x-ratelimit-reset'], 'X-RateLimit-Reset present');
}

test('every JSON-RPC response carries X-RateLimit-* and X-Schema-Version', async () => {
  _resetRateLimits();
  const { headers } = await hit('POST', { jsonrpc: '2.0', id: 1, method: 'tools/list' });
  assert.equal(headers['content-type'], 'application/json');
  assertRateLimitHeaders(headers);
  assert.equal(headers['x-schema-version'], '1');
});

test('initialize handshake reports the /api/version release version + schema_version', async () => {
  _resetRateLimits();
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const { status, headers, body } = await hit('POST', {
    jsonrpc: '2.0', id: 2, method: 'initialize',
    params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } }
  });
  assert.equal(status, 200);
  // No third, hardcoded "1.0.0" (#880): matches package.json like /api/version.
  assert.equal(body.result.serverInfo.version, pkg.version || 'unknown');
  assert.notEqual(body.result.serverInfo.version, '1.0.0');
  // Wire schema signal at handshake time, before any tool call (#880).
  assert.equal(body.result.schema_version, headers['x-schema-version']);
});

test('OPTIONS preflight carries X-Schema-Version too', async () => {
  _resetRateLimits();
  const { status, headers } = await hit('OPTIONS');
  assert.equal(status, 204);
  assert.equal(headers['x-schema-version'], '1');
});

test('exhausting the bucket yields a JSON-RPC 429 with Retry-After', async () => {
  _resetRateLimits();
  let last;
  for (let i = 0; i < 4; i++) {
    last = await hit('POST', { jsonrpc: '2.0', id: i, method: 'ping' });
    if (i < 3) assert.equal(last.status, 200);
  }
  assert.equal(last.status, 429);
  assert.equal(last.body.jsonrpc, '2.0');
  assert.equal(last.body.error.code, -32000);
  assert.match(last.body.error.message, /Rate limit exceeded/);
  assert.ok(last.body.error.data.retryAfterSeconds >= 1);
  assert.equal(last.headers['x-ratelimit-remaining'], '0');
  assert.ok(last.headers['retry-after'], 'Retry-After header present');
  assertRateLimitHeaders(last.headers);
});
