// #732 — fetch-state DOM signal helpers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchStateAttrs, runDiffViewState } from './fetchState.js';

test('fetchStateAttrs marks loading with aria-busy', () => {
  assert.deepEqual(fetchStateAttrs('loading'), { 'data-state': 'loading', 'aria-busy': true });
});

test('ready/error are stable data-state values with aria-busy false', () => {
  assert.deepEqual(fetchStateAttrs('ready'), { 'data-state': 'ready', 'aria-busy': false });
  assert.deepEqual(fetchStateAttrs('error'), { 'data-state': 'error', 'aria-busy': false });
});

test('runDiffViewState derives idle/loading/done/error from the React triple', () => {
  assert.equal(runDiffViewState({}), 'idle');
  assert.equal(runDiffViewState({ loading: true }), 'loading');
  assert.equal(runDiffViewState({ result: { diff: {} } }), 'done');
  assert.equal(runDiffViewState({ error: 'x' }), 'error');
  // error wins over a stale result; loading wins over nothing
  assert.equal(runDiffViewState({ error: 'x', result: { diff: {} } }), 'error');
});

test('spread-ready: attributes survive JSX spread as plain strings/booleans', () => {
  const attrs = fetchStateAttrs('loading');
  assert.equal(typeof attrs['data-state'], 'string');
  assert.equal(attrs['aria-busy'], true);
});
