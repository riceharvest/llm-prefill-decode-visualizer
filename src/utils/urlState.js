// Lightweight URL query-param helpers for shareable per-tab settings.
// Settings are written with history.replaceState so the URL always reflects
// the current state without spamming browser history. Shareable URLs are
// minted exclusively by buildShareLink() (utils/permalink.js, #875).

import { buildShareLink } from './permalink.js';

export function readParam(name) {
  const p = new URLSearchParams(window.location.search);
  return p.get(name);
}

export function clampNum(n, min, max) {
  // Non-finite input is garbage: fall back to the lower bound (deterministic,
  // never NaN-poisons the simulation state); with no bounds at all, fall back to 0.
  const num = Number(n);
  if (!Number.isFinite(num)) {
    if (typeof min === 'number') return min;
    return 0;
  }
  n = num;
  if (typeof min === 'number') n = Math.max(min, n);
  if (typeof max === 'number') n = Math.min(max, n);
  return n;
}

// Numeric URL param with optional [min, max] clamp. Malformed values fall back
// unchanged; out-of-range values are clamped so crafted share links
// (?breqs=99999999, ?turns=-5) can't drive O(n) allocation or negative loops
// in the visualizers (issues #1040, #1059, #1078).
export function readParamNum(name, fallback, min, max) {
  const v = readParam(name);
  if (v === null || v === '') return fallback;
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return clampNum(n, min, max);
}

// Shared ?sim= playback-speed reader for every entry point (/ and /embed).
// Accepts 'instant' or a positive finite multiplier; 0, negatives and garbage
// fall back to 1x instead of pinning the simulation clock below zero forever
// (issues #1039, #1040).
export function readSimSpeed() {
  const v = readParam('sim');
  if (v === 'instant') return 'instant';
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 1;
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
  // deep links) across param rewrites (#919) - building the URL from
  // pathname+search alone silently dropped it on every mount-time sync.
  const hash = window.location.hash || '';
  const url = qs ? `${window.location.pathname}?${qs}` : window.location.pathname;
  window.history.replaceState(null, '', `${url}${hash}`);
}

// Build a shareable "try it" URL for a demo: routes through the canonical
// share-link builder (#875) with the given params as the full state and marks
// autoplay so the target tab starts its simulation on load.
export function demoUrl(params) {
  return buildShareLink({
    origin: window.location.origin,
    pathname: window.location.pathname,
    params,
    autoplay: true
  });
}
