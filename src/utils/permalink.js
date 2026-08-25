// Titled permalinks (issue #106). A share link is the current query-string
// state plus a human-readable `title` param built from the live config, so a
// pasted link reads like content ("Qwen3 32B Q4 on RTX 4090, 8K agentic loop")
// instead of a query string. Everything stays client-side: no backend storage,
// the URL itself is the storage. A cosmetic slug rides along in the hash
// (#s/qwen3-32b-rtx4090-8k-agentic-loop) so permalinks have a readable
// identity even though the app routes purely through query params.

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

// Per-tab workload params (#1060): each tab encodes its "workload context
// size" under a different URL param, and the generated title must quote the
// ACTIVE tab's own value — never a leftover `prompt=` from a past single-turn
// visit riding along in the accumulated query string (#445).
const TAB_WORKLOAD_PARAMS = {
  single: ['prompt'],
  agentic: ['sprompt', 'turns'], // per-turn base prompt × turns = loop workload
  batching: ['bprompt'],
  compare: ['cp'],
  kvcache: ['ctx']
};

/**
 * Token count that feeds describeConfig's workload phrase for a tab.
 * `getParam(name)` returns the raw URL value (string|null) so this stays
 * unit-testable outside the browser. Returns a number, or undefined when the
 * active tab has no workload param (the phrase is then omitted entirely
 * instead of quoting a foreign tab's leftover value).
 */
export function workloadTokensForTab(activeTab, getParam) {
  const names = TAB_WORKLOAD_PARAMS[activeTab];
  if (!names || typeof getParam !== 'function') return undefined;
  const readNum = (name) => {
    const v = Number(getParam(name));
    return Number.isFinite(v) && v > 0 ? v : NaN;
  };
  const base = readNum(names[0]);
  if (!Number.isFinite(base)) return undefined;
  if (names.length === 1) return base;
  // Multiplier params (agentic turns): non-positive/garbage falls back to 1.
  let mult = 1;
  for (let i = 1; i < names.length; i++) {
    const m = readNum(names[i]);
    if (Number.isFinite(m)) mult *= m;
  }
  return base * mult;
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

// Title → URL slug: "Qwen3 32B Q4 on RTX 4090, 8K agentic loop"
//   → "qwen3-32b-q4-on-rtx4090-8k-agentic-loop"
export function slugifyTitle(title) {
  const slug = String(title || '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  // Cap length on a word boundary so slugs stay copy-paste friendly.
  if (slug.length <= 80) return slug;
  const cut = slug.slice(0, 81);
  const lastDash = cut.lastIndexOf('-');
  if (lastDash > 40) return cut.slice(0, lastDash);
  return cut.slice(0, 80).replace(/-+$/, '');
}

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

// The title encoded into a shared link, if any (readParam-style decoding).
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
