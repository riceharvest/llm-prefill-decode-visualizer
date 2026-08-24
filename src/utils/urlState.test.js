import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readParamNum, readParamPosNum } from './urlState.js';

// urlState reads window.location.search — stub a minimal window per test.
beforeEach(() => {
  globalThis.window = { location: { search: '' } };
});

function withSearch(search) {
  globalThis.window.location.search = search;
}

test('readParamNum keeps existing finite-parsing contract', () => {
  withSearch('?n=4.5');
  assert.equal(readParamNum('n', 1), 4.5);
  withSearch('?n=abc');
  assert.equal(readParamNum('n', 1), 1);
  withSearch('?other=1');
  assert.equal(readParamNum('n', 1), 1);
});

test('readParamPosNum accepts positive values', () => {
  withSearch('?sim=2.5');
  assert.equal(readParamPosNum('sim', 1), 2.5);
  withSearch('?sim=0.01');
  assert.equal(readParamPosNum('sim', 1), 0.01);
});

test('readParamPosNum falls back on zero (#1040 embed freeze)', () => {
  withSearch('?sim=0');
  assert.equal(readParamPosNum('sim', 1), 1);
});

test('readParamPosNum falls back on negative values (#1040 negative clock)', () => {
  withSearch('?sim=-5');
  assert.equal(readParamPosNum('sim', 1), 1);
});

test('readParamPosNum falls back on junk or missing params', () => {
  withSearch('?sim=abc');
  assert.equal(readParamPosNum('sim', 1), 1);
  withSearch('');
  assert.equal(readParamPosNum('sim', 1), 1);
});
