// Issue #629: snapshot rows must be distinguishable — unique default names,
// machine-readable createdAt, and per-row ids.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { uniqueSnapshotName, snapshotTimestampAttrs } from './snapshotMeta.js';

test('first unnamed snapshot keeps the plain default name', () => {
  assert.equal(uniqueSnapshotName([], 'Untitled snapshot'), 'Untitled snapshot');
});

test('subsequent unnamed snapshots get numbered defaults', () => {
  const existing = ['Untitled snapshot'];
  assert.equal(uniqueSnapshotName(existing, 'Untitled snapshot'), 'Untitled snapshot 2');
  assert.equal(
    uniqueSnapshotName(['Untitled snapshot', 'Untitled snapshot 2'], 'Untitled snapshot'),
    'Untitled snapshot 3'
  );
});

test('numbering skips gaps left by deleted snapshots without colliding', () => {
  const existing = ['Untitled snapshot', 'Untitled snapshot 3'];
  assert.equal(uniqueSnapshotName(existing, 'Untitled snapshot'), 'Untitled snapshot 2');
});

test('explicit names are never altered', () => {
  assert.equal(uniqueSnapshotName(['My run'], 'My run'), 'My run 2');
});

test('timestamp attrs produce ISO datetime and pass through the epoch value', () => {
  const t = Date.UTC(2026, 7, 24, 12, 0, 0);
  const attrs = snapshotTimestampAttrs(t);
  assert.equal(attrs.iso, '2026-08-24T12:00:00.000Z');
});

test('invalid or legacy-missing timestamps render nothing rather than garbage', () => {
  assert.equal(snapshotTimestampAttrs(undefined), null);
  assert.equal(snapshotTimestampAttrs(null), null);
  assert.equal(snapshotTimestampAttrs(0), null);
  assert.equal(snapshotTimestampAttrs('not-a-number'), null);
});
