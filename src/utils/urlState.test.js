// Issue #765: the UI share-link boolean table must match the API's
// (api/_handlers/compute.js parseBoolParam): 1/true/yes/on → true,
// 0/false/no/off → false, case-insensitive; unrecognized → fallback.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readParamBool } from './urlState.js';

function setSearch(search) {
  globalThis.window = { location: { search } };
}

test('truthy spellings (case-insensitive) resolve to true', () => {
  for (const v of ['1', 'true', 'yes', 'on', 'True', 'YES', 'On']) {
    setSearch(`?cache=${v}`);
    assert.equal(readParamBool('cache', false), true, `value: ${v}`);
  }
});

test('falsy spellings (case-insensitive) resolve to false', () => {
  for (const v of ['0', 'false', 'no', 'off', 'False', 'OFF', 'No']) {
    setSearch(`?cache=${v}`);
    assert.equal(readParamBool('cache', true), false, `value: ${v}`);
  }
});

test('missing or empty param falls back', () => {
  setSearch('?other=1');
  assert.equal(readParamBool('cache', true), true);
  assert.equal(readParamBool('cache', false), false);
  setSearch('?cache=');
  assert.equal(readParamBool('cache', true), true);
});

test('unrecognized value falls back instead of silently inverting polarity', () => {
  setSearch('?cache=banana');
  assert.equal(readParamBool('cache', true), true);
  setSearch('?spec=banana');
  assert.equal(readParamBool('spec', false), false);
});
