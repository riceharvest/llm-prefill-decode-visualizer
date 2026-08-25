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
  },
  {
    id: 'batching',
    label: 'Batching',
    purpose: 'Show concurrent users sharing one accelerator: per-user decode decays as batchSize^(−decodeDecayExponent) with batch size while aggregate throughput climbs — a heuristic power law with NO saturation point, so it must not be used alone to pick an optimal batch size.',
    surfaces: ['batch-size slider', 'per-user vs aggregate throughput meters', 'shared-compute animation'],
    endpoints: ['GET /api/compute?model=batched'],
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
    `Repo: ${REPO_URL}`,
    META_END,
    '',
  ].join('\n');
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
  return lines.join('\n');
}

/** Render the full generated tail replacing the old `### Interactive page`. */
export function renderTabsTail(tabs = TABS) {
  return [
    '## App tabs (interactive page)',
    '',
    'The human-facing UI is this same site. Deep links carry state via URL params: `?tab=<id>`, `preset=<hardware-id>`, `prompt=`, `output=`, `spec=1&draftK=&acc=`. Keyboard: Space play/pause, R reset, Ctrl+Z undo, Ctrl+Shift+Z redo, 1–9 and 0 switch tabs, ? opens the shortcuts dialog.',
    '',
    '**Deep-link id vocabularies (authoritative sources):**',
    '',
    '- `preset=<hardware-id>` (global): valid ids are the `hardware[].id` enum from **GET /api/presets** (`rtx4090_exl2`, `dual_rtx3090`, `rtx3090_llamacpp`, `mac_ultra`, `rtx3060_entry`, `groq`, `h100`, `rpi5`, `custom`). A value starting with `lmx:` selects a measured LocalMaxxing run.',
    '- On the `kvcache` tab: `gpu=` takes a GPU-catalog id (`rtx5090`, `rtx4090`, `rtx3090`, `rx7900xtx`, `rtx5070ti`, `rtx4060ti16`, `rtx4060`, `rtx6000ada`, `l40s`, `a100`, `h100`, `m4max128`, `m2ultra192`) and `wp=` takes one of `fp16`, `q8`, `q4`.',
    '- **Unknown-id behavior:** an unknown `preset=`, `gpu=` or `wp=` value is never silently swapped for a default and never erased from the URL. The app keeps the original value in the link, shows a visible warning banner, sets `data-invalid-param="<name>=<value>"` on the content root, logs a `console.warn`, and displays default speeds/hardware until you pick a valid id.',
    // #892: document the working instant-playback deep link so agents don't
    // pay the 5–42 s animation tax or guess the wrong spelling ('inst').
    'Playback speed is deep-linkable on every animated tab: `sim=instant` completes the animation immediately (<1 s; alias `inst` accepted — both spellings work), and numeric multipliers map to the speed buttons as `sim=1|2|5|20`. Combine with `autoplay=1` to start the run on load, e.g. `/?tab=single&autoplay=1&sim=instant` lands on finished output without waiting through real-time animation.',
  '',
    '<!-- tabs-section:start -->',
    ...tabs.map(t => `${renderTabSection(t)}\n`),
    '<!-- tabs-section:end -->',
    '',
    // #894: window-message contract for cross-origin /embed iframes.
    '## Embedding (/embed)',
    '',
    '`/embed?tab=<id>&…` serves the chrome-less visualizer for cross-origin `<iframe>` embedding. The frame talks back over `window.postMessage`; every message is a `{ type, … }` object:',
    '',
    '- Frame → parent: `{ "type": "llmpdv:ready", "tab": "<id>" }` on mount, and `{ "type": "llmpdv:state", "tab": "<id>", "playing": true|false }` whenever the tab or playback state changes.',
    '- Parent → frame: `{ "type": "llmpdv:command", "action": "play" | "pause" | "reset" | "setTab", "tab": "<id>" }` (`tab` required only for `setTab`, ignored otherwise). Commands are accepted only from the direct parent window; anything else is dropped.',
    '',
    'There is no dedicated completion event yet — start a run (`autoplay=1` or a `play` command) and watch `llmpdv:state` until `playing` flips back to `false`.',
    '',
    // #893: documented trust assumption for integrity-checking embedders.
    '## Trust assumptions (subresource integrity)',
    '',
    'No `integrity=` SRI pins ship anywhere today. Same-origin bundles under `/assets/` are content-hash-addressed by filename but not pinned in the HTML, and the Google Fonts CSS plus font binaries load cross-origin from `fonts.googleapis.com` / `fonts.gstatic.com` with no integrity attribute (their responses are UA-dependent, so no stable hash exists — self-host/proxy them if you need verifiable subresources). There is also no Content-Security-Policy header yet. This trust assumption applies to every route, including `/embed`.',
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
  doc = doc.slice(0, idx) + renderTabsTail();

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
