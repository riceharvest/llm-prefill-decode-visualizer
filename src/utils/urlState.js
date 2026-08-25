// Lightweight URL query-param helpers for shareable per-tab settings.
// Settings are written with history.replaceState so the URL always reflects
// the current state without spamming browser history.

export function readParam(name) {
  const p = new URLSearchParams(window.location.search);
  return p.get(name);
}

export function readParamNum(name, fallback) {
  const v = readParam(name);
  if (v === null || v === '') return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export function readParamBool(name, fallback) {
  const v = readParam(name);
  if (v === null || v === '') return fallback;
  return v === '1' || v === 'true';
}

// ?sim= time-scale multiplier: 'instant' or a positive finite number.
// Zero/negative/garbage values fall back to 1x instead of pinning the sim
// clock at/below 0 so the simulation never completes (#1040). Shared by /
// (App) and /embed (EmbedApp) so both entry points agree on one URL.
export function readSimMultiplier() {
  const v = readParam('sim');
  if (v === 'instant') return 'instant';
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

// Consume the ?autoplay=1 demo-link flag exactly ONCE per page load.
// Every simulator used to re-read the raw param at mount, so ?autoplay=1
// re-fired its start timer every time you navigated away from a tab and
// back (#818), while tab=ab ignored the flag entirely (#693). Callers
// auto-start only when this returns true; later mounts get false.
let autoplayConsumed = false;
export function consumeAutoplay() {
  if (autoplayConsumed) return false;
  if (readParamBool('autoplay', false)) {
    autoplayConsumed = true;
    return true;
  }
  return false;
}

export function writeParams(updates) {
  const p = new URLSearchParams(window.location.search);
  for (const [k, v] of Object.entries(updates)) {
    if (v === undefined || v === null || v === '') {
      p.delete(k);
    } else {
      p.set(k, String(v));
    }
  }
  const qs = p.toString();
  // Preserve any location hash (#s/<slug> permalinks, ?tab=theory#<anchor>
  // deep links) across param rewrites (#919) — building the URL from
  // pathname+search alone silently dropped it on every mount-time sync.
  const hash = window.location.hash || '';
  const base = qs
    ? `${window.location.pathname}?${qs}`
    : window.location.pathname;
  window.history.replaceState(null, '', `${base}${hash}`);
}

// Build a shareable "try it" URL for a demo: sets the given params and marks
// autoplay so the target tab starts its simulation on load.
export function demoUrl(params) {
  const p = new URLSearchParams(params);
  p.set('autoplay', '1');
  return `${window.location.pathname}?${p.toString()}`;
}

// Cross-view share-link fidelity (#445 #446): which query params each view
// owns, plus a pure helper that scopes a query string down to one view's
// params plus the global ones. Every visualizer merges its params into ONE
// shared query string and nothing prunes them, so after touring the views a
// share link carried the union of everything ever visited (~30 params) — a
// Diff link shipped 25 params Diff ignores, and five different workload
// namespaces (prompt/sprompt/bprompt/cp/abp) coexisted in one URL (#446).
// The registry below doubles as the machine-readable manifest mapping each
// view to its param names.
export const GLOBAL_URL_PARAMS = [
  'tab', 'preset', 'prefill', 'decode', 'lang', 'autoplay',
  // The LocalMaxxing preset picker is mounted on every tab, so its state is global.
  'lmxOrder', 'lmxModel', 'lmxQuant', 'lmxRun', 'lmxHw'
];

// Tabs that render SpeedControls + EngineFlagPicker: only these consume the
// time-scale multiplier and engine-flag selection, so only these keep
// ?sim=/?flags= in their share links (#448's "flags ride into views that
// have no control for them").
export const SIMULATOR_TABS = ['single', 'agentic', 'batching', 'compare', 'ab'];

export const TAB_URL_PARAMS = {
  single: ['prompt', 'output', 'spec', 'draftK', 'acc', 'ctx', 'ctxHalf', 'img', 'imgN', 'imgRes', 'jit', 'jitPct'],
  agentic: ['turns', 'sprompt', 'tool', 'thought', 'cache'],
  batching: ['breqs', 'bprompt', 'bgen', 'bmax', 'bchunk', 'barr'],
  compare: ['hwA', 'hwB', 'cp', 'co', 'batch', 'piA', 'poA', 'piB', 'poB', 'tcoHw', 'tcoW', 'tcoKwh', 'tcoCloud', 'tcoCapex', 'tcoAmort', 'qtm'],
  ab: ['abA', 'abB', 'abp', 'abo'],
  diff: ['runA', 'runB'],
  shortlist: ['sd', 'sv', 'sm', 'sq'],
  kvcache: ['model', 'ctx', 'prec', 'batch', 'wp', 'gpu', 'oh', 'wgb', 'vram', 'gpus', 'par', 'bus', 'card', 'wprec'],
  theory: []
};
// Known cross-view key collisions (ctx: single-turn ↔ kvcache, batch:
// compare ↔ kvcache — see #669/#837): a shared link from EITHER tab keeps
// such keys. Disambiguating them is its own issue and deliberately not
// changed here.

// Pure: filter a query string down to the active view's params + globals.
// Used where links LEAVE the app (share button, embed snippet); the live
// address bar keeps accumulating so in-session state still survives tab
// switches — only what gets shared is scoped.
export function scopeShareSearch(search, activeTab) {
  const allowed = new Set(GLOBAL_URL_PARAMS);
  for (const k of TAB_URL_PARAMS[activeTab] || []) allowed.add(k);
  if (SIMULATOR_TABS.includes(activeTab)) {
    allowed.add('sim');
    allowed.add('flags');
  }
  const src = new URLSearchParams(search || '');
  const out = new URLSearchParams();
  for (const [k, v] of src) {
    if (allowed.has(k)) out.append(k, v);
  }
  return out.toString();
}
