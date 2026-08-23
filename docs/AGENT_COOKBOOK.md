# Agent API Cookbook

Copy-paste curl recipes for every agent-facing endpoint of the
LLM Prefill & Decode Speed Visualizer API.

All endpoints return JSON, support CORS (`Access-Control-Allow-Origin: *`),
require no auth, and are also served under a `/v1/` prefix (e.g. `/v1/compute`)
with identical behavior. Machine-readable contract: `GET /api/spec` (OpenAPI).
Errors follow RFC 9457 `application/problem+json` with a stable machine-readable
`code` — see the **Error codes** table at the bottom of this file.

## Base URL

```bash
# Local dev (plain `npm run dev`, Vite on port 5173). NOTE: the Vite dev
# middleware mounts only these six endpoints: /api/compute, /api/presets,
# /api/benchmarks, /api/best, /api/localmaxxing, /api/spec.
export BASE=http://localhost:5173

# All other endpoints require the full serverless runtime:
#   npx vercel dev          # then use BASE=http://localhost:3000
# or the deployed host:
# export BASE=https://llm-prefill-decode-visualizer.vercel.app
```

Every response carries:

| Header | Meaning |
| --- | --- |
| `X-Schema-Version` | Wire schema version (`"1"`); body carries `schema_version` too |
| `X-RateLimit-Limit` | Requests/min budget (120) — only on rate-limited endpoints |
| `X-RateLimit-Remaining` | Remaining requests this window |
| `X-RateLimit-Reset` | Epoch seconds when the window resets |
| `Retry-After` | Only on `429` responses |

Rate limiting is best-effort and per serverless instance (fixed window keyed by
client IP): 120 req/min. Exceeding it returns `429` with `Retry-After`.

---

## `GET /api/compute`

Run inference math: TTFT, TPOT, walltime, VRAM for a parameter set. Models:
`singleTurn`, `speculative`, `batched`, `agentic`, `kvCache`, `flagged`, `cost`.
Call without `model` to get the self-describing capability list.

```bash
curl -s "$BASE/api/compute?model=singleTurn&promptTokens=2048&outputTokens=512&prefillSpeed=3800&decodeSpeed=105"
```

Expected response (200):

```json
{
  "id": "calc_211894c46904",
  "inputs": { "promptTokens": 2048, "outputTokens": 512, "prefillSpeed": 3800, "decodeSpeed": 105 },
  "warnings": [],
  "ttftSeconds": 0.538947,
  "tpotMs": 9.52381,
  "decodeSeconds": 4.87619,
  "totalWalltimeSeconds": 5.415138,
  "effectiveThroughputTokPerSec": 472.748815,
  "schema_version": "1"
}
```

Add `&dry_run=true` to validate inputs and echo them back without executing any
math (the response carries the same deterministic `id` a real call would return):

```bash
curl -s "$BASE/api/compute?model=agentic&numTurns=6&enablePrefixCaching=true&dry_run=true"
```

Unknown models fail with problem+json (see error table):

```bash
curl -s "$BASE/api/compute?model=nope"
# 400 -> { "type": ".../problems/invalid-params", "code": "INVALID_PARAMS",
#          "status": 400, "detail": "Unknown model 'nope'", ... }
```

## `POST /api/compute` (batch)

Compare up to 50 variants in one call. Each item is a normal parameter set with
its own `model`. Per-item results — one bad item does not fail the batch.

```bash
curl -s -X POST "$BASE/api/compute" \
  -H 'Content-Type: application/json' \
  -d '{"batch":[{"model":"singleTurn","promptTokens":1024},{"model":"kvCache","architecture":"llama70b","contextLength":131072}]}'
```

Expected response (200):

```json
{
  "id": "calc_ecdd2705fbbf",
  "batch": true,
  "count": 2,
  "okCount": 2,
  "errorCount": 0,
  "results": [
    { "index": 0, "ok": true, "result": { "id": "calc_c6d613093a29", "...": "..." } },
    { "index": 1, "ok": true, "result": { "..." : "..." } }
  ]
}
```

## `GET /api/presets`

Built-in hardware speed presets and workload scenario presets. Use these values
as inputs to `/api/compute`.

```bash
curl -s "$BASE/api/presets"
```

```json
{
  "description": "Built-in hardware speed presets and workload scenario presets...",
  "hardware": [
    { "id": "rtx4090_exl2", "name": "RTX 4090 24GB (ExLlamaV2 EXL2)",
      "prefillSpeedTokPerSec": 3800, "decodeSpeedTokPerSec": 105 }
  ],
  "schema_version": "1"
}
```

## `GET /api/vram`

Combined model weights + KV-cache + context VRAM from just an HF repo id.

```bash
curl -s "$BASE/api/vram?hfId=meta-llama/Llama-3.1-8B-Instruct&context=32768&quant=q4_k_m"
```

```json
{
  "inputs": { "hfId": "meta-llama/Llama-3.1-8B-Instruct", "context": 32768,
              "quant": "q4_k_m", "batchSize": 1, "kvPrecisionBytes": 2 },
  "model": { "hfId": "meta-llama/Llama-3.1-8B-Instruct", "family": "llama3.1-8b" }
}
```

## `GET /api/calc/{id}`

Replay a computation from its deterministic id (`calc_` + 12 hex chars of
sha256 over the normalized request). Ids are not stored — resend the original
parameters alongside the id and the endpoint re-runs the math and sets
`verified: true`.

```bash
curl -s "$BASE/api/calc/calc_211894c46904?endpoint=compute&model=singleTurn&promptTokens=2048&outputTokens=512&prefillSpeed=3800&decodeSpeed=105"
```

```json
{ "id": "calc_211894c46904", "verified": true, "ttftSeconds": 0.538947 }
```

## `GET /api/localmaxxing`

Raw community benchmark runs (flattened, model-normalized). Filter with
`?hardware=&model=&quant=&context_band=&max_age=&limit=&cursor=`.

```bash
curl -s "$BASE/api/localmaxxing?hardware=4090&limit=20"
```

```json
{
  "snapshot": { "id": "snapshot-2026-08-23-36e2b8e6", "runCount": 3637 },
  "totalComparableRuns": 3637,
  "caveats": [ { "code": "mixed_context_bands", "severity": "warning" } ],
  "hardwareGroups": [ ],
  "schema_version": "1"
}
```

## `GET /api/runs`

One-shot machine-readable dump of the FULL run index — comparable AND
batched/non-comparable runs (`api/_handlers/runs.js`). Params:
`?format=json|csv` (default json), `?comparable=all|true|false` (default all).
JSON envelope: `{ schemaVersion, generatedAt, comparableFilter, rowCount,
totalRunCount, comparableCount, dataDictionary, runs }`; every run carries a
`comparable` boolean so consumers can reproduce (or skip) the single-stream
filter. CSV is RFC 4180 with a `#`-comment metadata preamble + data dictionary,
served as a dated attachment. Shares the cached upstream fetch with the other
benchmark endpoints.

```bash
curl -s "$BASE/api/runs?comparable=true" | head -c 400
```

## `GET /api/benchmarks`

Aggregated speeds: median + IQR + 95% bootstrap CI per group. Cursor pagination
via `next_cursor`. First call fetches upstream data and can take tens of
seconds; warm calls hit an instance-local snapshot cache.

```bash
curl -s "$BASE/api/benchmarks?by=decode&limit=5"
```

```json
{
  "snapshot": { "id": "snapshot-2026-08-23-36e2b8e6", "runCount": 3637 },
  "total": 1014,
  "matchedRuns": 3637,
  "groups": [ ],
  "next_cursor": null,
  "has_more": false,
  "schema_version": "1"
}
```

## `GET /api/best`

Ranked answers: fastest (`by=decode`) or cheapest (`by=cost`) rigs for given
constraints. Medians carry 95% bootstrap CIs; responses carry a deterministic
replayable `id`.

```bash
curl -s "$BASE/api/best?by=decode&maxParamsB=8&quant=q4_k_m"
```

```json
{
  "id": "calc_88d8fab8b5c4",
  "rankedBy": "decode",
  "matchedRuns": 972,
  "results": [ ],
  "caveats": [ ],
  "schema_version": "1"
}
```

## `GET /api/sizing`

Hardware sizing recommendation for a workload spec (VRAM fit + expected
TTFT/TPOT from community medians).

```bash
curl -s "$BASE/api/sizing?model=qwen&quant=q4_k_m&users=10&budgetUsd=1500"
```

```json
{
  "workload": { "model": "qwen", "contextLength": 8192, "concurrency": 10 },
  "matchedRuns": 560,
  "recommendations": [ ]
}
```

No comparable data fails with a helpful 404:

```json
{ "error": "No comparable benchmark runs match model='...'. Try a broader substring." }
```

## `GET /api/parse-constraints`

Parse plain-language constraints into the canonical constraint struct used by
`/api/sizing` and `/api/best`. Deterministic regex/heuristics — no LLM calls.

```bash
curl -s "$BASE/api/parse-constraints?q=self-hosted%20Qwen%2027B%20at%20Q4%20for%2010%20users%20under%20%241500"
```

```json
{
  "input": "self-hosted Qwen 27B at Q4 for 10 users under $1500",
  "recognizedCount": 6,
  "constraints": { "deployment": "self-hosted", "modelFamily": "qwen", "paramsB": 27,
                   "quantization": "q4", "concurrency": 10, "budgetUsdMax": 1500 },
  "ambiguities": [ ],
  "sizingQuery": "..."
}
```

## `GET /api/diff`

Diff two measured runs (`runA`/`runB`, ids from `/api/localmaxxing`), or two
what-if constraint sets in what-if mode.

```bash
curl -s "$BASE/api/diff?runA=<runIdA>&runB=<runIdB>"
curl -s "$BASE/api/diff?mode=whatif&a=fitCheck=true%26contextLength=8192%26paramsB=8&b=fitCheck=true%26contextLength=131072%26paramsB=8"
```

What-if mode returns only the deltas (options entering/leaving the feasible
set, VRAM headroom changes) plus the resolved constraint summary per side:

```json
{
  "mode": "whatif",
  "a": { "constraints": { "fitCheck": "true", "contextLength": "8192" }, "matchedRuns": 3021 },
  "b": { "constraints": { "fitCheck": "true", "contextLength": "131072" }, "matchedRuns": 734 }
}
```

## `GET /api/export`

Full comparable dataset as a downloadable file. `?format=json` for structured
JSON (envelope + data dictionary), default CSV (RFC 4180 with `#` metadata
preamble). Sets `Content-Disposition: attachment`.

```bash
curl -s "$BASE/api/export?format=json" -o runs.json
curl -s "$BASE/api/export" -o runs.csv
```

```json
{ "description": "Full comparable dataset...", "schemaVersion": 1,
  "generatedAt": "2026-08-23T10:24:59.624Z", "rowCount": 3637, "dataDictionary": [ ] }
```

## `GET /api/watch`

List registered watches (hardware+model combos with RSS/webhook delivery).

```bash
curl -s "$BASE/api/watch"
```

```json
{ "maxWatches": 500, "totalWatches": 0, "watches": [], "schema_version": "1" }
```

## `POST /api/watch`

Create a watch. Body `{ model?, hardware?, quant?, webhookUrl? }` — at least one
of `model`/`hardware` required; `webhookUrl` must be https. Returns `201` with
`watchId` + `secret` (shown exactly once; required to DELETE).

```bash
curl -s -X POST "$BASE/api/watch" \
  -H 'Content-Type: application/json' \
  -d '{"hardware":"4090","model":"qwen3"}'
```

```json
{
  "watchId": "watch_mt5nyumf_i0o8sk",
  "secret": "uJJPKeYZKQFCjiJR45ir5Q",
  "label": "4090 + qwen3",
  "rssUrl": "/api/watch/rss.xml?model=qwen3&hardware=4090",
  "matchingExistingRuns": 6,
  "schema_version": "1"
}
```

Validation failure (400, plain JSON — legacy shape, not problem+json):

```json
{ "error": "validation_failed", "errors": [ { "field": "body", "code": "type",
  "message": "request body must be a JSON object" } ], "schema_version": "1" }
```

## `DELETE /api/watch`

Remove a watch. Requires the one-time `secret` from creation.

```bash
curl -s -X DELETE "$BASE/api/watch?id=<watchId>&secret=<secret>"
```

Unknown id/secret pair → `404`.

## `GET /api/watch/rss.xml`

RSS 2.0 feed of newest matching community runs (max 50). Poll like any feed —
no registration needed. Filters mirror `/api/localmaxxing`.

```bash
curl -s "$BASE/api/watch/rss.xml?model=qwen3&hardware=4090"
```

```xml
<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>4090</title>
```

## `GET /api/watch/dispatch`

Deliver unseen matching runs to registered webhooks (cron-friendly). Optional
auth: if the `WATCH_DISPATCH_SECRET` env var is set, pass `?secret=` or the
`x-dispatch-secret` header — otherwise the call returns `401`.

```bash
curl -s "$BASE/api/watch/dispatch"
```

```json
{ "dispatched": 0, "totalNewRuns": 0, "results": [] }
```

## `GET /api/health`

Service health and upstream data freshness.

```bash
curl -s "$BASE/api/health"
```

```json
{
  "ok": true,
  "service": "llm-prefill-decode-visualizer",
  "time": "2026-08-23T10:24:59.617Z",
  "upstreamFreshness": { "status": "fresh", "ageSeconds": 1, "ttlSeconds": 600, "rowCount": 3637 }
}
```

## `GET /api/agent/capabilities.json`

Machine-readable discovery document: every agent-facing surface of the app —
JSON API endpoints, the MCP server (`/api/mcp`, `/.well-known/mcp.json`),
feeds, manifests and docs — as a structured list of
`{ path, methods, kind, description }` entries. Static by design (no upstream
fetches) and CDN-cached for 1h; carries the standard schema-version stamp.

```bash
curl -s "$BASE/api/agent/capabilities.json"
```

## `GET /api/snapshots`

Content-addressed dataset snapshot ids. Pin any data endpoint with
`?snapshot=<id>` for reproducible results (ids may expire — they live in a
bounded per-instance ring).

```bash
curl -s "$BASE/api/snapshots"
```

```json
{ "current": "snapshot-2026-08-23-36e2b8e6",
  "snapshots": [ { "id": "snapshot-2026-08-23-36e2b8e6", "createdAt": "...", "runCount": 3637 } ] }
```

## `GET /api/spec`

OpenAPI 3.1 contract describing every endpoint, including `x-error-codes`.

```bash
curl -s "$BASE/api/spec"
```

```json
{ "openapi": "3.1.0", "info": { "title": "LLM Prefill & Decode Speed Visualizer API", "version": "2.6.0" } }
```

## `GET /api/og`

Auto-generated 1200×630 PNG Open Graph chart image (server-rendered with
@vercel/og). Not JSON — use it for link previews.

```bash
curl -s "$BASE/api/og?preset=rtx4090_exl2&prefill=3800&decode=105" -o og.png
# 200 image/png
```

## `POST /api/mcp`

Model Context Protocol server (Streamable HTTP, stateless JSON-RPC):
`initialize`, `tools/list`, `tools/call`, `ping`. Tools proxy to the REST
handlers above — one implementation of every formula.

```bash
curl -s -X POST "$BASE/api/mcp" \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"compute_single_turn","arguments":{"promptTokens":2048,"outputTokens":512,"prefillSpeed":3800,"decodeSpeed":105}}}'
```

```json
{"jsonrpc":"2.0","id":1,"result":{"content":[{"type":"text","text":"{ \"ttftSeconds\": 0.538947, \"tpotMs\": 9.52381, ... }"}],"isError":false}}
```

Malformed JSON body → HTTP 400 with JSON-RPC error `-32700` ("Parse error").

---

## Error codes

Every endpoint returns RFC 9457 `application/problem+json` on failure, with a
stable machine-readable `code` agents should branch on (registry source of
truth: `api/_errors.js`, mirrored into `/api/spec` under `x-error-codes`):

| Code | HTTP status | Meaning |
| --- | --- | --- |
| `INVALID_PARAMS` | 400 | Well-formed request with invalid/missing parameters. Fix the input; retry without backoff. |
| `METHOD_NOT_ALLOWED` | 405 | HTTP method not supported on this path (e.g. POST to `/api/runs`). Check the `Allow` header; switch to GET. |
| `NOT_FOUND` | 404 | Referenced resource does not exist (e.g. unknown watch id). Do not retry unchanged. |
| `RATE_LIMITED` | 429 | Too many requests. Honor `Retry-After` (seconds), then retry with backoff. |
| `UPSTREAM_UNAVAILABLE` | 502 | Transient failure fetching community benchmark data. Safe to retry with backoff. |
| `INTERNAL` | 500 | Unexpected server error. Not actionable; retrying may or may not help. |

Problem bodies look like:

```json
{
  "type": "https://llm-prefill-decode-visualizer.vercel.app/problems/invalid-params",
  "title": "Invalid parameters",
  "status": 400,
  "detail": "Unknown model 'nope'",
  "instance": "/api/compute?model=nope",
  "code": "INVALID_PARAMS"
}
```

Legacy plain-JSON errors (`{ "error": "...", ... }`) are still returned by a
few older handlers: `/api/diff` and `/api/export` use `{ "error" }` with status
400/404/502, `/api/sizing` uses `{ "error", workload }` with 404, the router's
unknown-path fallback is `{ "error": "Not found", path }` with 404, and
`/api/watch` validation failures return
`{ "error": "validation_failed", "errors": [...] }` with 400.
The MCP endpoint (`POST /api/mcp`) speaks JSON-RPC: malformed JSON → HTTP 400
with code `-32700`. Unauthenticated dispatch (`WATCH_DISPATCH_SECRET` set but
no secret given) → HTTP 401.

## Rate limits

120 requests/min per client IP, best-effort **per serverless instance** (fixed
window — warm instances each enforce their own budget; cold starts reset it).
Rate-limited endpoints (`compute`, `presets`, `localmaxxing`, `benchmarks`,
`best`, `parse-constraints`, `spec`, `watch` incl. `rss.xml` and `dispatch`)
stamp every response with:

- `X-RateLimit-Limit`
- `X-RateLimit-Remaining`
- `X-RateLimit-Reset` (epoch seconds)

Exhaustion returns `429` + `Retry-After`. Endpoints without rate-limit headers:
`diff`, `export`, `health`, `og`, `sizing`, `snapshots`, `calc/{id}`, `mcp`.
No other rate-limit headers (quota/reset-as-HTTP-date variants) exist.
