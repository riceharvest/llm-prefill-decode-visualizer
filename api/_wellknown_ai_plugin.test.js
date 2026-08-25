// #683 — /.well-known/ai-plugin.json must exist as a valid AI-plugin manifest
// pointing agents at the real discovery surfaces (OpenAPI spec, llms.txt),
// mirroring the /.well-known/mcp.json pattern.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function loadJson(rel) {
  return JSON.parse(readFileSync(path.join(repoRoot, rel), 'utf8'));
}

const BASE = 'https://llm-prefill-decode-visualizer.vercel.app';

test('#683 manifest exists at public/.well-known/ai-plugin.json and parses', () => {
  const manifest = loadJson('public/.well-known/ai-plugin.json');
  assert.equal(typeof manifest, 'object');
  assert.ok(manifest && !Array.isArray(manifest));
});

test('#683 manifest carries the required plugin-manifest fields with sane values', () => {
  const m = loadJson('public/.well-known/ai-plugin.json');
  assert.equal(m.schema_version, 'v1');
  assert.equal(m.auth?.type, 'none');
  assert.equal(m.api?.type, 'openapi');
  // api.url must point at the live OpenAPI spec
  assert.equal(m.api?.url, `${BASE}/api/spec`);
  // logo must be an absolute URL to a shipped asset
  assert.equal(m.logo_url, `${BASE}/favicon.svg`);
  assert.equal(typeof m.name_for_model, 'string');
  assert.ok(m.name_for_model.length > 0);
  assert.equal(typeof m.description_for_model, 'string');
  assert.ok(m.description_for_model.length > 0);
});

test('#683 manifest is consistent with the sibling .well-known/mcp.json surface', () => {
  const ai = loadJson('public/.well-known/ai-plugin.json');
  const mcp = loadJson('public/.well-known/mcp.json').mcp;
  // Same product name and site URL across both well-known manifests
  assert.equal(ai.name_for_human, mcp.server.title);
  assert.equal(ai.api.url.replace(/\/api\/spec$/, '/'), `${mcp.server.websiteUrl}`);
});

test('#683 vercel.json rewrites the extensionless /.well-known/ai-plugin probe path', () => {
  const cfg = loadJson('vercel.json');
  const hit = (cfg.rewrites || []).find(
    (r) => r.source === '/.well-known/ai-plugin' && r.destination === '/.well-known/ai-plugin.json'
  );
  assert.ok(hit, 'expected a rewrite for /.well-known/ai-plugin -> /.well-known/ai-plugin.json');
});
