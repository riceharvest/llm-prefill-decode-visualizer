import { test } from 'node:test';
import assert from 'node:assert/strict';
import { slugify, parseComparePath, prettifySlug, comparePairStatus } from './compareSlug.js';

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

test('parseComparePath survives malformed %-encoding (#759)', () => {
  // decodeURIComponent would throw a URIError on these; the parser must not.
  assert.deepEqual(parseComparePath('/compare/%ZZ-vs-rtx-4090'), { a: '%ZZ', b: 'rtx-4090' });
  assert.deepEqual(parseComparePath('/compare/rtx-3090-vs-%GG'), { a: 'rtx-3090', b: '%GG' });
  // valid %-encoding still decodes
  assert.deepEqual(parseComparePath('/compare/a%20b-vs-c'), { a: 'a b', b: 'c' });
});

test('comparePairStatus gates the /compare URL space on known slugs (#759)', () => {
  const slugs = new Set(['rtx-3090', 'rtx-4090']);
  assert.equal(comparePairStatus(slugs, 'rtx-3090', 'rtx-4090'), 'ok');
  assert.equal(comparePairStatus(slugs, 'totally-fake-gpu', 'another-fake-one'), 'unknown');
  assert.equal(comparePairStatus(slugs, 'rtx-3090', 'another-fake-one'), 'unknown');
  assert.equal(comparePairStatus(slugs, '', 'rtx-4090'), 'unknown');
  // array input is accepted and coerced to a set
  assert.equal(comparePairStatus(['rtx-3090'], 'rtx-3090', 'rtx-3090'), 'ok');
});
