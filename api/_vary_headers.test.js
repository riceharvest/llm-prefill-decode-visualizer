// Vary-header contract for the two API surfaces that bypass _markdown
// negotiation (#1015).
//
// Every other API route carries `Vary: Accept, Accept-Encoding` via
// applyMarkdownNegotiation. Two surfaces did not:
//   - /api/mcp builds its own responses in api/mcp.js and omitted Vary entirely;
//   - /api/agent/index.json is served by the static shadow file
//     public/api/agent/index.json, which never reaches the router — only a
//     vercel.json headers rule can stamp Vary there.
// Without Vary, shared caches key these routes on the URL alone and can replay
// a compressed variant to clients that cannot decompress it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import mcp from '../api/mcp.js';

const API_DIR = path.dirname(fileURLToPath(import.meta.url));

/** Invoke the MCP handler with a mocked res that records headers. */
async function mcpReq(req) {
  const res = {
    statusCode: 0,
    headers: {},
    setHeader(k, v) { this.headers[String(k).toLowerCase()] = v; },
    getHeader(k) { return this.headers[String(k).toLowerCase()]; },
    end() {}
  };
  await mcp(req, res);
  return res;
}

test('/api/mcp GET discovery carries Vary: Accept, Accept-Encoding', async () => {
  const res = await mcpReq({ method: 'GET', url: '/api/mcp', headers: {} });
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers.vary, 'Accept, Accept-Encoding');
});

test('/api/mcp POST JSON-RPC replies carry Vary', async () => {
  const res = await mcpReq({
    method: 'POST',
    url: '/api/mcp',
    headers: {},
    body: { jsonrpc: '2.0', id: 1, method: 'tools/list' }
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers.vary, 'Accept, Accept-Encoding');
});

test('/api/mcp notification 202 carries Vary', async () => {
  const res = await mcpReq({
    method: 'POST',
    url: '/api/mcp',
    headers: {},
    body: { jsonrpc: '2.0', method: 'notifications/initialized' }
  });
  assert.equal(res.statusCode, 202);
  assert.equal(res.headers.vary, 'Accept, Accept-Encoding');
});

test('vercel.json stamps Vary on the static /api/agent/index.json shadow', () => {
  const config = JSON.parse(readFileSync(path.join(API_DIR, '..', 'vercel.json'), 'utf8'));
  const varyRules = new Map(
    (config.headers || [])
      .filter(h => h.headers.some(x => x.key.toLowerCase() === 'vary'))
      .map(h => [h.source, h.headers.find(x => x.key.toLowerCase() === 'vary').value])
  );
  for (const source of ['/api/agent/index.json', '/api/agent']) {
    assert.ok(varyRules.has(source), `missing Vary rule for ${source}`);
    assert.match(varyRules.get(source), /Accept-Encoding/);
  }
});
