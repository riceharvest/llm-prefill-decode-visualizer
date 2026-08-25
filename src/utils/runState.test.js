import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runStateAttrs, phaseTagClass } from './runState.js';

// ---- runStateAttrs (#827) ------------------------------------------------

test('runStateAttrs marks running phases aria-busy', () => {
  for (const s of ['prefilling', 'decoding', 'running']) {
    const attrs = runStateAttrs(s);
    assert.equal(attrs['data-run-state'], s);
    assert.equal(attrs['aria-busy'], 'true');
  }
});

test('runStateAttrs leaves idle/completed non-busy', () => {
  for (const s of ['idle', 'completed']) {
    const attrs = runStateAttrs(s);
    assert.equal(attrs['data-run-state'], s);
    assert.ok(!('aria-busy' in attrs));
  }
});

// ---- phaseTagClass (#827): completed must not reuse tag-decode -----------

test('completed gets its own tag-complete class, distinct from decoding', () => {
  assert.equal(phaseTagClass('prefilling'), 'tag-prefill');
  assert.equal(phaseTagClass('decoding'), 'tag-decode');
  assert.equal(phaseTagClass('completed'), 'tag-complete');
  assert.equal(phaseTagClass('idle'), '');
});
