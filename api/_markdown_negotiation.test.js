// Regression tests for issue #1047: Accept negotiation must parse media
// ranges and q-values instead of substring-matching the whole header.
// Cases mirror the live-verified table in the issue.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { wantsMarkdown, parseAccept } from './_markdown.js';

const fakeReq = accept => ({ headers: { accept } });

test('parseAccept extracts types and clamped q-values', () => {
  assert.deepEqual(parseAccept('application/json;q=1.0, text/markdown;q=0.1'), [
    { type: 'application/json', q: 1, order: 0 },
    { type: 'text/markdown', q: 0.1, order: 1 }
  ]);
  // Malformed / junk entries are dropped, not coerced into matches.
  assert.deepEqual(parseAccept('garbage'), []);
  assert.deepEqual(parseAccept(undefined), []);
  assert.equal(parseAccept('text/markdown;q=banana').length, 0);
});

test('#1047 case 1+2: JSON ranked first or higher-q beats markdown', () => {
  assert.equal(wantsMarkdown(fakeReq('application/json, text/markdown')), false);
  assert.equal(wantsMarkdown(fakeReq('application/json;q=1.0, text/markdown;q=0.1')), false);
});

test('#1047 case 3: explicit q=0 refusal is honored', () => {
  assert.equal(wantsMarkdown(fakeReq('text/markdown;q=0')), false);
  assert.equal(wantsMarkdown(fakeReq('text/markdown;q=0, */*')), false);
});

test('#1047 case 4: junk near-markdown types never match', () => {
  assert.equal(wantsMarkdown(fakeReq('text/markdownx')), false);
  assert.equal(wantsMarkdown(fakeReq('application/markdowny')), false);
});

test('#1047 case 5: unsatisfiable Accept falls back to JSON silently', () => {
  assert.equal(wantsMarkdown(fakeReq('image/png')), false);
});

test('plain and wildcard preferences keep working', () => {
  assert.equal(wantsMarkdown(fakeReq('text/markdown')), true);
  assert.equal(wantsMarkdown(fakeReq('TEXT/MARKDOWN')), true);
  assert.equal(wantsMarkdown(fakeReq('application/markdown')), true);
  assert.equal(wantsMarkdown(fakeReq('*/*')), false);
  assert.equal(wantsMarkdown(fakeReq('application/json')), false);
  assert.equal(wantsMarkdown(fakeReq(undefined)), false);
  // Markdown strictly preferred over a low-q default wins.
  assert.equal(wantsMarkdown(fakeReq('text/markdown;q=0.9, */*;q=0.1')), true);
  // A major wildcard that admits no JSON variant makes markdown the only
  // acceptable representation (RFC-correct; browsers never send text/*).
  assert.equal(wantsMarkdown(fakeReq('text/*')), true);
});
