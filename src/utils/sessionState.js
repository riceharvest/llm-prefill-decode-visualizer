// Whole-session serialize/restore across every persisted surface (#751).
//
// Share links carry URL params only; eight localStorage keys hold additional
// agent-relevant state (theme, SLO budgets, snapshots, plain-language and
// analogy preferences, changelog dismissal, quiz answers, curriculum progress)
// that no agent-facing surface documented or serialized. This module is the
// canonical single-document checkpoint:
//
//   const doc = serializeSessionState();          // machine A
//   restoreSessionState(doc);                     // machine B → same DOM
//
// PERSISTENCE_REGISTRY is the documentation contract mirrored into llms.txt by
// scripts/generate-llms-txt.mjs so the inventory can never drift from code.

export const SESSION_STATE_SCHEMA_VERSION = '1';

/**
 * One entry per persisted localStorage key.
 * shape is JSON-ish pseudo-schema; affectsOutput marks keys that change what a
 * scraper extracting text from the SAME URL would see (plain-language mode
 * rewrites strings app-wide, theme changes rendering but not text content).
 */
export const PERSISTENCE_REGISTRY = [
  {
    key: 'llmpd-theme',
    owner: 'src/utils/theme.js',
    shape: '"dark" | "light" | "high-contrast"',
    affectsOutput: false,
    description: 'Color theme choice; OS preference followed until user picks.'
  },
  {
    key: 'llmpdv.slo-budgets-v1',
    owner: 'src/utils/slo.js',
    shape: '{ ttftMs: number|null, tpotMs: number|null, walltimeSec: number|null }',
    affectsOutput: true,
    description: 'SLO budget thresholds backing the pass/fail verdict badges.'
  },
  {
    key: 'llmpdv.snapshots.v1',
    owner: 'src/utils/settingsHistory.js',
    shape: 'Array<{ id, label, at, settings }>',
    affectsOutput: false,
    description: 'Named named-snapshot library shown in the Snapshots panel.'
  },
  {
    key: 'llmpd-plain-mode',
    owner: 'src/utils/plainLanguage.js',
    shape: '"1" | absent',
    affectsOutput: true,
    description: 'Plain-language mode rewrites jargon in every UI string app-wide.'
  },
  {
    key: 'llmpd-analogy-mode',
    owner: 'src/utils/analogies.js',
    shape: '"1" | absent',
    affectsOutput: true,
    description: 'Analogy-chip preference in Theory view content.'
  },
  {
    key: 'changelog.dismissedId',
    owner: 'src/utils/changelog.js',
    shape: 'string (changelog entry id)',
    affectsOutput: true,
    description: 'Changelog banner entry the visitor dismissed.'
  },
  {
    key: 'llmpd-concept-checks-v1',
    owner: 'src/utils/conceptChecks.js',
    shape: '{ [tab]: { [checkId]: boolean } }',
    affectsOutput: false,
    description: 'Per-tab theory quiz answers.'
  },
  {
    key: 'llmpd-curriculum-progress',
    owner: 'src/utils/curriculum.js',
    shape: '{ completed: { [lessonId]: epochMs } }',
    affectsOutput: false,
    description: 'Curriculum lesson completion timestamps.'
  }
];

const REGISTRY_KEYS = PERSISTENCE_REGISTRY.map(e => e.key);

function defaultStorage() {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Capture every registered key as one serializable document.
 * Values are kept as the RAW localStorage strings (structured values are
 * JSON-encoded exactly as stored) so restore can reproduce byte-identical
 * state. Keys that are absent or unreadable are recorded as null so restore
 * knows to skip them rather than clobbering with defaults.
 */
export function serializeSessionState(storage = defaultStorage()) {
  const state = {};
  for (const key of REGISTRY_KEYS) {
    let raw = null;
    try {
      raw = storage?.getItem(key) ?? null;
    } catch {
      raw = null;
    }
    state[key] = raw;
  }
  return {
    schemaVersion: SESSION_STATE_SCHEMA_VERSION,
    capturedAt: new Date().toISOString(),
    state
  };
}

/**
 * Restore a document produced by serializeSessionState.
 * Returns { restored: string[], skipped: string[] }; unknown keys and null
 * entries are skipped so a partial checkpoint never wipes live state.
 */
export function restoreSessionState(doc, storage = defaultStorage()) {
  const restored = [];
  const skipped = [];
  if (!doc || typeof doc !== 'object' || !doc.state || typeof doc.state !== 'object') {
    return { restored, skipped };
  }
  for (const [key, value] of Object.entries(doc.state)) {
    if (!REGISTRY_KEYS.includes(key) || value === null || value === undefined) {
      skipped.push(key);
      continue;
    }
    try {
      const raw = typeof value === 'string' ? value : JSON.stringify(value);
      storage?.setItem(key, raw);
      restored.push(key);
    } catch {
      skipped.push(key);
    }
  }
  return { restored, skipped };
}
