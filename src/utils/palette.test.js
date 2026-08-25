import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { PALETTE, PALETTE_ROLES } from './palette.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const css = readFileSync(join(ROOT, 'src', 'index.css'), 'utf8');
const paletteJson = JSON.parse(readFileSync(join(ROOT, 'public', 'palette.json'), 'utf8'));

/** Extract `--var: value` pairs from the :root block of index.css. */
function parseRootVars(text) {
  const root = text.match(/:root\s*\{([\s\S]*?)\n\}/);
  assert.ok(root, 'index.css must have a :root block');
  const vars = {};
  for (const m of root[1].matchAll(/^\s*(--[a-z0-9-]+):\s*([^;]+);/gm)) {
    vars[m[1]] = m[2].trim();
  }
  return vars;
}

test('every PALETTE entry matches the :root custom property in index.css (#924)', () => {
  const vars = parseRootVars(css);
  for (const [name, value] of Object.entries(PALETTE)) {
    assert.ok(name in vars, `${name} missing from :root in index.css`);
    assert.equal(value.toLowerCase(), vars[name].toLowerCase(), `${name} value diverges from index.css`);
  }
});

test('palette covers all core chart/status colors present in :root', () => {
  const vars = parseRootVars(css);
  for (const name of ['--accent', '--prefill', '--decode', '--agent', '--danger', '--warn',
    '--bg-app', '--text-main', '--border']) {
    assert.ok(name in PALETTE, `core color ${name} must be machine-readable`);
    assert.ok(vars[name], `${name} must exist in index.css`);
  }
});

test('public/palette.json mirrors PALETTE exactly (value + semantic role)', () => {
  const entries = paletteJson.palette;
  assert.deepEqual(Object.keys(entries).sort(), Object.keys(PALETTE).sort());
  for (const [name, entry] of Object.entries(entries)) {
    assert.equal(entry.value, PALETTE[name]);
    assert.equal(entry.role, PALETTE_ROLES[name]);
  }
});
