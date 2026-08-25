import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

// ---------------------------------------------------------------------------
// #635 — agent-facing client surfaces must be locale-independent. These are
// source-contract pins for JSX files that cannot be imported under plain
// `node --test`: the aria/i18n surfaces must go through fmtEn (en-US pinned),
// not bare toLocaleString().
// ---------------------------------------------------------------------------

test('#635 ABReplay slider aria-valuetext is locale-independent (fmtEn)', () => {
  const src = readFileSync(join(ROOT, 'src/components/ABReplay.jsx'), 'utf8');
  assert.ok(src.includes("import { fmtEn } from '../utils/numfmt'"), 'ABReplay must import fmtEn');
  assert.ok(!src.includes('.toLocaleString()} tokens`}'), 'aria-valuetext must not use bare toLocaleString');
  assert.match(src, /aria-valuetext=\{\`\$\{fmtEn\(promptTokens\)\} tokens`\}/);
  assert.match(src, /aria-valuetext=\{\`\$\{fmtEn\(outputTokens\)\} tokens`\}/);
});

test('#635 SingleTurnVisualizer i18n-interpolated speeds are locale-independent', () => {
  const src = readFileSync(join(ROOT, 'src/components/SingleTurnVisualizer.jsx'), 'utf8');
  assert.ok(src.includes("import { fmtEn } from '../utils/numfmt';"), 'SingleTurnVisualizer must import fmtEn');
  assert.ok(
    !src.includes("ctxEffectiveTag', { speed: displayDecodeSpeed.toLocaleString() }"),
    'ctxEffectiveTag speed must use fmtEn'
  );
  assert.ok(
    !src.includes("tokensPerSecSub', { speed: displayDecodeSpeed.toLocaleString() }"),
    'tokensPerSecSub speed must use fmtEn'
  );
});

test('#635 export/clipboard/report builders contain zero bare toLocaleString()', () => {
  for (const f of ['src/utils/exportMarkdown.js', 'src/utils/sizingReport.js', 'src/utils/localMaxxing.js']) {
    const src = readFileSync(join(ROOT, f), 'utf8');
    assert.ok(!src.includes('.toLocaleString()'), `${f} must not call bare toLocaleString()`);
    assert.ok(src.includes('fmtEn'), `${f} must use the en-US-pinned formatter`);
  }
});

test('#635 presets.formatTokens below-10k branch is en-US pinned', () => {
  const src = readFileSync(join(ROOT, 'src/utils/presets.js'), 'utf8');
  assert.ok(!src.includes('.toLocaleString()'), 'formatTokens must not call bare toLocaleString()');
});

// ---------------------------------------------------------------------------
// #639 — invalid SLO budget input must be rejected with an error surface,
// not silently coerced to null ("check disabled").
// ---------------------------------------------------------------------------

test('#639 SloBudgetsPanel validates budget input and renders role=alert', () => {
  const src = readFileSync(join(ROOT, 'src/components/SloBudgetsPanel.jsx'), 'utf8');
  assert.ok(src.includes('validateBudgetInput'), 'panel must use the shared validator');
  assert.ok(!/onChange\(\{ \.\.\.budgets, \[key\]: raw === ''/.test(src), 'old silent-coercion path must be gone');
  assert.match(src, /role="alert"/, 'invalid input needs an assertive live-region error');
  assert.match(src, /console\.warn/, 'invalid input must also warn on console');
});

// ---------------------------------------------------------------------------
// #644 — demoUrl must preserve active query params (?lang= included).
// ---------------------------------------------------------------------------

test('#644 demoUrl overlays demo params onto the live query string', () => {
  const src = readFileSync(join(ROOT, 'src/utils/urlState.js'), 'utf8');
  const fn = src.slice(src.indexOf('export function demoUrl'));
  assert.ok(fn.includes('window.location.search'), 'demoUrl must start from the live query string');
  assert.ok(fn.includes("p.set('autoplay', '1')"), 'autoplay=1 must still be set by the demo itself');
});

// ---------------------------------------------------------------------------
// #638 — plain/analogy variants are link-addressable via ?plain=/&analogy=.
// ---------------------------------------------------------------------------

test('#638 getPlainMode/getAnalogyMode honor URL overrides before localStorage', () => {
  const plain = readFileSync(join(ROOT, 'src/utils/plainLanguage.js'), 'utf8');
  const analogy = readFileSync(join(ROOT, 'src/utils/analogies.js'), 'utf8');
  for (const [name, src] of [['plainLanguage', plain], ['analogies', analogy]]) {
    assert.ok(src.includes("get('plain')" ) || src.includes("get('analogy')"), `${name} must read its URL param`);
    assert.ok(/URLSearchParams\(window\.location\.search\)/.test(src), `${name} must parse the live URL`);
    assert.match(src, /v === '1' \|\| v === 'true'/);
    assert.match(src, /v === '0' \|\| v === 'false'/);
  }
});
