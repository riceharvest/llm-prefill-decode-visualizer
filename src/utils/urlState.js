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

// Build a shareable "try it" URL for a demo: sets the given params and marks
// autoplay so the target tab starts its simulation on load.
export function demoUrl(params) {
  const p = new URLSearchParams(params);
  p.set('autoplay', '1');
  return `${window.location.pathname}?${p.toString()}`;
}

// Tabs whose simulator actually consumes the global PREFILL/DECODE sliders.
// compare and ab render no simulation driven by those sliders (#664), so the
// controls are hidden there instead of sitting dead on the page.
export const SPEED_CONTROL_TABS = ['single', 'agentic', 'batching'];

export function consumesSpeedControls(tab) {
  return SPEED_CONTROL_TABS.includes(tab);
}

// KV-cache context length in tokens. Read from the namespaced `kvCtx=` key;
// falls back to the legacy shared `ctx=` key for pre-#669 links, ignoring the
// boolean spellings ('1'/'0'/'true'/'false') that belong to single-turn's
// context-scaling toggle so one view can never poison the other (#669).
export function readKvContextLength(fallback) {
  const parseNum = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
  };
  const v = readParam('kvCtx');
  if (v !== null && v !== '') return parseNum(v);
  const legacy = readParam('ctx');
  if (legacy === null || legacy === '') return fallback;
  if (legacy === '1' || legacy === 'true' || legacy === '0' || legacy === 'false') return fallback;
  return parseNum(legacy);
}
