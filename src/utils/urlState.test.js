import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clampNum } from './urlState.js';
import { writeParams } from './urlState.js';

// clampNum backs the number-twin inputs (#409) and the URL-param clamps
// (#416): out-of-range values normalize to the slider bounds instead of
// leaving the field, the state and the share URL disagreeing.

test('clampNum keeps in-range values untouched', () => {
  assert.equal(clampNum(777, 2, 1000), 777);
  assert.equal(clampNum(0, -10, 10), 0);
  assert.equal(clampNum(5), 5);
});

test('clampNum clamps to the given bounds (#409 #416)', () => {
  assert.equal(clampNum(-100, 50, 50000), 50);
  assert.equal(clampNum(999999999, 50, 50000), 50000);
  assert.equal(clampNum(500, 1, 200), 200);
  // Open-ended bounds: only the provided side applies.
  assert.equal(clampNum(1e9, undefined, 200), 200);
  assert.equal(clampNum(-5, 1, undefined), 1);
});

test('clampNum resolves non-finite input deterministically', () => {
  // Non-finite input is treated as garbage and falls back to the lower bound
  // (deterministic — never NaN-poisons the simulation state).
  assert.equal(clampNum(NaN, 2, 1000), 2);
  assert.equal(clampNum(Infinity, 2, 1000), 2);
  assert.equal(clampNum('garbage', 2, 1000), 2);
  // No bounds at all: non-finite falls back to 0 rather than propagating NaN.
  assert.equal(clampNum(NaN), 0);


});
// Minimal window mock: urlState reads window.location.{pathname,search,hash}
// and writes through window.history.replaceState. Captures the URL passed to
// replaceState so we can assert the hash survived the param rewrite (#919).
function installWindow(pathname, search, hash) {
  let lastUrl = null;
  globalThis.window = {
    location: { pathname, search, hash },
    history: {
      replaceState: (_s, _t, url) => { lastUrl = url; }
    }
  };
  return () => lastUrl;
}

test('writeParams preserves the #s/<slug> permalink fragment (#919)', () => {
  const lastUrl = installWindow('/', '?preset=rtx4090_exl2&prefill=3800', '#s/my-slug');
  writeParams({ tab: 'diff' });
  assert.match(lastUrl(), /#s\/my-slug$/, 'permalink fragment must survive the rewrite');
  assert.equal(lastUrl(), '/?preset=rtx4090_exl2&prefill=3800&tab=diff#s/my-slug');
});

test('writeParams preserves ?tab=theory-style anchor hashes', () => {
  const lastUrl = installWindow('/', '?tab=theory', '#theory-anchors');
  writeParams({ prefill: 2048 });
  assert.equal(lastUrl(), '/?tab=theory&prefill=2048#theory-anchors');
});

test('writeParams keeps the fragment even when all params are removed', () => {
  const lastUrl = installWindow('/embed', '?flags=flash-attn', '#s/deadbeef');
  writeParams({ flags: '' });
  assert.equal(lastUrl(), '/embed#s/deadbeef');
});

test('writeParams adds no trailing # when the location has no hash', () => {
  const lastUrl = installWindow('/', '?a=1', '');
  writeParams({ b: 2 });
  assert.equal(lastUrl(), '/?a=1&b=2');
});
