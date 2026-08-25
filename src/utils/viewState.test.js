import { test } from 'node:test';
import assert from 'node:assert/strict';
import { phaseToRunState, clockToRunState, runStateToBusy } from './viewState.js';

test('phaseToRunState maps the shared phase machine onto idle/running/done', () => {
  assert.equal(phaseToRunState('idle'), 'idle');
  assert.equal(phaseToRunState('prefilling'), 'running');
  assert.equal(phaseToRunState('decoding'), 'running');
  assert.equal(phaseToRunState('completed'), 'done');
});

test('phaseToRunState treats unknown phases as running, never as done', () => {
  // Regression for #701: the old tag-class mapping collapsed decoding and
  // completed into the same class; a conservative unknown → running keeps
  // wait-for-done predicates sound even if a new phase is added.
  assert.equal(phaseToRunState(undefined), 'running');
  assert.equal(phaseToRunState('paused'), 'running');
});

test('clockToRunState maps playback clocks onto the same vocabulary', () => {
  assert.equal(clockToRunState(0, 10), 'idle');
  assert.equal(clockToRunState(-1, 10), 'idle');
  assert.equal(clockToRunState(5, 10), 'running');
  assert.equal(clockToRunState(10, 10), 'done');
  assert.equal(clockToRunState(12, 10), 'done');
});

test('clockToRunState never reports done without a finite positive total', () => {
  // Degenerate configs (no work to simulate) must not look finished.
  assert.equal(clockToRunState(5, Infinity), 'running');
  assert.equal(clockToRunState(5, NaN), 'running');
  assert.equal(clockToRunState(5, 0), 'running');
});

test('runStateToBusy flags only in-flight runs', () => {
  assert.equal(runStateToBusy('idle'), false);
  assert.equal(runStateToBusy('running'), true);
  assert.equal(runStateToBusy('done'), false);
});
