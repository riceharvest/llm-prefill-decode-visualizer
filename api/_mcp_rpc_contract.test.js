// MCP JSON-RPC transport contract (#870) + engine_flags schema surface (#872).
//
// #870: per the MCP Streamable HTTP transport, HTTP 4xx/5xx is reserved for
// TRANSPORT failures — JSON-RPC application errors (-32601 method not found,
// -32600 invalid request) must ride in an HTTP 200 body, or official SDK
// clients discard the body as a fatal transport error. Messages WITHOUT an id
// are notifications: execute nothing, reply 202 with no body.
//
// #872: the engine_flags tool's inputSchema must declare promptTokens /
// outputTokens (REST model=flagged accepts them) and must not mark
// prefillSpeed / decodeSpeed required (REST defaults them to 3800 / 105).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import mcp from '../api/mcp.js';

/** POST one JSON-RPC message at the MCP handler with mocked req/res. */
async function rpc(message) {
  const captured = {};
  const res = {
    statusCode: 0,
    headers: {},
    setHeader(k, v) { this.headers[k] = v; },
    end(body) {
      captured.status = this.statusCode;
      captured.rawBody = body;
    }
  };
  await mcp({ method: 'POST', url: '/api/mcp', headers: {}, body: message }, res);
  return { status: captured.status, rawBody: captured.rawBody };
}

test('#870: -32601 method-not-found rides in HTTP 200, not 404', async () => {
  const { status, rawBody } = await rpc({ jsonrpc: '2.0', id: 1, method: 'resources/list' });
  assert.equal(status, 200);
  const body = JSON.parse(rawBody);
  assert.equal(body.jsonrpc, '2.0');
  assert.equal(body.id, 1);
  assert.equal(body.error.code, -32601);
  assert.match(body.error.message, /resources\/list|Method not found/);
});

test('#870: notification (no id) executes nothing and is answered 202 with no body', async () => {
  // A tools/call without an id is a notification — it must NOT be executed.
  const res = await rpc({ jsonrpc: '2.0', method: 'tools/call', params: { name: 'hardware_presets', arguments: {} } });
  assert.equal(res.status, 202);
  assert.equal(res.rawBody, undefined);
});

test('#870: notifications/initialized still gets 202 with no body', async () => {
  const res = await rpc({ jsonrpc: '2.0', method: 'notifications/initialized' });
  assert.equal(res.status, 202);
  assert.equal(res.rawBody, undefined);
});

test('#870: batch array body is cleanly rejected with -32600 in HTTP 200', async () => {
  const { status, rawBody } = await rpc([{ jsonrpc: '2.0', id: 1, method: 'tools/list' }]);
  assert.equal(status, 200);
  const body = JSON.parse(rawBody);
  assert.equal(body.error.code, -32600);
  assert.match(body.error.message, /batch arrays are not supported/i);
});

test('#870: valid requests still work after the notification gate', async () => {
  const { status, rawBody } = await rpc({ jsonrpc: '2.0', id: 7, method: 'ping' });
  assert.equal(status, 200);
  const body = JSON.parse(rawBody);
  assert.equal(body.id, 7);
  assert.deepEqual(body.result, {});
});

test('#872: engine_flags schema declares promptTokens/outputTokens and drops speed requirements', () => {
  let captured;
  const res = {
    statusCode: 0,
    headers: {},
    setHeader(k, v) { this.headers[k] = v; },
    end(body) {
      captured = { status: this.statusCode, body: JSON.parse(body) };
    }
  };
  return mcp({ method: 'POST', url: '/api/mcp', headers: {}, body: { jsonrpc: '2.0', id: 9, method: 'tools/list' } }, res)
    .then(() => {
      assert.equal(captured.status, 200);
      const tool = captured.body.result.tools.find(t => t.name === 'engine_flags');
      assert.ok(tool, 'engine_flags tool must be listed');
      const props = tool.inputSchema.properties;
      assert.equal(props.promptTokens.type, 'number', '#872: promptTokens declared');
      assert.equal(props.outputTokens.type, 'number', '#872: outputTokens declared');
      assert.deepEqual(tool.inputSchema.required, ['flags'],
        '#872: prefillSpeed/decodeSpeed are optional like REST defaults');
      // flags still flows through toolToRequest unchanged
      assert.equal(props.flags.type, 'string');
    });
});
