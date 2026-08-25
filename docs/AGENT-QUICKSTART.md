# Agent Quickstart — llm-prefill-decode-visualizer

A guide for AI agents (and humans in a hurry) that want to discover what this
project can do, call its HTTP API, and verify their changes locally.

Base URL: `https://llm-prefill-decode-visualizer.vercel.app`
Auth: none · CORS: enabled (`*`) · Format: JSON (add `?format=md` or send
`Accept: text/markdown` on most GET endpoints for human-readable markdown).

---

## 1. Discover capabilities

Before calling anything, discover the surface. All three sources below are
kept in sync with the code, and CI tests assert that every advertised route
actually exists:

| What | Where |
|---|---|
| Machine-readable capability manifest | `https://llm-prefill-decode-visualizer.vercel.app/agents.json` |
| Plain-text overview for LLMs | `https://llm-prefill-decode-visualizer.vercel.app/llms.txt` |
| Full OpenAPI 3.1 spec (derive everything from this) | `https://llm-prefill-decode-visualizer.vercel.app/api/spec` |

In the repo itself: `public/agents.json`, `public/llms.txt`, and the dispatcher
in `api/[...path].js` are the source of truth.

## 2. Key endpoints

The whole API is served by a single catch-all serverless function
(`api/[...path].js`) that dispatches to handlers in `api/_handlers/`.
A `/v1/` prefix is accepted and stripped (`/api/v1/compute` ≡ `/api/compute`).

### Inference math

```
GET /api/compute?model=singleTurn&promptTokens=2048&outputTokens=512&prefillTps=5000&decodeTps=80
GET /api/vram?model=llama3.1&contextLength=32768&precision=fp16
GET /api/diff?a=<calcId>&b=<calcId>
```

- `model=` accepts `singleTurn`, `speculative`, `batched`, `agentic`,
  `kvCache`. Omit `model` entirely to get a self-describing capability list.
- `POST /api/compute` with `{"batch": [ …up to 50 parameter sets… ]}` returns
  per-index results.
- **Partial batch failure recovery**: a failed batch item echoes its input
  (`inputs`, or `input` for non-object items) and carries a deterministic
  per-item id plus ApiError extras such as `available[]`. Resend just the
  failed subset under the same top-level `batchId` string to keep the same
  response id across attempts (indexes renumber; per-item ids do not), and
  verify it any time via `GET /api/calc/<id>?batchId=<batchId>`.
- Every calculation returns an id you can re-fetch later:
  `GET /api/calc/<id>`

### Measured data & recommendations

```
GET /api/localmaxxing?hardware=4090&limit=5
GET /api/benchmarks?groupBy=hardware
GET /api/best?by=decode&maxParamsB=8
GET /api/sizing?model=llama3.1&contextLength=32768&concurrency=4
GET /api/snapshots
GET /api/presets
```

- `/api/localmaxxing` — raw community-measured runs; no params = hardware summary.
- `/api/benchmarks` — aggregated median + IQR per hardware×model group.
- `/api/best` — ranked rigs for a workload; `by=` ∈ decode, prefill,
  efficiency, walltime, confidence.
- `/api/sizing` — pass a workload SLO, get ranked rigs with meetsSlo flags.
- `/api/snapshots` — pin `?snapshot=<id>` on any data endpoint for
  reproducible results.

### Agent-first endpoints

```
GET /api/agent/benchmarks.json?hardware=h100&limit=3
```

Flat, cursor-paginated records designed for tool use rather than the UI.

### Utility

```
GET /api/health
GET /api/mcp
```

`/api/health` is a cheap liveness probe whose `ok:true` only means the handler
itself is up. Gate on the readiness fields instead: `readiness`
(`ready | degraded | starting`) and `degraded` mirror `upstreamFreshness.status`
(`fresh | stale | empty`), `warming:true` means the dataset has never loaded on
this instance, and `components` reports `{upstreamCache, watchStore,
submitQueue}` so watch/submission outages are visible without blind probes.
Cold-start note: on a fresh serverless instance health answers instantly with
`warming:true` while the first real data call (`GET /api/runs?limit=1`) blocks
on a full upstream crawl — warm up with that cheap call and retry on
`UPSTREAM_UNAVAILABLE`. `/api/mcp` exposes a Model
Context Protocol endpoint if your agent speaks MCP.

## 3. Conventions

- **Errors** follow RFC 9457 `application/problem+json` with machine-readable
  codes (`INVALID_PARAMS`, `RATE_LIMITED`, `UPSTREAM_UNAVAILABLE`, …).
- **Rate limits**: best-effort ~120 req/60s per instance; responses carry
  `X-RateLimit-*` headers and `Retry-After` when limited.
- **Pagination**: `?limit=N` (default 50, max 500) + opaque `cursor`;
  responses carry `items[]`, `has_more`, `next_cursor`, `total`.

---

## 4. Run the test suite locally

Prerequisites: Node.js ≥ 18, npm ≥ 9. Then `npm install` once.

```bash
# Unit tests (node's built-in test runner — includes the doc-existence tests)
node --test "**/*.test.js"

# Lint
oxlint

# Production build (also regenerates the sitemap)
npm run build   # = node scripts/generate-sitemap.mjs && vite build
```

All three must pass before opening a PR.

## 5. Doc-existence guarantee

`tests/docs-agent-quickstart.test.js` parses **this document**, extracts every
example API URL, and fails CI if any of them does not exist as a route in
`api/[...path].js`. If you add or rename an endpoint, update this file in the
same commit — the tests will keep both sides honest.
