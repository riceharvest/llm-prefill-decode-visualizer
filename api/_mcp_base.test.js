import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveBase } from './mcp.js';

// Issue #833: the MCP tools/call proxy hardcoded the production BASE, so
// self-hosted deployments proxied every call back to vercel.app.

const PROD = 'https://llm-prefill-decode-visualizer.vercel.app';

test('request Host is used as base so self-hosts serve their own data', () => {
  assert.equal(resolveBase({ headers: { host: 'localhost:3000' } }, {}), 'http://localhost:3000');
  assert.equal(resolveBase({ headers: { host: '127.0.0.1:8787' } }, {}), 'http://127.0.0.1:8787');
  assert.equal(resolveBase({ headers: { host: 'api.my-selfhost.example' } }, {}), 'https://api.my-selfhost.example');
});

test('x-forwarded-proto wins over scheme guessing', () => {
  assert.equal(
    resolveBase({ headers: { host: 'internal:8080', 'x-forwarded-proto': 'http' } }, {}),
    'http://internal:8080'
  );
});

test('env override (MCP_BASE_URL / VISUALIZER_API_URL like the stdio server)', () => {
  assert.equal(resolveBase(null, { MCP_BASE_URL: 'http://10.0.0.5:3000/' }), 'http://10.0.0.5:3000');
  assert.equal(resolveBase({ headers: { host: 'localhost' } }, { VISUALIZER_API_URL: 'https://mine.example' }), 'https://mine.example');
});

test('production fallback unchanged when nothing overrides', () => {
  assert.equal(resolveBase(null, {}), PROD);
});
