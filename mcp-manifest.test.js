// Parity test for the MCP discovery surfaces (#848).
//
// The site self-describes twice: the static manifest at
// /.well-known/mcp.json and the live `initialize` + `tools/list` on
// /api/mcp. Both are generated from api/mcp.js (TOOLS, SERVER_INFO,
// INSTRUCTIONS) — this test asserts they actually agree, so a hand-edit of
// mcp.json or a live-only change fails CI instead of shipping drift.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { TOOLS, SERVER_INFO, INSTRUCTIONS } from './api/mcp.js';

const root = dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(
  readFileSync(join(root, 'public', '.well-known', 'mcp.json'), 'utf8')
).mcp;

test('manifest server block matches live initialize serverInfo', () => {
  assert.equal(manifest.server.name, SERVER_INFO.name);
  assert.equal(manifest.server.title, SERVER_INFO.title);
});

test('manifest instructions match live initialize instructions', () => {
  assert.equal(manifest.server.instructions, INSTRUCTIONS);
});

test('manifest lists exactly the live tools, in order', () => {
  assert.deepEqual(
    manifest.tools.map(t => t.name),
    TOOLS.map(t => t.name)
  );
});

test('every tool description matches tools/list byte-for-byte', () => {
  for (const live of TOOLS) {
    const entry = manifest.tools.find(t => t.name === live.name);
    assert.ok(entry, `manifest missing tool: ${live.name}`);
    assert.equal(entry.description, live.description, `description drift on ${live.name}`);
  }
});

test('every tool inputSchema deep-equals tools/list', () => {
  for (const live of TOOLS) {
    const entry = manifest.tools.find(t => t.name === live.name);
    assert.deepEqual(entry.inputSchema, live.inputSchema, `inputSchema drift on ${live.name}`);
  }
});

test('manifest endpoint hints map to real tool routes', () => {
  for (const entry of manifest.tools) {
    if (!entry.endpoint) continue;
    const [path] = entry.endpoint.split('?');
    assert.match(path, /^\/api\//, `${entry.name}: endpoint must be an /api/ route`);
  }
});
