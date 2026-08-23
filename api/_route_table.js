/**
 * Central route table — single source of truth for every /api/* route.
 *
 * `public/agents.json` is GENERATED from this table by
 * `scripts/generate-agents-json.mjs`; a drift test
 * (`api/_route_table.test.js`) fails CI when the committed agents.json no
 * longer matches what this table describes, or when the dispatcher in
 * `api/[...path].js` gains/loses a case without a matching entry here.
 *
 * `sinceVersion` semantics:
 *   The API release version (as reported by `/api/spec` → info.version) in
 *   which the route first became available on the wire. Values are derived
 *   from CHANGELOG-API.md and the commit that introduced each handler;
 *   refine them as the changelog grows — the format is enforced by test.
 *
 *   1.0.0 — agent API v2 baseline era (2026-08-21): compute, presets,
 *           localmaxxing, benchmarks, best, spec plus the same-day additions
 *           diff (#12), sizing (#3), snapshots (#20), health (#28),
 *           export (#30), vram (#52), calc/:id (#68).
 *   1.1.0 — parse-constraints (#65) and og (#105)/watch family (#109)
 *           landed while schema v1 was current; og/watch shipped in the
 *           next released line.
 *   2.6.0 — mcp endpoint (agent-readiness pass, current release).
 */

export const ROUTES = [
  // --- Agent API v2 baseline (1.0.0) -------------------------------------
  {
    path: '/compute',
    methods: ['GET', 'POST'],
    description: 'Run inference math. ?model=singleTurn|speculative|batched|agentic|kvCache plus parameters. No model param returns a self-describing capability list. POST {"batch": [up to 50 parameter sets]} returns per-index results with per-item ok/error status.',
    sinceVersion: '1.0.0',
  },
  {
    path: '/presets',
    methods: ['GET'],
    description: 'Built-in hardware speed presets (RTX 4090, dual RTX 3090, M3 Ultra, Groq LPU, H100, RPi5) and workload scenarios (RAG, code generation). Feed these into /api/compute.',
    sinceVersion: '1.0.0',
  },
  {
    path: '/localmaxxing',
    methods: ['GET', 'POST'],
    description: 'Community-measured single-stream benchmark runs with normalized model families. GET: no params = hardware summary; ?hardware=&model=&quant=&limit=N filters. POST: submit a new run for community benchmarking (queued, unit-audited at ingest).',
    sinceVersion: '1.0.0',
  },
  {
    path: '/benchmarks',
    methods: ['GET'],
    description: 'Aggregated median + IQR speeds per hardware×model group (outlier-resistant). ?groupBy=hardware|model|quant.',
    sinceVersion: '1.0.0',
  },
  {
    path: '/best',
    methods: ['GET'],
    description: 'Ranked answers: ?by=decode&maxParamsB=8&quant=q4_k_m → top rigs for ≤8B models at Q4_K_M.',
    sinceVersion: '1.0.0',
  },
  {
    path: '/diff',
    methods: ['GET'],
    description: 'Compare two runs or configurations side by side; also accepts what-if parameters to compare a stored run against hypothetical hardware/settings.',
    sinceVersion: '1.0.0',
  },
  {
    path: '/export',
    methods: ['GET'],
    description: 'One-click full-dataset export at ?format=csv|json with an accompanying data dictionary.',
    sinceVersion: '1.0.0',
  },
  {
    path: '/health',
    methods: ['GET'],
    description: 'Uptime/status probe backing the status page: service liveness plus dataset freshness signals.',
    sinceVersion: '1.0.0',
  },
  {
    path: '/sizing',
    methods: ['GET'],
    description: 'One-call hardware sizing recommendation: pass a workload spec (?model=<family>&contextLength=&concurrency=&maxTtftSeconds=&maxTpotMs=&maxVramGb=) and get ranked rigs with required-VRAM math, expected TTFT/TPOT from benchmark medians, sample confidence, and meetsSlo flags.',
    sinceVersion: '1.0.0',
  },
  {
    path: '/snapshots',
    methods: ['GET'],
    description: 'Versioned dataset snapshot IDs. All data endpoints accept ?snapshot=<id> (and return a snapshot object) for reproducible, citable results.',
    sinceVersion: '1.0.0',
  },
  {
    path: '/spec',
    methods: ['GET'],
    description: 'Full OpenAPI 3.1 spec — derive all endpoints from this.',
    sinceVersion: '1.0.0',
  },
  {
    path: '/vram',
    methods: ['GET'],
    description: 'Combined model weights + KV-cache + context VRAM estimate from just {hfId, context, quant}.',
    sinceVersion: '1.0.0',
  },
  {
    path: '/calc/:id',
    methods: ['GET'],
    description: 'Replay a previously computed result by its stable deterministic ID (calc_<sha256-12> minted by /api/compute and /api/best).',
    sinceVersion: '1.0.0',
  },

  // --- Additive wave under schema v1 (1.1.0) ------------------------------
  {
    path: '/parse-constraints',
    methods: ['GET'],
    description: 'Parses plain-language constraints into the canonical constraint struct with an explicit ambiguities array and a ready-made /api/sizing query string.',
    sinceVersion: '1.1.0',
  },
  {
    path: '/og',
    methods: ['GET'],
    description: 'Renders a 1200x630 PNG Open Graph chart card from URL params (preset, prefill, decode, scenario, prompt). Binary image/png response; errors use problem+json.',
    sinceVersion: '1.1.0',
  },
  {
    path: '/watch',
    methods: ['GET', 'POST', 'DELETE'],
    description: 'Watch-feed subscriptions. GET: list combos. POST: subscribe to a hardware+model combo (returns a one-time secret). DELETE ?id=&secret=: unsubscribe.',
    sinceVersion: '1.1.0',
  },
  {
    path: '/watch/rss.xml',
    methods: ['GET'],
    description: 'RSS 2.0 feed of new community runs for a subscribed pair: ?model=&hardware=&quant=&days=.',
    sinceVersion: '1.1.0',
  },
  {
    path: '/watch/dispatch',
    methods: ['GET', 'POST'],
    description: 'Cron-friendly webhook delivery of unseen runs matching active watches, signed with X-Watch-Secret; optional WATCH_DISPATCH_SECRET env locks it down.',
    sinceVersion: '1.1.0',
  },

  // --- Current release (2.6.0) --------------------------------------------
  {
    path: '/mcp',
    methods: ['GET', 'POST'],
    description: 'Model Context Protocol server endpoint. POST JSON-RPC 2.0 tool calls (initialize, tools/list, tools/call); GET returns server metadata.',
    sinceVersion: '2.6.0',
  },
];

/** Flattened view: one entry per (method, path) pair, sorted for stable output. */
export function flattenRoutes(routes = ROUTES) {
  const flat = [];
  for (const route of routes) {
    for (const method of route.methods) {
      flat.push({
        method,
        path: `/api${route.path}`,
        description: route.description,
        sinceVersion: route.sinceVersion,
      });
    }
  }
  flat.sort((a, b) => (a.path === b.path ? a.method.localeCompare(b.method) : a.path.localeCompare(b.path)));
  return flat;
}
