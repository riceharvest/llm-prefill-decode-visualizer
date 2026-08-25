// #594 — agent-discovery static files (/llms.txt, /llms-full.txt,
// /agents.json, /.well-known/mcp.json) shipped with Vercel's default
// `max-age=0, must-revalidate`, so every agent run paid one revalidation
// round trip per file forever. vercel.json now gives them a modest explicit
// freshness window (5 min + SWR background refresh).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const vercelJson = JSON.parse(readFileSync(join(root, 'vercel.json'), 'utf8'));

const DISCOVERY_PATHS = ['/llms.txt', '/llms-full.txt', '/agents.json', '/.well-known/mcp.json'];
const EXPECTED = 'public, max-age=300, stale-while-revalidate=86400';

function headerRuleFor(source) {
  return (vercelJson.headers || []).find(rule => rule.source === source);
}

test('#594: every agent-discovery file has an explicit freshness window', () => {
  for (const path of DISCOVERY_PATHS) {
    const rule = headerRuleFor(path);
    assert.ok(rule, `missing vercel.json headers rule for ${path}`);
    const cc = rule.headers.find(h => h.key === 'Cache-Control');
    assert.equal(cc.value, EXPECTED, `${path} Cache-Control should be "${EXPECTED}"`);
  }
});

test('#594: the discovery files actually exist in public/ so the rules apply', () => {
  for (const path of DISCOVERY_PATHS) {
    assert.ok(existsSync(join(root, 'public', path)), `public${path} missing`);
  }
});

test('#594: rewrites and crons are untouched by the headers block', () => {
  assert.ok(Array.isArray(vercelJson.rewrites) && vercelJson.rewrites.length >= 10);
  assert.deepEqual(vercelJson.crons.map(c => c.path), ['/api/watch/dispatch']);
});
