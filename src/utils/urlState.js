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

// Issues #432/#434: shared parsers so every entry point validates URL values
// identically instead of each component hand-rolling coercion.

// Truthy/falsy spellings beyond the historical exact '1'/'true': a shared
// link written by a human (?cache=yes|on|True) must not silently flip the
// default. Unrecognized values fall back rather than coercing to false.
const BOOL_TRUE = new Set(['1', 'true', 'yes', 'on', 'y', 't']);
const BOOL_FALSE = new Set(['0', 'false', 'no', 'off', 'n', 'f']);

export function parseBoolParam(v, fallback) {
  if (v === null || v === undefined || v === '') return fallback;
  const s = String(v).toLowerCase();
  if (BOOL_TRUE.has(s)) return true;
  if (BOOL_FALSE.has(s)) return false;
  return fallback;
}

export function readParamBool(name, fallback) {
  return parseBoolParam(readParam(name), fallback);
}

// Positive finite number or fallback: speeds are physical tok/s, so 0 and
// negatives are invalid input (?prefill=0 / ?decode=-500), not settings.
export function parsePositiveNum(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function readParamPosNum(name, fallback) {
  return parsePositiveNum(readParam(name), fallback);
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
  const url = qs ? `${window.location.pathname}?${qs}` : window.location.pathname;
  window.history.replaceState(null, '', url);
}

// Build the /api/og query for og:image / twitter:image. Issue #435: the card
// must carry every workload param the OG endpoint actually honors (it reads
// preset/prefill/decode/scenario/prompt), so a shared link's preview reflects
// the shared prompt size instead of silently rendering the 2k default.
export function ogImageParams(currentSearch, { preset, prefill, decode }) {
  const sp = new URLSearchParams(currentSearch || '');
  const qs = new URLSearchParams({
    preset,
    prefill: String(prefill),
    decode: String(decode)
  });
  const prompt = parsePositiveNum(sp.get('prompt'), null);
  if (prompt !== null) qs.set('prompt', String(prompt));
  return qs;
}

// Issue #431: the Compare tab and the KV-cache tab both read/wrote ?batch=,
// so switching tabs silently overwrote each other's saved batch size. The
// KV-cache tab now owns ?kvb=; ?batch= stays Compare-only. Legacy kvcache
// share links (batch=N with no Compare-tab hwA/hwB state) still restore.
export function readKvBatchSize(currentSearch) {
  const sp = new URLSearchParams(currentSearch || '');
  if (sp.get('kvb') !== null) return parsePositiveNum(sp.get('kvb'), 1);
  if (sp.get('hwA') === null && sp.get('hwB') === null) {
    return parsePositiveNum(sp.get('batch'), 1);
  }
  return 1;
}

// Build a shareable "try it" URL for a demo: sets the given params and marks
// autoplay so the target tab starts its simulation on load.
export function demoUrl(params) {
  const p = new URLSearchParams(params);
  p.set('autoplay', '1');
  return `${window.location.pathname}?${p.toString()}`;
}
