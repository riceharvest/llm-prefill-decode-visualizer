import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applySnapshotPin } from './diff.js';

// Issue #834: /api/diff accepted ?snapshot= only to ignore it. What-if legs
// must carry the pin into their /api/best constraint sets.

test('snapshot pin is merged into a what-if constraint set', () => {
  const set = applySnapshotPin({ by: 'decode', fitCheck: 'true' }, { snapshot: 'snapshot-2026-08-21-a1b2c3d4' });
  assert.equal(set.snapshot, 'snapshot-2026-08-21-a1b2c3d4');
  assert.equal(set.by, 'decode');
});

test('no pin -> constraint set unchanged', () => {
  const set = { by: 'decode' };
  assert.deepEqual(applySnapshotPin(set, {}), set);
  assert.deepEqual(applySnapshotPin(set), set);
});

test('the top-level ?snapshot= pin overrides any snapshot inside a leg', () => {
  const set = applySnapshotPin({ snapshot: 'leg-own-pin' }, { snapshot: 'query-pin' });
  assert.equal(set.snapshot, 'query-pin');
});
