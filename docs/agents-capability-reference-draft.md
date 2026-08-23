# AGENTS.md — Capability Reference for AI Agents

> **Draft content intended to live at the repo root as `AGENTS.md`.** Applying
> it is a one-step `git mv docs/agents-capability-reference-draft.md AGENTS.md`
> (plus updating the path in `test/agents-md.test.js`, which auto-detects
> either location) — it is blocked only because writes to agent-instruction
> files require explicit user consent.

This site is LLM inference performance math: TTFT, TPOT, walltime for single-turn
chat, agentic loops, batched serving, speculative decoding, and KV-cache VRAM —
plus community-measured hardware benchmarks. Everything is available as plain
JSON over HTTP; no browser or API key needed.

This file enumerates every agent-facing endpoint, what it returns, and how to
call it. It is derived from the actual handlers in `api/` (route table:
`api/[...path].js`, handlers: `api/_handlers/*.js`). A test
(`test/agents-md.test.js`) asserts that every endpoint, constant and file cited
below exists in the source — if this file and the code disagree, prefer the code
and file an issue.

## Base URL & conventions

- **Base URL:** `https://llm-prefill-decode-visualizer.vercel.app`
- **Auth:** none. **CORS:** `Access-Control-Allow-Origin: *` on all `/api/*`
  responses (`api/[...path].js`).
- **Versioned prefix:** every endpoint below also answers under `/v1/…`
  (e.g. `/v1/compute?model=singleTurn&…`). Same handlers, same responses
  (prefix stripped in `api/[...path].js`). External integrations should harden
  onto `/v1/`; breaking changes ship under a new prefix with 90-day
  `Deprecation`/`Sunset` overlap (see `CHANGELOG-API.md`).
- **Schema version:** every JSON body carries top-level `schema_version`
  (`"1"`, `SCHEMA_VERSION` in `api/_schema.js`) and every response carries the
  `X-Schema-Version` header — even errors and preflight. Additive changes never
  bump it; clients must ignore unknown fields.
- **Errors:** machine-readable. Data/math endpoints use RFC 9457
  `application/problem+json` with a shared error-code taxonomy (`api/_errors.js`);
  a few older endpoints return `{ error, detail? }`.
- **Rate limits:** best-effort fixed window of **120 req/min per client IP**,
  enforced per warm serverless instance (`RATE_LIMIT` in `api/_ratelimit.js`;
  the effective global limit can be higher). Responses carry
  `X-RateLimit-Limit` / `-Remaining` / `-Reset` headers; exceeding the window
  returns `429` with `Retry-After`. Back off on 429 rather than retrying
  immediately.
- **Pagination contract** (run/group listings): `?limit=N` + opaque `&cursor=`;
  responses carry `items[]`, `has_more`, `next_cursor`, `total`
  (`api/_pagination.js`).
- **Reproducibility:** data endpoints accept `?snapshot=<id>` and stamp results
  (`api/_snapshots.js`); math endpoints carry deterministic `calc_<hex>` ids
  (`api/_calc_id.js`, replayable via `/api/calc/<id>`).

## Discovery chain — read these first

| Resource | What it gives you |
| --- | --- |
| `GET /api/spec` | Full OpenAPI 3.1 spec (`api/_handlers/spec.js`) — derive every endpoint from this programmatically. Also under `/v1/spec`. |
| `GET /agents.json` | Agent-provider manifest (`public/agents.json`) listing the primary JSON endpoints, one line each. |
| `GET /llms.txt` | Human-and-machine quick-start with worked examples per endpoint (`public/llms.txt`). |
| `GET /.well-known/mcp.json` | MCP server manifest pointing at `/api/mcp`. |

---

## Inference math

### GET /api/compute?model=<name>&<params>

Runs any simulator model (`api/_handlers/compute.js`, formulas in
`api/_math.js`). All speeds are caller-supplied assumptions in tok/s — this is
arithmetic, never measurement. Results carry a non-blocking `warnings` array
(empty when plausible) flagging outputs that violate physical rooflines.

Models (`model=`, dispatch in `api/_handlers/compute.js`):

| Model | Purpose | Key params |
| --- | --- | --- |
| `singleTurn` | TTFT, TPOT, total walltime for one chat request | `promptTokens`, `outputTokens`, `prefillSpeed`, `decodeSpeed` |
| `speculative` | Effective decode speed with a draft model | `baseDecodeSpeed`, `draftTokens`, `acceptanceRate`, `draftCostFraction` |
| `batched` | Per-user vs aggregate throughput at batch size B | `prefillSpeed`, `decodeSpeed`, `batchSize`, `promptTokens`, `outputTokens` |
| `agentic` | Turn-by-turn walltime for tool-calling loops, with/without prefix caching | `numTurns`, `basePromptTokens`, `toolOutputTokensPerTurn`, `decodeTokensPerTurn`, `prefillSpeed`, `decodeSpeed`, `enablePrefixCaching` |
| `kvCache` | KV-cache VRAM for an architecture | `architecture` (`llama70b\|llama8b\|qwen72b\|mistral7b`) or explicit `numLayers`+`kvHeads`+`headDim`; plus `contextLength`, `precisionBytes` (2=FP16, 1=FP8, 0.5=INT4), `batchSize` |
| `flagged` | Engine launch-flag modeling with per-flag audit trail | `prefillSpeed`, `decodeSpeed`, `promptTokens`, `outputTokens`, `flags` (comma-separated: `flash-attn,kv-q8,kv-q4,no-mmap,vllm-fp8-kv,vllm-o3`) |
| `cost` | $/1M tokens for owned hardware (amortization + electricity) | `hardwarePriceUsd`, `electricityRatePerKwh` (default 0.15), `powerDrawWatts`, `amortizationMonths` (default 36), plus the singleTurn shape |

Example:

```
GET /api/compute?model=singleTurn&promptTokens=4096&outputTokens=512&prefillSpeed=3800&decodeSpeed=105
```

```json
{
  "schema_version": "1",
  "id": "calc_a1b2c3d4e5f6",
  "model": "singleTurn",
  "inputs": { "promptTokens": 4096, "outputTokens": 512, "prefillSpeed": 3800, "decodeSpeed": 105 },
  "ttftSeconds": 1.078,
  "tpotMs": 9.52,
  "totalSeconds": 5.95,
  "warnings": []
}
```

(Field names vary per model — treat this as the shape family: echoed `inputs`,
deterministic `id`, result fields, `warnings[]`.)

- **Bare call** (`GET /api/compute`, no `model`) returns a self-describing
  capability catalog: every model, its parameters, the batch contract,
  sanity-check codes and dry-run usage. Call this first if you're unsure.
- **Batching** — one round trip for up to 50 scenarios:
  `POST /api/compute` with `{"batch": [{"model": "singleTurn", …}, {"model": "kvCache", …}]}`
  (also accepted as `"variants"` or GET `?batch=[URL-encoded JSON]`). Each item
  carries its own `model` field. Response:
  `{batch: true, count, okCount, errorCount, results: [{index, ok, result | error}]}` —
  one bad scenario fails only itself, not the batch.
- **Dry run** — append `&dry_run=true` (or `"dry_run": true`, also per-item in a
  batch) to validate parameters and echo resolved inputs without executing math:
  `{dry_run: true, model, inputs, id?, note}`. Failures behave exactly like a
  real call — use it as a cheap preflight.
- **POST** with a plain JSON parameter object is equivalent to the GET form.

### GET /api/vram

Combined model weights + KV-cache + context VRAM from just an HF repo id —
architecture (layers, GQA heads, head dim) and weight size are resolved for you
(`api/_handlers/vram.js`, resolution in `api/_hfconfig.js` / `api/_gguf.js`).

```
GET /api/vram?hfId=meta-llama/Llama-3.1-8B-Instruct&context=65536&quant=q4_k_m
```

Returns `{ hfId, quant, contextTokens, weightsGb, kvCacheGb, totalGb, model: {…resolved architecture, resolutionSource, notes}, kvBytesPerToken }`.

- Add `&vramGb=24` → `fits: true|false` plus `maxContextTokens` that fit the
  budget (`api/_vramfit.js`).
- Add `&numTurns=40&tokensPerTurn=1200` → per-turn KV-growth projection with
  `firstContextOverflowTurn` and `firstVramOverflowTurn`.
- `quant` accepts GGUF/GPTQ tags (`fp16, fp8, q8_0, q6_k, q5_k_m, q4_k_m, q4_0, q3_k_m, q2_k…`,
  mapping in `api/_quant.js`); unknown tags assume ~4-bit and set
  `inputs.quantAssumed: true`.
- Resolution tiers, visible via `model.resolutionSource`: `builtin-table`
  (offline, common families), `huggingface` (config.json / GGUF header),
  `name-heuristic` (HF unreachable/gated; coarse estimate spelled out in
  `model.notes`). Unknown ids → 404 problem+json.

### GET /api/presets

Built-in hardware speed presets (RTX 4090, dual RTX 3090, M3 Ultra, Groq LPU,
H100, RPi5…) and workload scenario presets (RAG, chat, code generation)
(`api/_handlers/presets.js`). Feed these values into `/api/compute` or use
`scenario=<preset-id>` on `/api/best`. Response: `{ presets: [...], scenarios: [...] }`.

### GET /api/calc/<id>?<original params>

Replays any computation from its deterministic `calc_<12 hex>` id (content hash
of the resolved inputs, not a database key — `api/_calc_id.js`, handler
`api/_handlers/calc_id.js`). Re-send the original parameters; identical math
comes back stamped `verified: true`. For `/api/best` results add
`&endpoint=best`. Altered parameters are rejected with `expected` = the id they
actually hash to.

```
GET /api/calc/calc_x?model=singleTurn&promptTokens=4096  → { ..., verified: true }
```

---

## Measured benchmark data

Community-measured single-stream runs ("LocalMaxxing"; normalization in
`api/_localmaxxing.js`, freshness in `api/_freshness.js`). Freshness tiers used
across these endpoints: `fresh` <90d, `aging` <1y, `stale` ≥1y, `unknown`.

### GET /api/localmaxxing

Raw community benchmark runs with normalized model families
(`api/_handlers/localmaxxing.js`).

- No params → hardware summary (`{ summary: [...per-hardware aggregates...] }`).
- Filters: `?hardware=` (substring on rig key/label), `?model=` (substring on
  model family/HF id), `?quant=` (exact), `?engine=`, `?context_band=`,
  `?max_age=<days>`, plus pagination (`limit` default 50, max 500) and `?snapshot=`.
- Response: `{ description, filters, caveats[], items: [runs], has_more, next_cursor, total }`.
  Each run includes `runId`, `modelName/modelId/modelFamily`, `paramsB`,
  `hardware`, `hwClass`, `quantization`, `engine`, `prefillTokPerSec`,
  `decodeTokPerSec`, `contextLength`, `measuredAt`, `ageDays`, `staleness`.

### POST /api/localmaxxing

Submit a community benchmark run **for manual review** — never instant-publish
(validation in `api/_submit.js`). Body: required `model`, `hardware`, `hwClass`,
`prefillTokPerSec`, `decodeTokPerSec`, `quantization`; optional engine/context
fields. Validation failures → `400` problem+json with machine-readable codes;
success → `202 {status: "queued", submissionId}`.

### GET /api/runs

One-shot machine-readable dump of the FULL run index — comparable AND
batched/non-comparable runs (`api/_handlers/runs.js`, formatting in
`api/_runs_dump.js`). Params: `?format=json|csv` (default json),
`?comparable=all|true|false` (default all). JSON envelope:
`{ schemaVersion, generatedAt, comparableFilter, rowCount, totalRunCount,
comparableCount, dataDictionary, runs }`; every run carries a `comparable`
boolean. CSV is RFC 4180 with a `#`-comment metadata preamble + data
dictionary, served as a dated attachment. Non-GET → `405` problem+json
(`METHOD_NOT_ALLOWED`).

### GET /api/agent/capabilities.json

Machine-readable discovery document (`api/_handlers/capabilities.js`): every
agent-facing surface — JSON API endpoints, MCP server, feeds, manifests,
docs — as `{ path, methods, kind, description }` entries. Static and
CDN-cached (1h); schema-version stamped.

### GET /api/agent/compute.json

Agent-friendly wrapper over the inference math (`api/_handlers/
agent_compute.js`, wrapping `api/_handlers/compute.js`). GET with
`?model=<singleTurn|speculative|batched|agentic|kvCache|flagged|cost>` plus
params, or POST `{"batch":[...]}` (≤50 sets). Flat self-describing envelope:
`description`, `endpoint`, `generatedAt`, echoed `scenario`, resolved
`inputs`, deterministic calc id, all math fields top-level. Bare call returns
the capability catalog. Errors: shared RFC 9457 problem+json codes.

### GET /api/agent/benchmarks.json

Agent-friendly wrapper around the raw community run search — same data as the
MCP `search_runs` tool and `GET /api/localmaxxing`
(`api/_handlers/agent_benchmarks.js`). Flat per-run records with tok/s speeds
and freshness stamps (`ageDays`, `staleness`), echoed filters, cursor
pagination and pointers to `/api/benchmarks`, `/api/best`, `/api/spec`.
Filters mirror `search_runs`: `?hardware=` (substring), `?model=` (substring),
`?quant=` (exact), plus shared `?context_band=`, `?max_age=`, `?limit=`,
`?cursor=`, `?snapshot=`.

### GET /api/agent/scenario.json

Agent-friendly loader for the built-in workload scenario presets — same
`SCENARIO_PRESETS` as the UI quick-start chips and `GET /api/presets`
(`api/_handlers/agent_scenario.js`). No `?id=` → directory mode (every valid
scenario id with token counts). `?id=<preset>` → validated load with derived
`totalTokens` / `prefillShare` and pointers to `/api/compute` incl. a
ready-to-use example query. Unknown ids → 400 listing valid ids.

### GET /api/agent/freshness.json

Agent-readable data-freshness + confidence report
(`api/_handlers/agent_freshness.js`; alias `/api/agent/confidence.json`,
same handler). Flat JSON: `description`, `generatedAt`, echoed `filters`,
`cache` block, dataset-wide `dataset`, per-group `groups[]` (freshness +
0-100 confidence with grades), cross-group `summary`. Filters: `?hardware=`,
`?model=`, `?quant=`, `?context_band=`, `?max_age=`,
`?groupBy=hardware|model|hardwareModel`, `?snapshot=`.

### GET /api/agent/confidence.json

Alias for `GET /api/agent/freshness.json` — identical handler and response
shape (`api/_handlers/agent_freshness.js`). Same filters and schema.

### GET /api/version

Machine-readable version report (`api/_handlers/version.js`): service name,
app `version` (package.json), `schemaVersion`, `generatedAt`, links to
`/api/spec`, `CHANGELOG-API.md` and machine-readable `CHANGELOG.json`.

### GET /api/benchmarks

Aggregated median + IQR speeds per hardware×model group (outlier-resistant),
with confidence blocks and caveats (`api/_handlers/benchmarks.js`, aggregation
and `confidenceFor` in `api/_localmaxxing.js`, cross-checks in
`api/_crosscheck.js`). Params: `?groupBy=hardware|model|quant`,
same filters/pagination/snapshot support as above (limit default 25, max 200).
Response groups look like:
`{ key, label, sampleSize, prefill: {median, iqr, ...}, decode: {median, iqr, ...},
confidence: {score, grade, crossCheck...}, caveats[] }`.

### GET /api/best

Ranked rig recommendations (`api/_handlers/best.js`, ranking logic in `lib/` —
see the handler's imports). Example:
`/api/best?by=decode&maxParamsB=8&quant=q4_k_m` → top rigs for ≤8B models at Q4_K_M.

Params: `by=decode|prefill|efficiency|walltime|confidence`, optional
`maxParamsB`, `quant`, `hardware`, `engine`, workload shape via
`promptTokens`/`outputTokens` or `scenario=<preset-id>`, VRAM fit via
`vramBudgetGb`, plus the shared freshness/context-band/pagination params
(`api/_contextbands.js`). Each ranked row carries projected TTFT/TPOT for the
workload, VRAM-fit check, estimated street price, power estimate, confidence
score, per-row caveats (`api/_caveats.js`) and a replayable calc id. Response:
`{ description, query, items: [...], ... }`.

### GET /api/sizing

One-call hardware sizing recommendation from a workload spec
(`api/_handlers/sizing.js`):

```
GET /api/sizing?model=qwen3-32b&contextLength=32768&concurrency=10&maxTtftSeconds=2&maxVramGb=24
```

Returns ranked rigs with required-VRAM math, expected TTFT/TPOT from benchmark
medians, sample confidence, `meetsSlo` flags and human-readable explanations
(`api/_explain.js`).

### GET /api/snapshots

Versioned, content-addressed dataset snapshot ids usable as `?snapshot=<id>`
on every data endpoint for reproducible, citable reads (`api/_snapshots.js`).
Response: `{ description, current: "<id>", snapshots: [{id, createdAt, runCount}...] }`.
Old ids may expire from the bounded in-memory ring — re-read `/api/snapshots`
if a pinned id stops resolving.

### GET /api/diff

Two modes (`api/_handlers/diff.js`, logic in `api/_diff.js` / `api/_whatif.js`):

- **Run diff (default):** `GET /api/diff?runA=<id>&runB=<id>` (aliases `a`/`b`)
  → `{ description, runA, runB, diff }` where `diff` normalizes both runs to a
  reference workload and reports delta (B − A), ratio (B ÷ A) and winner per
  metric. Unknown run id → 404 with hint to browse `/api/localmaxxing`.
- **What-if:** `GET /api/diff?mode=whatif&a=<constraints>&b=<constraints>` —
  diff two `/api/best`-style constraint sets (JSON objects or URL-encoded
  query strings) and get back only the deltas: options entering/leaving the
  feasible set and per-option VRAM headroom changes.

### GET /api/export

Full comparable dataset as a download (`api/_handlers/export.js`, formatting in
`api/_export.js`): `?format=csv` (default; RFC 4180 with a `#`-comment metadata
preamble + data dictionary) or `?format=json`
(`{ dataDictionary, runs: [...], generatedAt }`). Sets
`Content-Disposition: attachment`.

### GET|POST /api/parse-constraints

Natural-language constraints → canonical constraint JSON for `/api/sizing` and
`/api/best` (`api/_parse_constraints.js`). Pure deterministic heuristics, no
external LLM.

```
GET /api/parse-constraints?q=self-hosted%20Qwen%2027B%20at%20Q4%20for%2010%20users%20under%20%241500
POST /api/parse-constraints {"q": "..."}
```

Returns `{ input, parsed: {...|null}, ambiguities: [...], sizingQuery }` —
`parsed: null` means not stated; consult `ambiguities` and ask the user instead
of guessing.

---

## Watching for new data

`api/_watch_impl.js` + handlers `api/_handlers/rss.xml.js` / `api/_handlers/dispatch.js`.

### POST /api/watch — subscribe to a hardware+model combo

```
POST /api/watch {"model": "qwen3 32b", "hardware": "rtx 4090", "webhookUrl": "https://example.test/hook"}
```

At least one of `model`/`hardware` required; `webhookUrl` (https) adds webhook
delivery on top of RSS. Response carries `watchId`, a **one-time `secret`**
(save it — required to delete) and a ready-made `rssUrl`.

- `GET /api/watch` — describes the feature, lists registered combos (no secrets).
- `DELETE /api/watch?id=&secret=` — unsubscribe.
- `GET /api/watch/rss.xml?model=&hardware=&quant=` — poll matching new runs in any feed reader.
- `POST /api/watch/dispatch` — cron-friendly fan-out: delivers unseen matching runs to each registered webhook with an `X-Watch-Secret` header.

---

## Ops, meta & MCP

### GET /api/health

Liveness + upstream data freshness, cheap (cache state only, never blocks;
`api/_handlers/health.js`, freshness in `api/_freshness.js`):
`{ ok, service, upstreamFreshness: {status: fresh|stale|empty, fetchedAt, ageSeconds, ttlSeconds, rowCount, source} }`.
Human status page: `/status.html`.

### GET /api/spec

The OpenAPI 3.1 document describing every endpoint above
(`api/_handlers/spec.js`; static dump via `scripts/dump-openapi.mjs`). If
anything in this file and the spec disagree, prefer the spec and file an issue.

### GET /api/og

Renders a 1200×630 PNG chart card from URL params
(`?preset=<hardware-id>&prefill=<tok/s>&decode=<tok/s>&scenario=<preset-id>`;
`api/_handlers/og.js`). Binary image output — useful for embedding previews,
not JSON.

### MCP server

- Manifest: `GET /.well-known/mcp.json`
- Endpoint: `POST /api/mcp` (`api/mcp.js`) — Streamable HTTP JSON-RPC
  (`initialize`, `tools/list`, `tools/call`, `ping`). Standalone server:
  `mcp/server.js`. Tools proxy to the REST endpoints, so there is exactly one
  implementation of every formula:
  - `compute_inference` → `/api/compute`
  - `search_runs` → `/api/localmaxxing`
  - `best_configs` → `/api/best`
  - `compare_hardware` → paired `/api/localmaxxing` reads + delta report

---

## Suggested agent workflow

1. Discover: read `/llms.txt`, then pull `/api/spec` for exact schemas.
2. Math questions: `GET /api/compute` (bare call first to see the catalog);
   batch related scenarios in one POST; `dry_run=true` to preflight.
3. Reality check: `/api/localmaxxing` or `/api/benchmarks` for measured speeds;
   `/api/best` / `/api/sizing` for recommendations; check `staleness` and
   `confidence` before acting on numbers.
4. Cite results by their `calc_<id>` / `snapshot=<id>` so they're reproducible.
5. Respect rate limits: honor `X-RateLimit-*` and back off on `429`.

## Repo pointers

- Source: https://github.com/riceharvest/llm-prefill-decode-visualizer
- API changelog & deprecation policy: `CHANGELOG-API.md`
- Route table: `api/[...path].js`; handlers: `api/_handlers/*.js`
