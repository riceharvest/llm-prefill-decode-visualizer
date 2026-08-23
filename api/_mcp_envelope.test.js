// MCP tool result envelope schema test.
//
// The HTTP MCP endpoint (/api/mcp) wraps every tools/call result in a JSON-RPC
// envelope whose result must match the MCP "CallToolResult" shape:
//   result.content: non-empty array of { type: 'text', text: string }
//   result.isError: boolean
// Agents depend on this shape to decide whether a call succeeded and how to
// read the payload, so it is pinned here. Note: mcp/tools.test.js (PR #342)
// covers the stdio server's *tool registry*; this file pins the HTTP
// transport's *result envelopes* — different module, different surface.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import mcp from '../api/mcp.js';

const UPSTREAM_BODY = { ok: true, results: [{ ttftMs: 120, tpotMs: 14 }] };

/** POST one JSON-RPC message at the MCP handler with mocked res. */
async function rpc(message) {
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
  await mcp(
    { method: 'POST', url: '/api/mcp', headers: {}, body: message },
    res
  );
  return { status: captured.status, body: JSON.parse(captured.rawBody) };
}

/** Assert the JSON-RPC + CallToolResult envelope shape. */
function assertToolEnvelope(rpcBody, expectedId) {
  assert.equal(rpcBody.jsonrpc, '2.0');
  assert.equal(rpcBody.id, expectedId);
  assert.ok(rpcBody.result, 'tools/call reply must carry a result');
  const r = rpcBody.result;
  assert.ok(Array.isArray(r.content), 'result.content must be an array');
  assert.ok(r.content.length >= 1, 'result.content must be non-empty');
  for (const item of r.content) {
    assert.equal(item.type, 'text', 'every content item is a text block');
    assert.equal(typeof item.text, 'string');
    assert.ok(item.text.length > 0, 'text blocks are non-empty');
  }
  assert.equal(typeof r.isError, 'boolean', 'result.isError must be boolean');
  return r;
}

function mockUpstreamFetch(ok) {
  return async () => ({
    ok,
    status: ok ? 200 : 500,
    text: async () => JSON.stringify(structuredClone(UPSTREAM_BODY))
  });
}

test('tools/call returns a valid CallToolResult envelope on success', async t => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = mockUpstreamFetch(true);

  const { status, body } = await rpc({
    jsonrpc: '2.0', id: 7, method: 'tools/call',
    params: { name: 'compute_single_turn', arguments: {
      promptTokens: 1000, outputTokens: 500, prefillSpeed: 3000, decodeSpeed: 90
    } }
  });

  assert.equal(status, 200);
  const result = assertToolEnvelope(body, 7);
  assert.equal(result.isError, false, 'successful upstream call is not an error');
  // The single text block carries the upstream REST payload verbatim.
  assert.deepEqual(JSON.parse(result.content[0].text), UPSTREAM_BODY);
});

test('tools/call marks upstream failures with isError:true but same envelope', async t => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = mockUpstreamFetch(false);

  const { status, body } = await rpc({
    jsonrpc: '2.0', id: 'str-id-1', method: 'tools/call',
    params: { name: 'benchmarks', arguments: {} }
  });

  assert.equal(status, 200);
  const result = assertToolEnvelope(body, 'str-id-1'); // string ids echoed too
  assert.equal(result.isError, true);
});

test('unknown tool still gets a valid error envelope', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = mockUpstreamFetch(true); // must never be reached
  try {
    const { status, body } = await rpc({
      jsonrpc: '2.0', id: 3, method: 'tools/call',
      params: { name: 'definitely_not_a_tool', arguments: {} }
    });
    assert.equal(status, 200);
    const result = assertToolEnvelope(body, 3);
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /Unknown tool/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('tools/list result carries a well-formed tool array', async () => {
  const { status, body } = await rpc({ jsonrpc: '2.0', id: 9, method: 'tools/list' });
  assert.equal(status, 200);
  assert.equal(body.jsonrpc, '2.0');
  assert.equal(body.id, 9);
  const tools = body.result?.tools;
  assert.ok(Array.isArray(tools) && tools.length >= 1);
  for (const tool of tools) {
    assert.equal(typeof tool.name, 'string');
    assert.ok(tool.name.length > 0);
    assert.equal(typeof tool.description, 'string');
    assert.ok(tool.description.length > 0);
    assert.equal(tool.inputSchema?.type, 'object');
    assert.equal(typeof tool.inputSchema.properties, 'object');
  }
});

test('ping replies with an empty result under the same JSON-RPC envelope', async () => {
  const { status, body } = await rpc({ jsonrpc: '2.0', id: 11, method: 'ping' });
  assert.equal(status, 200);
  assert.equal(body.jsonrpc, '2.0');
  assert.equal(body.id, 11);
  assert.deepEqual(body.result, {});
});

test('JSON-RPC errors keep the envelope: code + message, echoed id', async () => {
  const { status, body } = await rpc({ jsonrpc: '2.0', id: 13, method: 'resources/list' });
  assert.equal(status, 404);
  assert.equal(body.jsonrpc, '2.0');
  assert.equal(body.id, 13);
  assert.equal(typeof body.error.code, 'number');
  assert.equal(typeof body.error.message, 'string');
});
