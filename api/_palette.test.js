// Issue #924 — machine-readable palette: public/palette.json must stay in
// lockstep with the :root tokens in src/index.css, so a stale manifest fails CI.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const css = () => readFileSync(join(ROOT, 'src', 'index.css'), 'utf8');
const palette = () => JSON.parse(readFileSync(join(ROOT, 'public', 'palette.json'), 'utf8'));

function rootTokenValues() {
  const cssText = css();
  const start = cssText.indexOf(':root {');
  const end = cssText.indexOf('}', start);
  const block = cssText.slice(start, end);
  const tokens = {};
  for (const m of block.matchAll(/(--[a-z0-9-]+):\s*(#[0-9A-Fa-f]{6})\s*;/g)) {
    tokens[m[1]] = m[2];
  }
  return tokens;
}

test('palette.json declares the core semantic tokens with values matching index.css', () => {
  const p = palette();
  const tokens = rootTokenValues();
  const required = ['--bg-app', '--text-main', '--accent', '--prefill', '--decode', '--agent', '--danger', '--warn'];
  for (const key of required) {
    assert.ok(p.colors[key], `palette.json missing ${key}`);
    assert.equal(p.colors[key], tokens[key], `${key} drifted between palette.json (${p.colors[key]}) and index.css (${tokens[key]})`);
  }
});

test('every palette.json color exists as a token in index.css', () => {
  const tokens = rootTokenValues();
  for (const [key, value] of Object.entries(palette().colors)) {
    assert.ok(tokens[key], `palette.json lists unknown token ${key}`);
    assert.equal(value.toUpperCase(), (tokens[key] || '').toUpperCase(), `${key} value drift`);
  }
});

test('roles map to declared tokens and the og divergence is documented, not hidden', () => {
  const p = palette();
  const declared = new Set(Object.keys(p.colors));
  for (const [role, token] of Object.entries(p.roles)) {
    assert.ok(declared.has(token), `role ${role} maps to undeclared token ${token}`);
  }
  assert.match(String(p.ogCardNote), /og/i, 'og card palette mismatch must stay documented');
});
