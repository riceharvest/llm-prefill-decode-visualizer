// Generates the tab-aware, agent-parseable sections of public/llms.txt.
//
// /llms.txt is mostly hand-maintained prose (endpoint docs etc.), but two
// parts are generated here so they can never drift from the actual app:
//
//   1. An agent-parseable metadata block (stable `Key: value` headers between
//      HTML-comment markers) that lists every app tab and its deep-link
//      template, so an agent can enumerate tab surfaces without parsing prose.
//   2. One `### Tab: <id> — <Label>` section per app tab describing that
//      tab's surfaces and the API endpoints backing it.
//
// The generated regions are delimited by markers and are replaced in place,
// so running this script is idempotent: same input file + same TABS registry
// => byte-identical output. `npm run build` runs it before `vite build`.
//
// The tab registry below mirrors src/components/Header.jsx MODES (ids must
// stay in sync; tests/llms-txt.test.js cross-checks both files).
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { PERSISTENCE_REGISTRY } from '../src/utils/sessionState.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'public', 'llms.txt');
const BASE_URL = 'https://llm-prefill-decode-visualizer.vercel.app';
const REPO_URL = 'https://github.com/riceharvest/llm-prefill-decode-visualizer';

const META_START = '<!-- agent-parseable:meta -->';
const META_END = '<!-- /agent-parseable:meta -->';
const TABS_START = '<!-- tabs-section:start -->';
const TABS_END = '<!-- tabs-section:end -->';
const INTERACTIVE_HEADING = '### Interactive page';

/**
 * App tab registry — one entry per tab in the UI header.
 * id: URL param value (?tab=<id>) and the canonical section key.
 * label: display label from src/components/Header.jsx MODES.
 * purpose / surfaces: what the tab shows, for agents deciding where to look.
 * endpoints: API endpoints whose data the tab visualizes ([] = pure explainer).
 * params: deep-link URL params the tab reads and writes back into the share
 *   link (#399) — optional; only tabs with addressable state list any.
 */
export const TABS = [
  {
    id: 'single',
    label: 'Single-turn',
    purpose: 'Animate one chat request end to end: prompt ingestion (prefill) sets TTFT, then token-by-token generation (decode) sets TPOT and total walltime.',
    surfaces: ['request timeline animation', 'speed controls + hardware presets', 'TTFT/TPOT/walltime metrics', 'chart + data table', 'SLO budget checks'],
    endpoints: ['GET /api/compute?model=singleTurn', 'GET /api/presets'],
  },
  {
    id: 'agentic',
    label: 'Agentic loop',
    purpose: 'Simulate a multi-turn tool-calling loop that re-ingests growing history every turn; compare walltime growth with and without prefix caching.',
    surfaces: ['turn-by-turn timeline', 'per-turn token breakdown', 'prefix-caching toggle', 'cumulative walltime chart'],
    endpoints: ['GET /api/compute?model=agentic'],
    // #424: the tab's share-link params use abbreviated names; publish the
    // mechanical mapping to the documented /api/compute params so agents can
    // turn any share link into an instant API call without reverse-engineering.
    paramMap: [
      { shareParam: 'turns', apiParam: 'numTurns' },
      { shareParam: 'sprompt', apiParam: 'basePromptTokens' },
      { shareParam: 'tool', apiParam: 'toolOutputTokensPerTurn' },
      { shareParam: 'thought', apiParam: 'decodeTokensPerTurn' },
      { shareParam: 'cache=1|0', apiParam: 'enablePrefixCaching=true|false' },
    ],
  },
  {
    id: 'batching',
    label: 'Batching',
    purpose: 'Discrete-event simulation of continuous batching + chunked prefill: concurrent requests share one accelerator, queue for batch slots, and suffer ITL spikes when a step carries a prefill chunk.',
    surfaces: ['workload controls: concurrent requests (breqs), mean prompt (bprompt) / output tokens (bgen), max batch size (bmax), chunk size (bchunk, 0=off..8192), arrival interval ms (barr)', 'metrics: makespan, avg TTFT, worst ITL, aggregate decode tok/s, batch occupancy %, avg/worst queue wait', 'per-request Gantt timeline with queue/prefill/decode segments', 'continuous-vs-static-batching comparison banner'],
    endpoints: ['GET /api/compute?model=batched (NOTE: a separate simpler B^0.25 decay approximation — it does NOT power this tab; the on-page scheduler has no API surface yet)'],
    // Issue #399: deep-link URL params the tab reads and writes back into the share link.
    params: [
      'breqs=<2–48> — concurrent requests in the batch',
      'bprompt=<128–32768> — mean prompt tokens per request',
      'bgen=<32–4096> — mean output tokens per request',
      'bmax=<1–32> — maximum batch size (concurrent decodes)',
      'bchunk=<0|128|256|512|1024|2048|4096|8192> — chunked-prefill chunk size; 0 disables chunking. The UI slider is indexed by these stops, so DOM slider position ≠ token value',
      'barr=<0–2000, ms> — interval between request arrivals',
      'sim=<1|2|5|20|instant> — playback time-scale multiplier shared by all animated tabs',
    ],
  },
  {
    id: 'compare',
    label: 'Compare',
    purpose: 'Side-by-side hardware comparison at fixed workload shapes, blending built-in presets with measured community benchmark medians.',
    surfaces: ['hardware preset table', 'measured-speed columns', 'apply-measured-speeds action', 'community run counts'],
    endpoints: ['GET /api/benchmarks', 'GET /api/best', 'GET /api/localmaxxing', 'GET /api/presets'],
  },
  {
    id: 'ab',
    label: 'A/B',
    purpose: 'Replay two hardware configs head-to-head on the identical workload so prefill/decode differences are visible as a race.',
    surfaces: ['A/B config pickers', 'synchronized replay animation', 'per-phase winner callouts'],
    endpoints: ['GET /api/compute?model=singleTurn'],
  },
  {
    id: 'diff',
    label: 'Diff',
    purpose: 'Diff two community benchmark runs (or two constraint sets via what-if mode) and read per-metric deltas plus a plain-language summary.',
    surfaces: ['run A/B free-text id inputs', 'per-metric delta rows with ratios', 'plain-language summary', 'deep links (?tab=diff&runA&runB) auto-execute on load'],
    endpoints: ['GET /api/diff?runA=<id>&runB=<id>', 'GET /api/diff?mode=whatif'],
  },
  {
    id: 'shortlist',
    label: 'Find HW',
    purpose: 'Turn a workload spec into a ranked hardware shortlist: VRAM fit, expected latency vs SLO budgets, and confidence from sample counts.',
    surfaces: ['workload/constraint form', 'ranked shortlist table', 'VRAM fit check', 'confidence badges'],
    endpoints: ['GET /api/sizing', 'GET /api/best', 'GET /api/vram', 'GET /api/parse-constraints'],
  },
  {
    id: 'kvcache',
    label: 'KV cache',
    purpose: 'Compute KV-cache VRAM for a model architecture across context lengths and quantizations, including GQA head layout.',
    surfaces: ['architecture/model picker', 'context × precision matrix', 'quant tradeoff matrix', 'multi-GPU planner'],
    endpoints: ['GET /api/vram', 'GET /api/compute?model=kvCache'],
  },
  {
    id: 'theory',
    label: 'Theory',
    purpose: 'Plain-language guide to why prefill is compute-bound and decode is bandwidth-bound, with analogies, glossary and misconception callouts.',
    surfaces: ['concept walkthrough', 'analogies toggle', 'jargon glossary', 'misconception callouts'],
    endpoints: [],
  },
];

/** Stable `Key: value` meta block an agent can grep instead of reading prose. */
export function renderMetaBlock(tabs = TABS) {
  const ids = tabs.map(t => t.id).join(',');
  return [
    META_START,
    `Base-URL: ${BASE_URL}`,
    'OpenAPI-Spec: /api/spec',
    'Agent-Manifest: /agents.json',
    'Endpoint-Index: /api/agent/index.json',
    `Tabs: ${ids}`,
    'Tab-URL-Template: {Base-URL}/?tab={id}',
    'Tab-Section-Header-Format: ### Tab: {id} — {label}',
    `Persisted-State-Keys: ${PERSISTENCE_REGISTRY.map(e => e.key).join(',')}`,
    `Repo: ${REPO_URL}`,
    META_END,
    '',
  ].join('\n');
}

/**
 * Documented inventory of every browser-localStorage key the app persists
 * (#751): share links carry URL params only, so this agent-relevant state is
 * invisible to links unless spelled out here. Single source of truth is
 * PERSISTENCE_REGISTRY in src/utils/sessionState.js.
 */
export function renderPersistenceSection() {
  const lines = [
    '## Persisted client state',
    '',
    'These browser-localStorage keys hold state that share links do NOT carry.',
    'Checkpoint/restore a whole session with serializeSessionState()/restoreSessionState()',
    'in src/utils/sessionState.js ({ schemaVersion, capturedAt, state: { [key]: rawStorageString } }).',
    '',
  ];
  for (const e of PERSISTENCE_REGISTRY) {
    lines.push(`- \`${e.key}\` — owner ${e.owner} — shape ${e.shape} — affects rendered output for the same URL: ${e.affectsOutput ? 'YES' : 'no'} — ${e.description}`);
  }
  return lines.join('\n');
}

/** Render one stable per-tab section. Keyed by `### Tab: <id>` for parsing. */
export function renderTabSection(tab) {
  const lines = [
    `### Tab: ${tab.id} — ${tab.label}`,
    '',
    `- Tab-ID: ${tab.id}`,
    `- URL: /?tab=${tab.id}`,
    `- Purpose: ${tab.purpose}`,
    `- Surfaces: ${tab.surfaces.join('; ')}`,
  ];
  if (tab.endpoints.length > 0) {
    lines.push(`- Endpoints: ${tab.endpoints.join('; ')}`);
  } else {
    lines.push('- Endpoints: none (static explainer content)');
  }
  // Issue #399: document deep-link URL params so agents can construct and
  // verify preconfigured links without reverse-engineering the share link.
  if (tab.params?.length) {
    lines.push('- URL params:');
    for (const p of tab.params) lines.push(`  - ${p}`);
  }
  if (Array.isArray(tab.paramMap) && tab.paramMap.length > 0) {
    lines.push(`- Share-param map: ${tab.paramMap.map(p => `${p.shareParam}→${p.apiParam}`).join(', ')} (tab share-link param → equivalent ${String(tab.endpoints[0] || '/api/compute').split('?')[0]} parameter; values are identical)`);
  }
  return lines.join('\n');
}

/** Render the full generated tail replacing the old `### Interactive page`. */
export function renderTabsTail(tabs = TABS) {
  return [
    '## App tabs (interactive page)',
    '',
    'The human-facing UI is this same site. Deep links carry state via URL params: `?tab=<id>`, `preset=<hardware-id>`, `prompt=`, `output=`, `spec=1&draftK=&acc=`. Keyboard: Space play/pause, R reset, Ctrl+Z undo, Ctrl+Shift+Z redo, 1–9 and 0 switch tabs, ? opens the shortcuts dialog.',
    '',
    '### Instant results on animated tabs (escape hatches)',
    '',
    'The single-turn, agentic, batching and A/B tabs animate their simulation (seconds to minutes at 1x). Two supported ways to get the final completed DOM immediately:',
    '',
    '- `?sim=instant` — URL-addressable; every animated view jumps straight to the completed state (<1 s). Works on `/` and `/embed` and composes with `autoplay=1` (e.g. `/?tab=agentic&sim=instant&autoplay=1`).',
    '- `prefers-reduced-motion: reduce` — the OS-level media query is honored by all four animated views and also forces instant completion. In headless browsers: Playwright context option `reducedMotion: \'reduce\'` or CDP `Emulation.setEmulatedMedia({features:[{name:\'prefers-reduced-motion\', value:\'reduce\'}]})`. This is environment-based (not shareable via URL), so prefer `?sim=instant` when you control the link.',
    '',
    'Both hatches produce the identical final DOM state as a full-speed run; completion is detectable via the view\'s status text ("Run complete" / phase labels).',
    '',
    '<!-- tabs-section:start -->',
    ...tabs.map(t => `${renderTabSection(t)}\n`),
    '<!-- tabs-section:end -->',
    '',
    `Source: ${REPO_URL}`,
    '',
  ].join('\n');
}

function main() {
  let doc = readFileSync(OUT, 'utf8');

  // 1. Agent-parseable meta block, anchored right before the first H2 so it
  //    sits near the top after the title/intro.
  const firstH2 = doc.indexOf('\n## ');
  if (firstH2 === -1) throw new Error('no H2 heading found in llms.txt');
  const metaBlock = renderMetaBlock();
  if (doc.includes(META_START)) {
    const start = doc.indexOf(META_START);
    const end = doc.indexOf(META_END, start);
    if (end === -1) throw new Error('unterminated agent-parseable meta block');
    // The stored block is followed by a newline already, so trimEnd() keeps
    // spacing byte-identical across runs.
    doc = doc.slice(0, start) + metaBlock.trimEnd() + doc.slice(end + META_END.length);
  } else {
    doc = doc.slice(0, firstH2) + '\n' + metaBlock + '\n' + doc.slice(firstH2 + 1);
  }

  // 2. Replace the hand-written (and chronically stale) `### Interactive page`
  //    section through end-of-file with the generated per-tab sections. On
  //    re-runs the old heading is already gone, so anchor on the generated
  //    `## App tabs` heading instead — either way everything from the anchor
  //    to EOF is regenerated.
  const anchors = [INTERACTIVE_HEADING, '## App tabs (interactive page)'];
  const idx = anchors.map(a => doc.indexOf(a)).filter(i => i !== -1).sort((a, b) => a - b)[0];
  if (idx === undefined) throw new Error('Interactive page / App tabs section not found in llms.txt');
  // The persistence inventory (#751) sits between the tab sections and the
  // Source footer; on re-runs it is inside the regenerated tail anyway.
  let tail = renderTabsTail();
  const footer = `Source: ${REPO_URL}`;
  const footIdx = tail.indexOf(footer);
  tail = tail.slice(0, footIdx) + renderPersistenceSection() + '\n\n' + tail.slice(footIdx);
  doc = doc.slice(0, idx) + tail;

  writeFileSync(OUT, doc);
  console.log(`[llms-txt] wrote ${TABS.length} tab sections + agent meta -> ${OUT}`);
}

// Run when invoked directly (`node scripts/generate-llms-txt.mjs` or via npm
// run build); stay inert when imported by tests.
const invokedDirectly =
  process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (invokedDirectly || process.env.GENERATE_LLMS_TXT === '1') {
  main();
}
