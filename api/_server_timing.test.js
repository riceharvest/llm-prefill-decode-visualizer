// Issues #914 + #916 — in-band response telemetry on every /api/* reply:
//   - Server-Timing: app;dur=<ms> stamped just before the response ends
//   - Vary: Origin merged into every response (anonymous-only CORS contract)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyServerTiming, applyVaryOrigin } from '../api/_server_timing.js';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

function mockRes() {
  const headers = {};
  let ended = false;
  return {
    headers,
    statusCode: 200,
    setHeader(k, v) { headers[String(k).toLowerCase()] = v; },
    getHeader(k) { return headers[String(k).toLowerCase()]; },
    hasHeader(k) { return String(k).toLowerCase() in headers; },
    end(...args) {
      ended = true;
      if (this._origEnd) this._origEnd(...args);
      return this;
    },
    get _ended() { return ended; }
  };
}

test('applyServerTiming stamps app;dur and fires exactly once at end', async () => {
  const res = mockRes();
  const wired = applyServerTiming(res);
  assert.equal(wired, res, 'returns the same response for chaining');
  assert.equal(res.getHeader('Server-Timing'), undefined, 'nothing stamped before end');
  res.end();
  assert.ok(res._ended, 'response still ends');
  assert.match(String(res.getHeader('Server-Timing')), /^app;dur=\d+$/, 'Server-Timing: app;dur=<ms>');
  // Idempotent: a second wire call must not stack wrappers or change the value.
  const first = res.getHeader('Server-Timing');
  applyServerTiming(res);
  res.end();
  assert.equal(res.getHeader('Server-Timing'), first);
});

test('applyServerTiming never overrides an existing Server-Timing header', () => {
  const res = mockRes();
  res.setHeader('Server-Timing', 'cdn;dur=5');
  applyServerTiming(res).end();
  assert.equal(res.getHeader('Server-Timing'), 'cdn;dur=5');
});

test('applyVaryOrigin merges without duplicating Origin', () => {
  const a = mockRes();
  applyVaryOrigin(a);
  assert.equal(a.getHeader('Vary'), 'Origin');

  const b = mockRes();
  b.setHeader('Vary', 'Accept-Encoding');
  applyVaryOrigin(b);
  assert.equal(b.getHeader('Vary'), 'Accept-Encoding, Origin');

  const c = mockRes();
  c.setHeader('Vary', 'origin, Accept');
  applyVaryOrigin(c);
  assert.equal(c.getHeader('Vary'), 'origin, Accept', 'no duplicate when Origin already present');
});

test('dispatcher wires telemetry for every /api/* response (source contract)', () => {
  const dispatcher = readFileSync(join(HERE, '[...path].js'), 'utf8');
  assert.ok(dispatcher.includes("from './_server_timing.js'"), 'dispatcher imports the shared module');
  assert.match(dispatcher, /applyServerTiming\(res\);/, 'dispatcher calls applyServerTiming before dispatching');
});

test('mcp.js wires telemetry too (it wins file-routing over the catch-all)', () => {
  const mcp = readFileSync(join(HERE, 'mcp.js'), 'utf8');
  assert.match(mcp, /applyServerTiming\(res\);/, 'mcp handler calls applyServerTiming');
});
