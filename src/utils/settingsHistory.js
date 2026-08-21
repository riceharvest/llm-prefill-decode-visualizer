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

/** Persist snapshots; silently no-ops without localStorage (tests, SSR). */
export function saveSnapshots(list) {
  try {
    globalThis.localStorage?.setItem(SNAPSHOT_STORAGE_KEY, JSON.stringify(list));
  } catch {
    // storage full/blocked: keep the in-memory list working anyway
  }
}
