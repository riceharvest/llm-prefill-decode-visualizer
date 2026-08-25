// Static /api/agent/capabilities.json parity guard (#417).
//
// The dynamic route exists in api/[...path].js (case '/agent/capabilities.json')
// but every /api/agent/* path except index.json 404s in production, so agents
// that follow the references from /agents.json and /api/spec hit a dead end.
// Fix: ship the capability document as a static file at
// public/api/agent/capabilities.json (the same mechanism that keeps
// /api/agent/index.json live), with this test pinning it to the handler so
// the two can never drift.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { default as capabilitiesHandler } from './_handlers/capabilities.js';
import { withSchemaVersion } from './_schema.js';

const root = dirname(fileURLToPath(import.meta.url));
const STATIC_PATH = join(root, '..', 'public', 'api', 'agent', 'capabilities.json');

function renderHandlerBody() {
  let payload = null;
  const res = {
    headers: new Map(),
    setHeader(k, v) { this.headers.set(k, v); },
    getHeader(k) { return this.headers.get(k); },
    end(body) { payload = body; }
  };
  capabilitiesHandler({ method: 'GET' }, res);
  return payload;
}

test('static public/api/agent/capabilities.json exists (prod 404 workaround)', () => {
  const raw = readFileSync(STATIC_PATH, 'utf8');
  assert.ok(raw.length > 500, 'capabilities document should be non-trivial');
});

test('static capabilities.json is byte-identical to the handler response', () => {
  const staticRaw = readFileSync(STATIC_PATH, 'utf8').trimEnd();
  const expected = JSON.stringify(withSchemaVersion(JSON.parse(renderHandlerBody())), null, 2);
  assert.equal(staticRaw, expected, 'regenerate public/api/agent/capabilities.json after changing the handler');
});

test('capabilities document self-references its own now-live URL and counts surfaces consistently', () => {
  const doc = JSON.parse(readFileSync(STATIC_PATH, 'utf8'));
  assert.equal(doc.ok, true);
  const self = doc.surfaces.find(s => s.path === '/api/agent/capabilities.json');
  assert.ok(self, 'document must list itself as a surface');
  assert.equal(doc.surfaceCount, doc.surfaces.length);
});
