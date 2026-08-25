// Settings history + named snapshots (#96).
//
// Every change to the shareable simulation settings (preset, prefill tok/s,
// decode tok/s, sim speed multiplier, engine flags) is recorded on an undo
// stack driven by ctrl+z / ctrl+shift+z. Snapshots are named configurations
// the user explicitly saves ('4090 fp16 32k ctx'); they serialize to the same
// URL query format used by writeParams(), so a snapshot's "copy link" output
// restores it anywhere and undo entries round-trip through permalinks for free.
//
// Everything here is pure (no window access except in the guarded localStorage
// helpers) so the history/serialization logic is unit-testable under node:test.

export const HISTORY_LIMIT = 100;

function toNumOrNull(v) {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Canonical settings shape shared by the URL writer, history and snapshots. */
export function makeSettings(settings = {}) {
  const { preset = '', prefill = null, decode = null, sim = 1, flags = [] } = settings || {};
  return {
    preset: preset || '',
    prefill: toNumOrNull(prefill),
    decode: toNumOrNull(decode),
    sim: sim === 'instant' ? 'instant' : (toNumOrNull(sim) ?? 1),
    flags: Array.isArray(flags) ? flags.filter(Boolean) : []
  };
}

/** Serialize settings to a query string (no leading '?') matching writeParams(). */
export function serializeSettings(settings) {
  const s = makeSettings(settings);
  const p = new URLSearchParams();
  if (s.preset) p.set('preset', s.preset);
  if (s.prefill !== null) p.set('prefill', String(s.prefill));
  if (s.decode !== null) p.set('decode', String(s.decode));
  if (s.sim !== 1) p.set('sim', String(s.sim));
  if (s.flags.length > 0) p.set('flags', s.flags.join(','));
  return p.toString();
}

/** Parse a settings query string back into the canonical shape. */
export function parseSettings(qs) {
  const p = new URLSearchParams(qs || '');
  return makeSettings({
    preset: p.get('preset') || '',
    prefill: p.get('prefill'),
    decode: p.get('decode'),
    sim: p.get('sim') === null ? 1 : p.get('sim'),
    flags: (p.get('flags') || '').split(',').filter(Boolean)
  });
}

export function settingsEqual(a, b) {
  return serializeSettings(a) === serializeSettings(b);
}

// ---------------------------------------------------------------------------
// History stack: { past: [queryString], future: [queryString] }
// Entries are serialized settings strings; `current` lives outside the stack
// (it IS the live state), so undo moves current→future and past→current.
// ---------------------------------------------------------------------------

export function createHistory() {
  return { past: [], future: [] };
}

/** Record a transition: the previous state joins `past`, the redo branch dies. */
export function recordChange(history, previousQs) {
  const past = [...history.past, previousQs];
  if (past.length > HISTORY_LIMIT) past.splice(0, past.length - HISTORY_LIMIT);
  return { past, future: [] };
}

/** Returns { qs, history } or null when there is nothing to undo. */
export function undo(history, currentQs) {
  if (history.past.length === 0) return null;
  return {
    qs: history.past[history.past.length - 1],
    history: {
      past: history.past.slice(0, -1),
      future: [currentQs, ...history.future].slice(0, HISTORY_LIMIT)
    }
  };
}

/** Returns { qs, history } or null when there is nothing to redo. */
export function redo(history, currentQs) {
  if (history.future.length === 0) return null;
  return {
    qs: history.future[0],
    history: {
      past: [...history.past, currentQs].slice(-HISTORY_LIMIT),
      future: history.future.slice(1)
    }
  };
}

// ---------------------------------------------------------------------------
// Named snapshots, persisted to localStorage. Each snapshot stores its name
// plus the same serialized query string the URL-sharing format uses.
// ---------------------------------------------------------------------------

export const SNAPSHOT_STORAGE_KEY = 'llmpdv.snapshots.v1';

function validSnapshot(s) {
  return s && typeof s === 'object' && typeof s.id === 'string'
    && typeof s.name === 'string' && typeof s.qs === 'string';
}

/** Load snapshots from localStorage; returns [] when unavailable/corrupt. */
export function loadSnapshots() {
  try {
    const raw = globalThis.localStorage?.getItem(SNAPSHOT_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(validSnapshot) : [];
  } catch {
    return [];
  }
}

/** Persist snapshots; returns false when storage is unavailable/full so
 *  callers can surface the failure instead of silently losing data (#566). */
export function saveSnapshots(list) {
  try {
    globalThis.localStorage?.setItem(SNAPSHOT_STORAGE_KEY, JSON.stringify(list));
    return true;
  } catch {
    // storage full/blocked: keep the in-memory list working anyway
    return false;
  }
}

// ---------------------------------------------------------------------------
// History persistence (#565): the undo/redo stack used to live only in React
// state, so one reload wiped the whole trail. It now persists alongside the
// named snapshots and is restored on mount.
// ---------------------------------------------------------------------------

export const HISTORY_STORAGE_KEY = 'llmpdv.history.v1';

function sanitizeHalf(arr) {
  if (!Array.isArray(arr)) return [];
  return arr.filter(qs => typeof qs === 'string').slice(-HISTORY_LIMIT);
}

/** Coerce arbitrary parsed input into a { past, future } history (pure). */
export function sanitizeHistory(raw) {
  if (!raw || typeof raw !== 'object') return createHistory();
  return { past: sanitizeHalf(raw.past), future: sanitizeHalf(raw.future) };
}

/** Load the persisted undo/redo stack; empty history when unavailable/corrupt. */
export function loadHistory() {
  try {
    const raw = globalThis.localStorage?.getItem(HISTORY_STORAGE_KEY);
    if (!raw) return createHistory();
    return sanitizeHistory(JSON.parse(raw));
  } catch {
    return createHistory();
  }
}

/** Persist the undo/redo stack; returns false when storage failed (#565). */
export function saveHistory(history) {
  const storage = globalThis.localStorage;
  if (!storage) return false;
  try {
    const h = sanitizeHistory(history);
    storage.setItem(
      HISTORY_STORAGE_KEY,
      JSON.stringify({ past: h.past, future: h.future })
    );
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Snapshot export/import (#566) — escape hatch from localStorage-only storage:
// a portable JSON envelope other devices/profiles can import back.
// ---------------------------------------------------------------------------

export const SNAPSHOT_EXPORT_SCHEMA = 'llmpdv.snapshots';

/** Portable JSON envelope for the snapshot library (stable field order). */
export function exportSnapshots(list) {
  return JSON.stringify({
    schema: SNAPSHOT_EXPORT_SCHEMA,
    version: 1,
    exportedAt: new Date().toISOString(),
    snapshots: (Array.isArray(list) ? list : []).filter(validSnapshot)
  }, null, 2);
}

/**
 * Parse an exported snapshot file. Returns { snapshots, skipped, error } —
 * valid entries only, duplicate ids inside the file keep their first
 * occurrence, `error` is a human string for structurally-broken input.
 */
export function importSnapshots(text) {
  let parsed;
  try {
    parsed = JSON.parse(String(text ?? ''));
  } catch {
    return { snapshots: [], skipped: 0, error: 'not valid JSON' };
  }
  const arr = Array.isArray(parsed) ? parsed : parsed?.snapshots;
  if (!Array.isArray(arr)) {
    return { snapshots: [], skipped: 0, error: 'expected an array of snapshots or {"snapshots":[…]}' };
  }
  const seen = new Set();
  const snapshots = [];
  let skipped = 0;
  for (const entry of arr) {
    if (!validSnapshot(entry)) { skipped++; continue; }
    if (seen.has(entry.id)) { skipped++; continue; }
    seen.add(entry.id);
    snapshots.push({ id: entry.id, name: entry.name, qs: entry.qs, createdAt: entry.createdAt });
  }
  return { snapshots, skipped, error: null };
}

/**
 * Merge imported snapshots into the existing library (pure): existing order
 * preserved, new ids appended; on id collision the existing snapshot wins.
 */
export function mergeSnapshots(existing, imported) {
  const byId = new Map((Array.isArray(existing) ? existing : []).map(s => [s.id, s]));
  const merged = [...(Array.isArray(existing) ? existing : [])];
  for (const snap of Array.isArray(imported) ? imported : []) {
    if (!byId.has(snap.id)) {
      byId.set(snap.id, snap);
      merged.push(snap);
    }
  }
  return merged;
}

// ---------------------------------------------------------------------------
// Restore planning (#569): restoring used to be a silent partial merge —
// absent params kept current values and unresolved preset ids were dropped
// without a trace. planRestore() makes the outcome computable and testable.
// ---------------------------------------------------------------------------

/**
 * Compute what applying a snapshot's query string WILL do, before touching
 * any state: which keys it sets, which absent keys must fall back to defaults
 * (`resets`), and whether its preset id resolves against `presets`.
 * Pure — App applies the plan; SnapshotsSidebar renders it.
 */
export function planRestore(qs, { presets = [] } = {}) {
  const s = parseSettings(qs);
  const presetKnown = !s.preset || s.preset.startsWith('lmx:') ||
    presets.some(p => p.id === s.preset);
  const resets = [];
  if (s.prefill === null) resets.push('prefill');
  if (s.decode === null) resets.push('decode');
  return { settings: s, presetKnown, resets, unresolvedPreset: presetKnown ? null : s.preset };
}
