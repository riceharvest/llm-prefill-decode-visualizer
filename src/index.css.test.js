import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Regression guards for the mobile/iOS CSS fixes:
//   #1014 — dead -webkit-overflow-scrolling replaced by overscroll-behavior-x
//   #1016 — 100vh viewport-height tracking fixed with 100dvh overrides
//   #1092 — touch-action: manipulation on interactive controls
const css = readFileSync(fileURLToPath(new URL('./index.css', import.meta.url)), 'utf8');

test('#1014: no dead -webkit-overflow-scrolling declarations remain', () => {
  assert.equal(css.includes('-webkit-overflow-scrolling'), false);
});

test('#1014: both phone scrollers chain-guard with overscroll-behavior-x', () => {
  const count = css.match(/overscroll-behavior-x\s*:\s*contain/g)?.length ?? 0;
  assert.equal(count, 2); // .waterfall-rows + .table-wrap
});

test('#1016: body/.app-shell/.embed-shell carry 100dvh after the 100vh fallback', () => {
  assert.equal(css.match(/min-height\s*:\s*100dvh/g)?.length, 3);
  // Every 100dvh override must directly follow a 100vh fallback (old-Safari safe).
  for (const m of css.matchAll(/min-height\s*:\s*100dvh/g)) {
    const before = css.slice(Math.max(0, m.index - 200), m.index);
    assert.match(before, /min-height\s*:\s*100vh/);
  }
});

test('#1092: interactive controls opt out of double-tap-zoom', () => {
  assert.match(css, /touch-action\s*:\s*manipulation/);
});
