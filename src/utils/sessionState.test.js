import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  serializeSessionState,
  restoreSessionState,
  PERSISTENCE_REGISTRY,
  SESSION_STATE_SCHEMA_VERSION
} from './sessionState.js';

function mockStorage(seed = {}) {
  const m = new Map(Object.entries(seed));
  return {
    getItem: k => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: k => m.delete(k),
    _map: m
  };
}

test('#751 registry covers the eight persisted keys', () => {
  assert.equal(PERSISTENCE_REGISTRY.length, 8);
  const keys = PERSISTENCE_REGISTRY.map(e => e.key).sort();
  assert.deepEqual(keys, [
    'changelog.dismissedId',
    'llmpd-analogy-mode',
    'llmpd-concept-checks-v1',
    'llmpd-curriculum-progress',
    'llmpd-plain-mode',
    'llmpd-theme',
    'llmpdv.slo-budgets-v1',
    'llmpdv.snapshots.v1'
  ]);
  // Every entry documents owner + shape + whether it changes rendered output.
  for (const e of PERSISTENCE_REGISTRY) {
    assert.match(e.owner, /^src\//);
    assert.ok(e.shape.length > 0);
    assert.equal(typeof e.affectsOutput, 'boolean');
  }
});

test('serializeSessionState captures raw storage values; absent keys are null', () => {
  const storage = mockStorage({
    'llmpd-theme': JSON.stringify('dark'),
    'llmpdv.slo-budgets-v1': JSON.stringify({ ttftMs: 500, tpotMs: 50, walltimeSec: 10 }),
    'llmpd-plain-mode': '1'
  });
  const doc = serializeSessionState(storage);
  assert.equal(doc.schemaVersion, SESSION_STATE_SCHEMA_VERSION);
  // Raw localStorage strings are preserved verbatim (byte-identical restore).
  assert.equal(doc.state['llmpd-theme'], '"dark"');
  assert.equal(doc.state['llmpdv.slo-budgets-v1'], '{"ttftMs":500,"tpotMs":50,"walltimeSec":10}');
  assert.equal(doc.state['llmpd-plain-mode'], '1');
  assert.equal(doc.state['llmpd-curriculum-progress'], null);
});

test('restoreSessionState writes entries back and skips unknown/null keys', () => {
  const doc = {
    schemaVersion: SESSION_STATE_SCHEMA_VERSION,
    capturedAt: '2026-08-25T00:00:00.000Z',
    state: {
      'llmpd-theme': 'high-contrast',
      'llmpd-concept-checks-v1': { theory: { check_1: true } },
      'not-a-registered-key': 'x',
      'llmpdv.snapshots.v1': null
    }
  };
  const storage = mockStorage();
  const { restored, skipped } = restoreSessionState(doc, storage);
  assert.deepEqual(restored.sort(), ['llmpd-concept-checks-v1', 'llmpd-theme']);
  assert.deepEqual(skipped.sort(), ['llmpdv.snapshots.v1', 'not-a-registered-key']);
  // Raw strings are written back verbatim; objects are JSON-encoded.
  assert.equal(storage._map.get('llmpd-theme'), 'high-contrast');
  assert.deepEqual(JSON.parse(storage._map.get('llmpd-concept-checks-v1')), { theory: { check_1: true } });
});

test('round-trip: serialize on A restores identical values on B', () => {
  const a = mockStorage({
    'llmpd-theme': '"light"',
    'llmpdv.slo-budgets-v1': '{"ttftMs":250,"tpotMs":null,"walltimeSec":5}'
  });
  const doc = serializeSessionState(a);
  const b = mockStorage();
  restoreSessionState(doc, b);
  assert.equal(b._map.get('llmpd-theme'), '"light"');
  assert.equal(b._map.get('llmpdv.slo-budgets-v1'), '{"ttftMs":250,"tpotMs":null,"walltimeSec":5}');
});

test('restore tolerates garbage documents', () => {
  assert.deepEqual(restoreSessionState(null, mockStorage()), { restored: [], skipped: [] });
  assert.deepEqual(restoreSessionState({ nope: 1 }, mockStorage()), { restored: [], skipped: [] });
});
