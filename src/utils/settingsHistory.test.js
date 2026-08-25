import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  serializeSettings, parseSettings, settingsEqual,
  createHistory, recordChange, undo, redo, HISTORY_LIMIT,
  loadSnapshots, saveSnapshots, mergeSnapshots, onExternalSnapshots,
  SNAPSHOT_STORAGE_KEY,
  SPEED_RANGES, clampPrefill, clampDecode
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

// #414: snapshots/undo entries must carry the single-turn workload so restore
// and share links reproduce the full configuration.
test('serialize includes prompt/output workload tokens (#414)', () => {
  assert.equal(
    serializeSettings({ preset: 'a', prefill: 1, decode: 2, prompt: 2048, output: 512 }),
    'preset=a&prefill=1&decode=2&prompt=2048&output=512'
  );
  // Absent workload stays omitted — old callers produce identical strings.
  assert.equal(serializeSettings({ preset: 'a' }), 'preset=a');
});

test('parse round-trips prompt/output and tolerates their absence', () => {
  const s = parseSettings('prompt=32768&output=4096');
  assert.equal(s.prompt, 32768);
  assert.equal(s.output, 4096);
  assert.equal(serializeSettings(s), 'prompt=32768&output=4096');
  const bare = parseSettings('preset=a');
  assert.equal(bare.prompt, null);
  assert.equal(bare.output, null);
  // Garbage values degrade to null instead of NaN-poisoning the settings.
  const garbage = parseSettings('prompt=abc&output=');
  assert.equal(garbage.prompt, null);
  assert.equal(garbage.output, null);
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

// --- speed clamping (#1005) -------------------------------------------------

test('clampPrefill/clampDecode pin values into the declared slider ranges', () => {
  assert.deepEqual(SPEED_RANGES.prefill, { min: 50, max: 50000 });
  assert.deepEqual(SPEED_RANGES.decode, { min: 2, max: 1000 });
  assert.equal(clampPrefill(999999999), 50000);
  assert.equal(clampDecode(36716), 1000);
  assert.equal(clampPrefill(10), 50);
  assert.equal(clampDecode(0.5), 2);
  assert.equal(clampPrefill(2048), 2048);
});

test('clamped values survive parseSettings (undo/redo/snapshot restore path)', () => {
  const s = parseSettings('prefill=999999999&decode=36716&sim=20');
  assert.equal(s.prefill, 50000);
  assert.equal(s.decode, 1000);
  // In-range values pass through untouched
  const ok = parseSettings('prefill=4096&decode=340');
  assert.equal(ok.prefill, 4096);
  assert.equal(ok.decode, 340);
  // Absent values stay absent
  const none = parseSettings('preset=x');
  assert.equal(none.prefill, null);
  assert.equal(none.decode, null);
});

// ---- #610: cross-tab snapshot sync -----------------------------------------

test('#610: mergeSnapshots unions by id, primary wins conflicts, invalid entries dropped', () => {
  const local = [
    { id: 'a', name: 'A (renamed here)', qs: 'x=1', createdAt: 2 },
    { id: 'b', name: 'B', qs: 'x=2', createdAt: 1 }
  ];
  const incoming = [
    { id: 'a', name: 'A', qs: 'x=1', createdAt: 1 }, // conflict → local wins
    { id: 'c', name: 'C', qs: 'x=3', createdAt: 3 }, // only in storage → kept
    { id: 'bad' } // invalid shape → never resurrected
  ];
  const merged = mergeSnapshots(local, incoming);
  assert.deepEqual(merged.map(s => s.id), ['a', 'b', 'c']);
  assert.equal(merged[0].name, 'A (renamed here)');
});

test('#610: onExternalSnapshots fires on storage events for the snapshots key and unsubscribes', () => {
  // Minimal window + localStorage stand-in (node has neither by default).
  const store = new Map();
  globalThis.localStorage = {
    getItem: k => store.has(k) ? store.get(k) : null,
    setItem: (k, v) => store.set(k, String(v))
  };
  const listeners = [];
  globalThis.window = {
    addEventListener: (_type, fn) => listeners.push(fn),
    removeEventListener: (_type, fn) => {
      const i = listeners.indexOf(fn);
      if (i >= 0) listeners.splice(i, 1);
    }
  };
  try {
    saveSnapshots([{ id: 'a', name: 'n', qs: '', createdAt: 1 }]);
    const seen = [];
    const unsubscribe = onExternalSnapshots(list => seen.push(list));
    assert.equal(listeners.length, 1);

    // Event from ANOTHER tab for an unrelated key → ignored.
    listeners[0]({ key: 'llmpdv.slo-budgets-v1' });
    // Event for the snapshots key → callback gets the fresh list.
    store.set(SNAPSHOT_STORAGE_KEY, JSON.stringify([{ id: 'z', name: 'z', qs: '', createdAt: 9 }]));
    listeners[0]({ key: SNAPSHOT_STORAGE_KEY });
    assert.equal(seen.length, 1);
    assert.equal(seen[0][0].id, 'z');

    unsubscribe();
    assert.equal(listeners.length, 0);
  } finally {
    delete globalThis.window;
    delete globalThis.localStorage;
  }
});

// ---- #613: snapshots carry SLO budgets -------------------------------------

test('#613: loadSnapshots preserves the budgets field on stored snapshots', () => {
  const store = new Map();
  globalThis.localStorage = {
    getItem: k => store.get(k) ?? null,
    setItem: (k, v) => store.set(k, String(v))
  };
  try {
    const snaps = [{
      id: 's1', name: 'budgeted', qs: 'preset=x', createdAt: 1,
      budgets: { ttftMs: 500, tpotMs: 40, walltimeSec: 10 }
    }];
    saveSnapshots(snaps);
    const loaded = loadSnapshots();
    assert.equal(loaded.length, 1);
    assert.deepEqual(loaded[0].budgets, { ttftMs: 500, tpotMs: 40, walltimeSec: 10 });
  } finally {
    delete globalThis.localStorage;
  }
});
