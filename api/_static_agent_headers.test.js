// Contract pin for issue #1053: the static public/ shadows of the agent
// entry points (/llms.txt, /agents.json, /api/agent/index.json) bypass
// api/[...path].js on Vercel, so their X-Agent-Endpoints discovery header
// must be pinned in vercel.json headers config (static files win over the
// API catch-all, so router middleware never runs for them).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(fileURLToPath(import.meta.url));
const vercel = JSON.parse(readFileSync(join(root, '..', 'vercel.json'), 'utf8'));
const router = readFileSync(join(root, '[...path].js'), 'utf8');

const AGENT_ENDPOINTS = '/api/spec, /llms.txt, /agents.json, /api/mcp, /api/agent/index.json';

const headerEntries = new Map();
for (const rule of vercel.headers || []) {
  for (const h of rule.headers || []) {
    if (h.key.toLowerCase() === 'x-agent-endpoints') headerEntries.set(rule.source, h.value);
  }
}

test('#1053 every static-shadow agent entry point carries X-Agent-Endpoints', () => {
  for (const path of ['/llms.txt', '/agents.json', '/api/agent/index.json']) {
    assert.equal(
      headerEntries.get(path), AGENT_ENDPOINTS,
      `vercel.json must pin X-Agent-Endpoints on static shadow ${path}`
    );
  }
});

test('#1053 pinned value matches the router AGENT_ENDPOINTS constant (no drift)', () => {
  const m = /const AGENT_ENDPOINTS = '([^']+)'/.exec(router);
  assert.ok(m, 'router must declare the AGENT_ENDPOINTS constant');
  for (const value of headerEntries.values()) assert.equal(value, m[1]);
});
