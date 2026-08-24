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
    surfaces: ['run A/B selectors', 'delta table', 'what-if constraint diffing'],
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
  return lines.join('\n');
}

/** Render the full generated tail replacing the old `### Interactive page`. */
export function renderTabsTail(tabs = TABS) {
  return [
    '## App tabs (interactive page)',
    '',
    'The human-facing UI is this same site. Deep links carry state via URL params: `?tab=<id>`, `preset=<hardware-id>`, `prompt=`, `output=`, `spec=1&draftK=&acc=`. Keyboard: Space play/pause, R reset, Ctrl+Z undo, Ctrl+Shift+Z redo, 1–9 and 0 switch tabs, ? opens the shortcuts dialog.',
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
