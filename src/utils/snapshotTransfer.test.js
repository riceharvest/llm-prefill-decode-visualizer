// Snapshot export/import (#427): the localStorage-only snapshot store gains a
// versioned JSON document egress/ingress path.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  SNAPSHOT_STORAGE_KEY,
  SNAPSHOT_EXPORT_VERSION,
  buildSnapshotExport,
  parseSnapshotImport
} from './settingsHistory.js';

const SNAP = { id: 'mt7kuzsm-1njmf0', name: 'agent-test-1', qs: 'preset=rtx4090_exl2&prefill=3800&decode=105', createdAt: 1787596599478 };

test('export document is valid JSON with a version field and round-trips', () => {
  const doc = buildSnapshotExport([SNAP]);
  assert.equal(doc.schemaVersion, SNAPSHOT_EXPORT_VERSION);
  assert.ok(doc.generator);
  const text = JSON.stringify(doc);
  const parsed = parseSnapshotImport(text, []);
  assert.deepEqual(parsed.snapshots, [SNAP]);
});

test('export drops malformed entries; import rejects unparsable input with null', () => {
  const doc = buildSnapshotExport([SNAP, { id: 7 }, null, { name: 'no id' }]);
  assert.equal(doc.snapshots.length, 1);
  assert.equal(parseSnapshotImport('{not json', []), null);
  assert.equal(parseSnapshotImport('{"snapshots": "nope"}', []), null);
  // Bare array (raw llmpdv.snapshots.v1 shape) is accepted too.
  assert.equal(parseSnapshotImport(JSON.stringify([SNAP]), []).snapshots.length, 1);
});

test('importing over existing ids never overwrites stored snapshots', () => {
  const parsed = parseSnapshotImport(JSON.stringify({ schemaVersion: 1, snapshots: [SNAP, { ...SNAP, name: 'dupe' }] }), [SNAP.id]);
  assert.equal(parsed.snapshots.length, 2);
  const ids = parsed.snapshots.map(s => s.id);
  assert.equal(new Set(ids).size, 2, 'colliding imports must get fresh unique ids');
  assert.ok(ids.every(id => id !== SNAP.id), 'stored snapshot id must not be reused by imports');
});

test('entries missing required fields are skipped, createdAt preserved when numeric', () => {
  const parsed = parseSnapshotImport(
    JSON.stringify({ snapshots: [SNAP, { id: 'a', name: 'no-qs' }, { id: 'b', qs: 'preset=x', name: 'y', createdAt: 'nope' }] }),
    []
  );
  assert.equal(parsed.snapshots.length, 2);
  assert.equal(parsed.snapshots[0].createdAt, 1787596599478);
  assert.equal(parsed.snapshots[1].createdAt, undefined);
});

test('storage key contract unchanged (llmpdv.snapshots.v1)', () => {
  assert.equal(SNAPSHOT_STORAGE_KEY, 'llmpdv.snapshots.v1');
});
