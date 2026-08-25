import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  serializeSettings, parseSettings, settingsEqual,
  createHistory, recordChange, undo, redo, HISTORY_LIMIT,
  loadSnapshots, saveSnapshots, SNAPSHOT_STORAGE_KEY,
  sanitizeHistory, loadHistory, saveHistory, HISTORY_STORAGE_KEY,
  exportSnapshots, importSnapshots, mergeSnapshots, SNAPSHOT_EXPORT_SCHEMA,
  planRestore
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

// ---------- #565: undo/redo stack persistence ----------

test('history survives a localStorage round-trip (reload keeps the trail)', () => {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, v)
  };
  try {
    assert.deepEqual(loadHistory(), { past: [], future: [] });
    let h = createHistory();
    h = recordChange(h, 'preset=a');
    h = recordChange(h, 'preset=b');
    h = undo(h, 'preset=c').history; // leaves entries in BOTH halves
    assert.ok(h.past.length > 0 && h.future.length > 0);
    assert.ok(saveHistory(h));
    const restored = loadHistory();
    assert.deepEqual(restored, sanitizeHistory(JSON.parse(store.get(HISTORY_STORAGE_KEY))));
    assert.ok(restored.past.length > 0, 'restored history must not be empty');
    // The pre-reload change is still undoable.
    assert.equal(undo(restored, 'current').qs, restored.past[restored.past.length - 1]);
    // Corrupt storage falls back to an empty history instead of throwing.
    store.set(HISTORY_STORAGE_KEY, '{oops');
    assert.deepEqual(loadHistory(), { past: [], future: [] });
    store.set(HISTORY_STORAGE_KEY, '{"past":[42,null,"preset=x"],"future":"nope"}');
    assert.deepEqual(loadHistory(), { past: ['preset=x'], future: [] });
  } finally {
    delete globalThis.localStorage;
  }
});

test('saveHistory caps oversized stacks and reports storage failure', () => {
  delete globalThis.localStorage;
  assert.equal(saveHistory({ past: Array(200).fill('x'), future: ['y'] }), false);
  globalThis.localStorage = {
    getItem: () => null,
    setItem() { throw new Error('QuotaExceededError'); }
  };
  try {
    assert.equal(saveHistory(createHistory()), false);
  } finally {
    delete globalThis.localStorage;
  }
});

test('sanitizeHistory enforces the HISTORY_LIMIT cap on both halves', () => {
  const big = { past: Array.from({ length: HISTORY_LIMIT + 10 }, (_, i) => `p${i}`), future: Array.from({ length: HISTORY_LIMIT + 3 }, (_, i) => `f${i}`) };
  const s = sanitizeHistory(big);
  assert.equal(s.past.length, HISTORY_LIMIT);
  assert.equal(s.future.length, HISTORY_LIMIT);
  assert.equal(s.past[0], `p${10}`); // oldest trimmed
});

// ---------- #566: snapshot export / import / merge ----------

const SAMPLE_SNAPS = [
  { id: 'x1', name: '4090 fp16 32k ctx', qs: 'preset=rtx4090_exl2&prefill=3800', createdAt: 111 },
  { id: 'x2', name: 'pi5 slow', qs: 'preset=rpi5&prefill=120&decode=8', createdAt: 222 }
];

test('export → import round-trips names, ids and createdAt intact', () => {
  const json = exportSnapshots(SAMPLE_SNAPS);
  const parsed = JSON.parse(json);
  assert.equal(parsed.schema, SNAPSHOT_EXPORT_SCHEMA);
  assert.equal(parsed.version, 1);
  assert.ok(parsed.exportedAt);
  const res = importSnapshots(json);
  assert.equal(res.error, null);
  assert.deepEqual(res.snapshots, SAMPLE_SNAPS);
  assert.equal(res.skipped, 0);
});

test('import rejects broken files but salvages valid entries from mixed ones', () => {
  assert.equal(importSnapshots('{not json').error, 'not valid JSON');
  assert.equal(importSnapshots('{"nope":1}').error, 'expected an array of snapshots or {"snapshots":[…]}');
  const mixed = JSON.stringify({
    snapshots: [
      SAMPLE_SNAPS[0],
      { id: 'bad' },                       // invalid → skipped
      SAMPLE_SNAPS[0],                     // duplicate id → skipped
      { id: 'x9', name: 'n', qs: 'q=1' }   // missing createdAt is tolerated
    ]
  });
  const res = importSnapshots(mixed);
  assert.equal(res.error, null);
  assert.equal(res.snapshots.length, 2);
  assert.equal(res.skipped, 2);
  assert.equal(res.snapshots[1].id, 'x9');
});

test('mergeSnapshots appends new ids and keeps existing entries on collision', () => {
  const existing = [SAMPLE_SNAPS[0]];
  const imported = [
    { id: 'x1', name: 'hijack attempt', qs: 'evil=1', createdAt: 999 },
    SAMPLE_SNAPS[1]
  ];
  const merged = mergeSnapshots(existing, imported);
  assert.equal(merged.length, 2);
  assert.equal(merged[0].name, '4090 fp16 32k ctx'); // existing wins
  assert.deepEqual(merged[1], SAMPLE_SNAPS[1]);
});

test('saveSnapshots returns true on success so callers can detect failure', () => {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, v)
  };
  try {
    assert.equal(saveSnapshots(SAMPLE_SNAPS), true);
  } finally {
    delete globalThis.localStorage;
  }
});

// ---------- #569: total restore planning ----------

test('planRestore flags absent speed keys and unresolved presets', () => {
  const plan = planRestore('preset=nope404&sim=2', { presets: [{ id: 'rtx4090_exl2' }] });
  assert.equal(plan.settings.sim, 2);
  assert.deepEqual(plan.resets, ['prefill', 'decode']);
  assert.equal(plan.unresolvedPreset, 'nope404');

  const full = planRestore('preset=rtx4090_exl2&prefill=3800&decode=105', { presets: [{ id: 'rtx4090_exl2' }] });
  assert.deepEqual(full.resets, []);
  assert.equal(full.unresolvedPreset, null);

  // lmx: ids are runtime-resolved — never flagged as unresolved here.
  const lmx = planRestore('preset=lmx:abc123&prefill=100', { presets: [] });
  assert.equal(lmx.unresolvedPreset, null);
  assert.deepEqual(lmx.resets, ['decode']);

  // No preset at all: nothing to flag.
  const bare = planRestore('prefill=50', { presets: [{ id: 'rtx4090_exl2' }] });
  assert.equal(bare.unresolvedPreset, null);
  assert.deepEqual(bare.resets, ['decode']);
});
