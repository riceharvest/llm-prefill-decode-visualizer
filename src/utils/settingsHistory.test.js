import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  serializeSettings, parseSettings, settingsEqual,
  createHistory, recordChange, undo, redo, HISTORY_LIMIT,
  loadSnapshots, saveSnapshots, SNAPSHOT_STORAGE_KEY
} from './settingsHistory.js';

test('serialize matches the URL-sharing param format', () => {
  assert.equal(
    serializeSettings({ preset: 'rtx4090_exl2', prefill: 3800, decode: 105, sim: 2, flags: ['flash-attn'] }),
    'preset=rtx4090_exl2&prefill=3800&decode=105&sim=2&flags=flash-attn'
  );
});

test('defaults and empty fields are omitted from the query string', () => {
  assert.equal(serializeSettings({ preset: 'rtx4090_exl2', prefill: 3800, decode: 105 }), 'preset=rtx4090_exl2&prefill=3800&decode=105');
  assert.equal(serializeSettings({}), '');
  assert.equal(serializeSettings(null), '');
});

test('parse round-trips a full settings string', () => {
  const qs = 'preset=a&prefill=3800&decode=105&sim=instant&flags=flash-attn,kv-q8';
  const s = parseSettings(qs);
  assert.equal(s.preset, 'a');
  assert.equal(s.prefill, 3800);
  assert.equal(s.decode, 105);
  assert.equal(s.sim, 'instant');
  assert.deepEqual(s.flags, ['flash-attn', 'kv-q8']);
  // URLSearchParams encodes ',' as %2C — same as the app's existing
  // writeParams() output, and readParam() decodes it back on load.
  assert.equal(serializeSettings(s), qs.replace(/,/g, '%2C'));
});

test('parse tolerates garbage and missing values', () => {
  const s = parseSettings('prefill=abc&flags=,,x');
  assert.equal(s.prefill, null);
  assert.equal(s.sim, 1);
  assert.deepEqual(s.flags, ['x']);
  assert.equal(parseSettings('').preset, '');
  assert.equal(parseSettings(undefined).decode, null);
});

test('settingsEqual ignores representation noise', () => {
  assert.ok(settingsEqual({ prefill: 100 }, { prefill: '100' }));
  assert.ok(!settingsEqual({ prefill: 100 }, { prefill: 200 }));
});

test('undo moves current to future and pops the last past entry', () => {
  let h = createHistory();
  h = recordChange(h, 'preset=a');
  h = recordChange(h, 'preset=a&prefill=1');
  const r = undo(h, 'preset=a&prefill=1&decode=2');
  assert.equal(r.qs, 'preset=a&prefill=1');
  assert.deepEqual(r.history.past, ['preset=a']);
  assert.deepEqual(r.history.future, ['preset=a&prefill=1&decode=2']);
});

test('redo re-applies the newest future entry and re-records current', () => {
  let h = createHistory();
  h = recordChange(h, 'a');
  h = recordChange(h, 'b');
  h = undo(h, 'c').history;
  const r = redo(h, 'b');
  assert.equal(r.qs, 'c');
  assert.deepEqual(r.history.past, ['a', 'b']);
  assert.deepEqual(r.history.future, []);
});

test('a fresh change after undo clears the redo branch', () => {
  let h = createHistory();
  h = recordChange(h, 'a');
  h = recordChange(h, 'b');
  h = undo(h, 'c').history;
  h = recordChange(h, 'b');
  assert.deepEqual(h.future, []);
  assert.equal(undo(h, 'x').qs, 'b');
});

test('undo/redo at the stack edges return null', () => {
  assert.equal(undo(createHistory(), 'x'), null);
  assert.equal(redo(createHistory(), 'x'), null);
});

test('history is capped at HISTORY_LIMIT entries', () => {
  let h = createHistory();
  for (let i = 0; i < HISTORY_LIMIT + 25; i++) h = recordChange(h, `s${i}`);
  assert.equal(h.past.length, HISTORY_LIMIT);
  assert.equal(h.past[0], `s${25}`);
});

test('snapshots survive a localStorage round-trip and reject corrupt data', () => {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, v)
  };
  try {
    assert.deepEqual(loadSnapshots(), []);
    const snaps = [{ id: 'x1', name: '4090 fp16 32k ctx', qs: 'preset=rtx4090_exl2', createdAt: 1 }];
    saveSnapshots(snaps);
    assert.deepEqual(loadSnapshots(), snaps);
    store.set(SNAPSHOT_STORAGE_KEY, '{not json');
    assert.deepEqual(loadSnapshots(), []);
    store.set(SNAPSHOT_STORAGE_KEY, '[{"nope":1}]');
    assert.deepEqual(loadSnapshots(), []);
  } finally {
    delete globalThis.localStorage;
  }
});

test('snapshot helpers no-op gracefully without localStorage', () => {
  assert.deepEqual(loadSnapshots(), []);
  assert.doesNotThrow(() => saveSnapshots([{ id: 'a', name: 'n', qs: 'x', createdAt: 1 }]));
});
