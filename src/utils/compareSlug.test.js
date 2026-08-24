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

test('parseComparePath survives malformed percent-escapes (#910)', () => {
  // decodeURIComponent('%zz') throws URIError — used to crash the page.
  assert.deepEqual(parseComparePath('/compare/%zz-vs-rtx-4090'), { a: '%zz', b: 'rtx-4090' });
  assert.deepEqual(parseComparePath('/compare/rtx-3090-vs-%E0%A4%A'), { a: 'rtx-3090', b: '%E0%A4%A' });
  // valid escapes still decode
  assert.deepEqual(parseComparePath('/compare/m3-max-vs-rtx-3090%20ti'), { a: 'm3-max', b: 'rtx-3090 ti' });
});
