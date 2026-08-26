// Issues #386 (fractional token counts) + #392/#389 (batching number inputs)
// — pure-helper behavior plus source-contract pins on the JSX consumers
// (plain node --test cannot import JSX).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));

// --- readTokenCount: one discrete-token policy at URL parse time (#386) ---

function withSearch(search, fn) {
  const prevWindow = globalThis.window;
  globalThis.window = {
    location: { search, pathname: '/', href: `http://localhost/${search}` },
    history: { replaceState() {} }
  };
  try {
    return fn();
  } finally {
    globalThis.window = prevWindow;
  }
}

test('readTokenCount floors fractional values so no panel shows 2,048.7 tok', async () => {
  const { readTokenCount } = await import('./urlState.js');
  withSearch('?prompt=2048.7&output=512.9', () => {
    assert.equal(readTokenCount('prompt', 2048), 2048);
    assert.equal(readTokenCount('output', 512), 512);
  });
});

test('readTokenCount falls back on garbage, zero, negative and missing params', async () => {
  const { readTokenCount } = await import('./urlState.js');
  withSearch('?prompt=abc&output=0&other=-5', () => {
    assert.equal(readTokenCount('prompt', 2048), 2048);
    assert.equal(readTokenCount('output', 512), 512);
    assert.equal(readTokenCount('missing', 2048), 2048);
    assert.equal(readTokenCount('other', 2048), 2048); // negative → fallback
    // Integer values pass through untouched.
    withSearch('?n=4096', () => {
      assert.equal(readTokenCount('n', 1), 4096);
    });
  });
});

test('SingleTurnVisualizer parses prompt/output through readTokenCount (#386)', () => {
  const src = readFileSync(join(here, '../components/SingleTurnVisualizer.jsx'), 'utf8');
  assert.match(src, /readTokenCount\('prompt', 2048\)/);
  assert.match(src, /readTokenCount\('output', 512\)/);
  // The number twins floor fractional typed input too.
  assert.match(src, /Tokens are discrete \(#386\): floor fractional input/);
});

test('App permalink title uses the floored prompt token count (#386)', () => {
  const src = readFileSync(join(here, '../App.jsx'), 'utf8');
  assert.match(src, /Math\.floor\(Number\(readParam\('prompt'\)\)\)/);
});

// --- Batching number inputs clamp to slider ranges and expose bounds (#392) ---

test('BatchingVisualizer number inputs carry min/max and clamp on commit (#392)', () => {
  const src = readFileSync(join(here, '../components/BatchingVisualizer.jsx'), 'utf8');
  // min/max attrs mirror the paired sliders so agents can read bounds from DOM.
  assert.match(src, /type="number" min="2" max="48" value=\{numRequests\}/);
  assert.match(src, /type="number" min="128" max="32768" value=\{meanPromptTokens\}/);
  assert.match(src, /type="number" min="32" max="4096" value=\{meanOutputTokens\}/);
  assert.match(src, /type="number" min="1" max="32" value=\{maxBatchSize\}/);
  assert.match(src, /type="number" min="0" max="2000" value=\{arrivalIntervalMs\}/);
  // Commit path clamps instead of storing raw input.
  assert.match(src, /commitClampedNumber\(setNumRequests, 2, 48\)/);
  assert.match(src, /const n = Number\(e\.target\.value\);\s*\n\s*if \(!Number\.isFinite\(n\)\) return;\s*\n\s*setter\(Math\.min\(max, Math\.max\(min, n\)\)\);/);
});
