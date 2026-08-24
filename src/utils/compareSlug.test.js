import { test } from 'node:test';
import assert from 'node:assert/strict';
import { slugify, parseComparePath, prettifySlug } from './compareSlug.js';

test('slugify normalizes hardware labels', () => {
  assert.equal(slugify('RTX 3090'), 'rtx-3090');
  assert.equal(slugify('M3 Max 16-Core GPU'), 'm3-max-16-core-gpu');
  assert.equal(slugify('  2× RTX 4090 (NVLink) '), '2-rtx-4090-nvlink');
  assert.equal(slugify(null), '');
});

test('parseComparePath splits :a-vs-:b', () => {
  assert.deepEqual(parseComparePath('/compare/rtx-3090-vs-rtx-4090'), { a: 'rtx-3090', b: 'rtx-4090' });
  assert.deepEqual(parseComparePath('/compare/m3-max-vs-h100/'), { a: 'm3-max', b: 'h100' });
});

test('parseComparePath rejects malformed paths', () => {
  assert.equal(parseComparePath('/compare/rtx-3090'), null);
  assert.equal(parseComparePath('/compare/'), null);
  assert.equal(parseComparePath('/'), null);
  // no separator at all
  assert.equal(parseComparePath('/compare/justaslug'), null);
});

test('parseComparePath returns null (not throws) on malformed percent-escapes (#910)', () => {
  // decodeURIComponent('%zz') throws URIError — must not reach the renderer.
  assert.equal(parseComparePath('/compare/%zz-vs-rtx-3090'), null);
  assert.equal(parseComparePath('/compare/rtx-3090-vs-%'), null);
  assert.equal(parseComparePath('/compare/%E0%A4%-vs-rtx-3090'), null);
  // valid escapes still decode
  assert.deepEqual(parseComparePath('/compare/rtx-3090-vs-m3%20max'), { a: 'rtx-3090', b: 'm3 max' });
});
