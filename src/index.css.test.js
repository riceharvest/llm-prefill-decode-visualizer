import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const css = readFileSync(fileURLToPath(new URL('./index.css', import.meta.url)), 'utf8');

// ---- #428: single-turn/agentic action rows must wrap, not clip off-screen ----

test('#428 .action-row wraps so trailing buttons stay reachable at 390px', () => {
  const m = css.match(/\.action-row\s*\{[^}]*\}/);
  assert.ok(m, '.action-row rule exists');
  assert.match(m[0], /flex-wrap:\s*wrap/);
});

// ---- #430: footer links need a >=44px touch target ----

test('#430 footer links carry a 44px minimum touch target', () => {
  const m = css.match(/\.site-footer a\s*\{[^}]*\}/);
  assert.ok(m, '.site-footer a rule exists');
  assert.match(m[0], /min-height:\s*44px/);
});
