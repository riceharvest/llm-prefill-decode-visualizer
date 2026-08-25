// MCP resources surface test (#794).
//
// /.well-known/mcp.json advertises two MCP resources (llms.txt + /api/spec);
// the HTTP MCP server must actually serve them via resources/list and
// resources/read — previously both returned -32601 method-not-found, so
// capability-driven clients that trusted the manifest hit a dead end.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import mcp, { resolveResource } from '../api/mcp.js';

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

test('initialize declares a resources capability', async () => {
  const { body } = await rpc({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
  assert.equal(body.result.capabilities.tools !== undefined, true);
  assert.ok(body.result.capabilities.resources, 'manifest-advertised resources must be declared as a capability');
});

test('resources/list returns the two manifest-advertised documents', async () => {
  const { status, body } = await rpc({ jsonrpc: '2.0', id: 2, method: 'resources/list' });
  assert.equal(status, 200);
  const resources = body.result.resources;
  assert.equal(resources.length, 2);
  const uris = resources.map(r => r.uri);
  assert.ok(uris.some(u => u.endsWith('/llms.txt')), 'agent guidance resource listed');
  assert.ok(uris.some(u => u.endsWith('/api/spec')), 'OpenAPI spec resource listed');
  for (const r of resources) {
    for (const field of ['uri', 'name', 'description', 'mimeType']) {
      assert.equal(typeof r[field], 'string', `resource.${field} is a string`);
    }
  }
});

test('resources/read serves llms.txt text via the mocked upstream fetch', async t => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  let fetchedUrl;
  globalThis.fetch = async (url) => {
    fetchedUrl = url;
    return { ok: true, status: 200, text: async () => '# LLM guidance\nGET /api/compute …' };
  };

  const { body } = await rpc({
    jsonrpc: '2.0', id: 3, method: 'resources/read',
    params: { uri: 'https://llm-prefill-decode-visualizer.vercel.app/llms.txt' }
  });
  assert.equal(fetchedUrl.endsWith('/llms.txt'), true);
  const contents = body.result.contents;
  assert.equal(contents.length, 1);
  assert.equal(contents[0].mimeType, 'text/plain');
  assert.ok(contents[0].text.includes('# LLM guidance'), 'resource body is carried verbatim');
});

test('resources/read accepts bare-path spellings and rejects unknown uris', async t => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async () => ({ ok: true, status: 200, text: async () => '{}' });

  const ok = await rpc({ jsonrpc: '2.0', id: 4, method: 'resources/read', params: { uri: '/api/spec' } });
  assert.equal(ok.body.result.contents[0].mimeType, 'application/json');

  const bad = await rpc({ jsonrpc: '2.0', id: 5, method: 'resources/read', params: { uri: '/api/nope' } });
  assert.equal(bad.body.error.code, -32602);
});

test('resolveResource matches absolute and bare-path uris only', () => {
  assert.ok(resolveResource('https://llm-prefill-decode-visualizer.vercel.app/api/spec'));
  assert.ok(resolveResource('/llms.txt'));
  assert.equal(resolveResource('https://evil.example/api/spec'), undefined);
});
