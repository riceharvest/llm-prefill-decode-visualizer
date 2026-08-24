// Version-identity contract across transports (#880):
//   - the MCP `initialize` handshake reports the SAME release version as
//     /api/spec info.version (single source api/_version.js),
//   - the handshake carries a wire-contract schemaVersion,
//   - every /api/mcp response stamps X-Schema-Version.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import mcp from '../api/mcp.js';
import spec from '../api/_handlers/spec.js';

function mockRes() {
  return {
    statusCode: 200,
    headers: {},
    body: undefined,
    setHeader(k, v) { this.headers[String(k).toLowerCase()] = v; },
    getHeader(k) { return this.headers[String(k).toLowerCase()]; },
    hasHeader(k) { return String(k).toLowerCase() in this.headers; },
    end(payload) { if (payload !== undefined) this.body = payload; }
  };
}

async function callMcp(method, { httpMethod = 'POST', body } = {}) {
  const res = mockRes();
  const req = {
    method: httpMethod,
    url: '/api/mcp',
    headers: httpMethod === 'POST' ? { 'content-type': 'application/json' } : {},
    ...(body !== undefined ? { body } : {})
  };
  await mcp(req, res);
  return { status: res.statusCode, headers: res.headers, json: () => JSON.parse(res.body) };
}

const INIT = {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'p', version: '1' } }
};

test('MCP serverInfo.version matches /api/spec info.version', async () => {
  const init = await callMcp('initialize', { body: INIT });
  assert.equal(init.status, 200);

  const specRes = mockRes();
  await spec({ method: 'GET', url: '/api/spec', headers: {} }, specRes);
  const specBody = JSON.parse(specRes.body);

  assert.equal(init.json().result.serverInfo.version, specBody.info.version);
});

test('MCP handshake carries the wire contract schemaVersion', async () => {
  const init = await callMcp('initialize', { body: INIT });
  const result = init.json().result;
  assert.equal(result.schemaVersion, '1');
  // Distinct version spaces must not be conflated:
  assert.notEqual(result.protocolVersion, result.schemaVersion);
});

test('every /api/mcp response stamps X-Schema-Version', async () => {
  for (const variant of [
    callMcp(null, { httpMethod: 'GET' }),
    callMcp('tools/list', { body: { jsonrpc: '2.0', id: 2, method: 'tools/list' } }),
    callMcp(null, { httpMethod: 'OPTIONS' })
  ]) {
    const { headers } = await variant;
    assert.equal(headers['x-schema-version'], '1');
    const expose = String(headers['access-control-expose-headers'] || '');
    assert.ok(
      expose.split(',').map(s => s.trim()).includes('X-Schema-Version'),
      `expected X-Schema-Version exposed, got: ${expose}`
    );
  }
});
