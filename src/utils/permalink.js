// Titled permalinks + the canonical share-link builder (issues #106, #875).
// The builder (buildShareLink below) is the single emitter for shareable
// URLs. Human-readable config titles ("Qwen3 32B Q4 on RTX 4090, 8K agentic
// loop") remain a display concern only — they drive document.title and OG
// previews, never the link itself: free-text titles and slug hashes used to
// make byte-identical configs produce different URLs (#534/#875). Everything
// stays client-side: no backend storage, the URL itself is the storage.

import { HARDWARE_PRESETS } from './presets.js';
import { SHARE_SIG_PARAM, signShareParams } from './shareIntegrity.js';

// Tab ids → short human phrases used at the end of generated titles.
const TAB_TITLE_PHRASES = {
  single: 'single turn',
  agentic: 'agentic loop',
  batching: 'continuous batching',
  compare: 'hardware compare',
  ab: 'A/B replay',
  diff: 'run diff',
  shortlist: 'hardware finder',
  kvcache: 'KV cache sizing',
  theory: 'theory walkthrough',
  curriculum: 'curriculum'
};

// "Qwen/Qwen3-32B-GGUF" → "Qwen3 32B GGUF": drop the org namespace and turn
// hyphens into spaces so the title reads like prose.
export function shortModelName(modelId) {
  if (!modelId) return '';
  const bare = String(modelId).split('/').pop().trim();
  return bare.replace(/-/g, ' ').replace(/\s+/g, ' ').trim();
}

// "Q4_K_M" → "Q4", "iq3_xs" → "IQ3", "FP8" → "FP8": keep just the headline
// quant family — enough to identify the run without bloating the title.
export function shortQuant(quantization) {
  if (!quantization) return '';
  const s = String(quantization).trim();
  const leading = s.match(/^[A-Za-z]+\d+/);
  return (leading ? leading[0] : s.split(/[\s_.-]/)[0]).toUpperCase();
}

// 2048 → "2K", 8192 → "8K", 1500 → "1.5K", 512 → "512".
export function formatTokenCountShort(num) {
  const n = Number(num);
  if (!Number.isFinite(n) || n <= 0) return '';
  if (n < 1000) return String(Math.round(n));
  const k = n / 1000;
  // Token counts are usually powers of two (4096, 8192…) that convention
  // renders as 4K / 8K — snap to the whole K they're nearest when close,
  // otherwise keep one decimal (1.5K).
  const whole = Math.round(k);
  const trimmed = Math.abs(k - whole) <= 0.25
    ? String(whole)
    : k.toFixed(1).replace(/\.0$/, '');
  return `${trimmed}K`;
}

// Hardware display name for titles: preset names carry an engine suffix in
// parentheses ("RTX 3090 24GB (llama.cpp Q4_K_M)") — titles only want the rig.
function hardwareDisplayName({ presetId, hardwareLabel }) {
  if (hardwareLabel) return hardwareLabel;
  const preset = HARDWARE_PRESETS.find(p => p.id === presetId);
  if (!preset) return 'custom setup';
  const beforeParen = preset.name.split('(')[0].trim();
  return beforeParen || preset.name;
}

// Build the human-readable permalink title from the current config.
//   { modelId: 'Qwen/Qwen3-32B', quantization: 'Q4_K_M',
//     presetId: 'rtx4090_exl2', promptTokens: 8192, activeTab: 'agentic' }
//     → "Qwen3 32B Q4 on RTX 4090 24GB, 8K agentic loop"
export function describeConfig({
  presetId,
  hardwareLabel,
  modelId,
  quantization,
  promptTokens,
  activeTab
} = {}) {
  const hw = hardwareDisplayName({ presetId, hardwareLabel });
  const model = shortModelName(modelId);
  const quant = shortQuant(quantization);
  const subject = model ? `${model}${quant ? ` ${quant}` : ''} on ${hw}` : hw;

  const phrase = TAB_TITLE_PHRASES[activeTab] || '';
  const ctx = formatTokenCountShort(promptTokens);
  const workload = [ctx, phrase].filter(Boolean).join(' ');

  return workload ? `${subject}, ${workload}` : subject;
}

// Canonical share-link builder (issue #875). One builder mints every
// shareable URL in the app — header Share, snapshot copy-link, export
// deepLink and template/curriculum/changelog demo links all route through
// here, so the same effective configuration always produces a byte-identical
// link no matter which surface emitted it.
//
// Canonical shape:
//
//   <origin><pathname>?<state params, alphabetically sorted>
//
// Rules (also pinned agent-facing in public/llms.txt → "Canonical share links"):
//   - `tab` is always present: pass `tab` to pin it (overriding any tab in
//     the input state); links without it can land on the wrong view.
//   - Transient session keys (`autoplay`, `title`) are stripped on every
//     emit; demo-style links re-add `autoplay=1` explicitly via the
//     `autoplay` option after stripping.
//   - No `title=` prose param and no `#s/<slug>` hash: free-text titles made
//     byte-identical configs produce different strings (#534/#875). Titles
//     remain a display concern (document.title), never link identity.
//   - Params are sorted, so URL diffing/dedup/caching work across surfaces.
export const TRANSIENT_SHARE_PARAMS = ['autoplay', 'title'];

// Full permalink URL: current query state + `title` param + #s/<slug>.
// Since #917 the link also carries an integrity signature `h=<hex>` (HMAC over
// the canonicalized params incl. title) that App verifies on load — mutated
// links surface a "link was modified" banner instead of being accepted
// verbatim. Async because signing goes through Web Crypto; `loc` is injected
// ({ origin, pathname, search }) so this stays unit-testable outside the
// browser; callers pass window.location.
export async function permalinkHref(loc, title) {
  const p = new URLSearchParams(loc.search || '');
  p.set('title', title);
  p.set(SHARE_SIG_PARAM, await signShareParams(`?${p.toString()}`));
  const qs = p.toString();
  const base = `${loc.origin}${loc.pathname}`;
  return `${base}?${qs}#s/${slugifyTitle(title)}`;
}

export function buildShareLink({
  origin = '',
  pathname = '/',
  search = '',
  params = null,
  tab = '',
  autoplay = false
} = {}) {
  // Param source: either an explicit object (demo links define their own full
  // state) or an existing query string (share/copy/export carry live state).
  let p;
  if (params) {
    p = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
    }
  } else {
    p = new URLSearchParams(search || '');
  }
  for (const k of TRANSIENT_SHARE_PARAMS) p.delete(k);
  if (tab) p.set('tab', tab);
  if (autoplay) p.set('autoplay', '1');
  // Deterministic ordering: equal configs must serialize identically.
  const sorted = [...p.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const qs = new URLSearchParams(sorted).toString();
  return `${origin}${pathname}${qs ? `?${qs}` : ''}`;
}

// The title encoded into legacy shared links, if any. Links minted before
// #875 carried a free-text `title` param; reading it keeps those old URLs
// rendering their own document title, though new links never contain one.
export function readPermalinkTitle(search) {
  const v = new URLSearchParams(search || '').get('title');
  return v && v.trim() ? v.trim() : null;
}

// document.title policy: an opened shared link shows its own encoded title;
// otherwise the derived config title sits under the site brand. A tampered
// link (signature mismatch) is excluded from this preference — its title is
// attacker-controllable free text and must not masquerade as the app's claim.
export function documentTitleFor(sharedTitle, derivedTitle, brandTitle, tampered) {
  if (sharedTitle && !tampered) return sharedTitle;
  return derivedTitle ? `${derivedTitle} · ${brandTitle}` : brandTitle;
}
