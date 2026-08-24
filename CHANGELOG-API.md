# API Changelog & Deprecation Policy

All JSON responses from `/api/*` are versioned. This document tracks schema
changes and defines how breaking changes are announced.

## Current version: `1`

Every JSON response carries the schema version in two places:

| Where               | Value                          |
| ------------------- | ------------------------------ |
| Response body       | top-level `schema_version` field (string, e.g. `"1"`) |
| Response header     | `X-Schema-Version: 1`          |

The header is present even on error responses and preflight (`OPTIONS`)
responses, so a client can check compatibility without parsing the body.
Both are exposed to browser clients via `Access-Control-Expose-Headers`.

## Two version numbers (release version vs wire schema version)

This API publishes **two independent version numbers** that answer different
questions. They are intentionally decoupled — seeing different values is not
a bug:

| | `info.version` in `/api/spec` | Wire schema version |
| --- | --- | --- |
| Current value    | `2.6.0` | `"1"` |
| Defined in       | `api/_handlers/spec.js` (`info.version`) | `api/_schema.js` (`SCHEMA_VERSION`) |
| Carried on wire  | only inside `/api/spec` (`info.version`; the wire version is mirrored there as `info.x-schema-version`) | every JSON response: top-level `schema_version` body field + `X-Schema-Version` header |
| Answers          | "Which release of the API *surface* is this?" (endpoints, parameters, docs) | "Which contract do the response *bodies* follow?" |
| Bumps on         | every release that changes the surface — new endpoints, new optional params, new docs features (semver: minor for additions, patch for fixes) | breaking response-body changes only (removed/renamed fields, type/unit/semantic changes) — see [Versioning policy](#versioning-policy) |

**Mapping:** API releases `2.x` all speak wire schema version `"1"`. Additive
releases bump `info.version` (e.g. `2.5.0 → 2.6.0`) while
`schema_version` stays `"1"`; when a response-body breaking change ships,
`SCHEMA_VERSION` increments (to `"2"`) independently of `info.version`.

**Which one should you check?**

- Machine consumers gating on **response shape** (parsing bodies) should read
  `schema_version` / `X-Schema-Version` from each response — never parse
  against an assumed shape without checking it.
- Humans and agents tracking **features and endpoints** should read
  `info.version` from `/api/spec` and this changelog.
- A mismatch between what you expect is always signalled by the wire value,
  not by `info.version`: if `schema_version` differs from the major you were
  built against, re-read this file's changelog before parsing.

## Versioning policy

- **Additive changes do NOT bump the version.** Adding new fields to a
  response, new optional query parameters, or new endpoints is
  backward-compatible. Clients must ignore unknown fields.
- **Breaking changes bump the major version.** This means:
  - removing or renaming an existing field,
  - changing a field's type (e.g. number → string) or unit,
  - changing the semantics of an existing field,
  - removing an endpoint or a query parameter.
- When a breaking change ships, `SCHEMA_VERSION` in `api/_schema.js` is
  incremented, this file gets an entry, and — where feasible — the previous
  major version is served in parallel (e.g. at a versioned path or via a
  version query parameter) for a **minimum of 90 days**.

## Deprecation process

When an endpoint or schema version is deprecated, responses from it set:

| Header       | Meaning                                                                 |
| ------------ | ----------------------------------------------------------------------- |
| `Deprecation`| `@<unix-seconds>` — when the deprecation was announced (draft-ietf-httpapi-deprecation-header) |
| `Sunset`     | HTTP-date after which the old surface may stop responding (RFC 8594)   |
| `Link`       | `<url>; rel="deprecation"` — migration notes (this file)               |

Machine consumers should log the presence of a `Deprecation` header and
migrate before `Sunset`. Agents can discover the current policy at
`/api/spec` and in `/llms.txt`.

## Changelog

### Unreleased (additive — no version bump)

- Partial batch failure recovery on `/api/compute` (#964): failed batch items
  now echo their input (`inputs` for object items, `input` for non-object
  values) and carry a deterministic per-item id (the same hash a standalone
  call with those params would mint), so a subset retry correlates by id even
  though positional indexes renumber. ApiError extras (`available[]` and
  friends) are preserved onto failed-item entries instead of being dropped. A
  new optional top-level `batchId` request parameter pins the response id: all
  attempts under the same `batchId` return the same id regardless of which
  item subset is sent, and `GET /api/calc/<id>?batchId=<batchId>` verifies the
  id from the batchId alone (full batch payloads replay as before). Batch ids
  without `batchId` are now hashed from deep-canonicalized array content
  instead of a lossy `String()` coercion. Additive fields; `schema_version`
  stays `"1"`.
- Affected endpoints: `/api/compute`, `/api/agent/compute.json`, `/api/calc/<id>`.

- `/api/spec` now annotates every operation with a machine-readable
  `x-rate-limit` extension: `{ enforced, limit, windowSeconds, keying, scope }`
  plus, for metered endpoints, the `X-RateLimit-*` header names and the 429
  exhaustion shape (`onExhaustion.status/retryAfterHeader/errorCode/response`
  ref to the shared RateLimited response). A root-level `x-rate-limit` carries
  the global default. Values derive from the live limiter constants in
  `api/_ratelimit.js`; `enforced` is asserted against actual handler source by
  `api/_spec_rate_limit.test.js`. Additive — no version bump.
- Affected endpoints: `/api/spec` only.

- New `GET /api/version` endpoint: machine-readable version report for agents
  and clients — service name, app `version` (package.json), `schemaVersion`
  (the wire schema_version stamped on every JSON response), `generatedAt`
  timestamp and links to `/api/spec`, `CHANGELOG-API.md` and this changelog's
  JSON twin. Additive endpoint; no existing fields changed.
- New root-level `CHANGELOG.json`: machine-readable keep-a-changelog-style
  projection of `CHANGELOG-API.md` (unreleased bullets + versioned entries
  with date/note/changes), so agents can read the API history without parsing
  markdown. Drift-tested against this file by `api/_changelog.test.js`.
- Affected endpoints: `/api/version`.
- New `GET /api/agent/freshness.json` endpoint: agent-readable data-freshness
  and confidence report (alias: `/api/agent/confidence.json`, same handler).
  Wraps the existing freshness/confidence machinery (`groupFreshness()` +
  staleness tiers, `confidenceFor()`/`aggregate()`, upstream cache state) —
  flat JSON with `description`, `generatedAt`, echoed `filters`, a `cache`
  block, dataset-wide `dataset`, per-group `groups[]` (freshness + 0-100
  confidence with high/medium/low grades) and a cross-group `summary`.
  Filters: `?hardware=`, `?model=`, `?quant=`, `?context_band=`, `?max_age=`,
  `?groupBy=hardware|model|hardwareModel`, `?snapshot=`.
- Affected endpoints: `/api/agent/freshness.json`, `/api/agent/confidence.json`.
- Every agent-facing JSON response body now carries a machine-readable
  `rate_limit` object — `{ limit, remaining, reset, window_seconds, policy }`
  — mirroring the existing `X-RateLimit-*` headers, for clients that only
  parse bodies (MCP tools, body-only HTTP wrappers). Present whenever the
  handler ran `enforceRateLimit` (i.e. on all standard `/api/*` handlers);
  absent otherwise. Additive field; `schema_version` stays `"1"`. Also
  documented in the "Rate limits" section of public/llms.txt.
- New `GET /api/agent/benchmarks.json` endpoint: agent-friendly wrapper around
  the raw community run search (same data/functionality as the MCP
  `search_runs` tool / `GET /api/localmaxxing`). Flat per-run records with
  tok/s speeds, freshness stamps (`ageDays`, `staleness`), echoed filters,
  cursor pagination and pointers to the related `/api/benchmarks`, `/api/best`
  and `/api/spec` endpoints. Filters mirror `search_runs`: `?hardware=`
  (substring), `?model=` (substring), `?quant=` (exact) plus the shared
  `?context_band=`, `?max_age=`, `?limit=`, `?cursor=`, `?snapshot=`.
- Affected endpoints: `/api/agent/benchmarks.json`.
- New `GET /api/agent/capabilities.json` endpoint: a machine-readable
  discovery document listing every agent-facing surface of the app — JSON API
  endpoints, the MCP server (`/api/mcp`, `/.well-known/mcp.json`), feeds,
  manifests and docs — with methods, kind, and descriptions. Static and
  CDN-cached (1h); follows the standard schema-version stamping.
- Affected endpoints: `/api/agent/capabilities.json`.
- Documented the two independent version numbers (#113-style clarity pass):
  `/api/spec` `info.version` (`2.6.0`, the API *release* version) vs the wire
  contract `schema_version` / `X-Schema-Version` (`"1"`, from
  `SCHEMA_VERSION` in `api/_schema.js`). New section "Two version numbers"
  above explains the mapping and bump rules; the spec now also carries
  `info.x-schema-version` so machine consumers can see both numbers in one
  place without hardcoding either.

- New `GET /api/runs` endpoint: one-shot machine-readable dump of the **full**
  run index — every community-measured run, comparable AND batched/
  non-comparable — as JSON (`?format=json`, envelope with `schemaVersion`,
  `generatedAt`, `rowCount`, `totalRunCount`, `comparableCount`, structured `dataDictionary`,
  per-run `comparable` flag) or RFC 4180 CSV (`?format=csv`, `#`-preamble with
  metadata + data dictionary, dated attachment). Optional
  `?comparable=true|false|all` subsets server-side. Shares the cached upstream
  fetch with the other benchmark endpoints. Additive — no version bump.
- Affected endpoints: `/api/runs`.
- New `GET /api/og` endpoint (#105): renders a 1200x630 PNG Open Graph chart
  card from URL params (`preset`, `prefill`, `decode`, `scenario`, `prompt`)
  via @vercel/og. Binary image response (`image/png`, not JSON/schema-
  versioned); errors use the standard problem+json shape. Cached by a sha256
  of the normalized config in memory and at the CDN via long-lived immutable
  Cache-Control headers.
- Affected endpoints: `/api/og`.
- New watch-feed endpoints (#109): `POST/GET/DELETE /api/watch` (subscribe to a
  hardware+model combo, list combos, unsubscribe with the one-time secret),
  `GET /api/watch/rss.xml?model=&hardware=&quant=&days=` (RSS 2.0 feed of new
  community runs for that pair) and `GET|POST /api/watch/dispatch`
  (cron-friendly webhook delivery of unseen matching runs, signed with
  `X-Watch-Secret`; optional `WATCH_DISPATCH_SECRET` locks it down). Additive
  endpoints — no version bump.
- `/api/benchmarks` and `/api/best` rows now carry a `dataQuality` block
  (`status: ok|flagged`, `flaggedRuns`, `flagCounts`, affected runIds) from
  the new unit-consistency audit; `/api/benchmarks` adds a top-level
  `unitAudit` summary. `/api/localmaxxing` submissions are audited at ingest
  and queue with a stored `unitAudit`; flagged submissions still return 202
  with an extra warning.
- Affected endpoints: `/api/benchmarks`, `/api/best`, `/api/localmaxxing`.
- Schema-drift audit (#319): `components.schemas` in `/api/spec` now declares
  every field the endpoints actually emit. Newly documented (wire shapes were
  unchanged — docs-only, additive): `Caveat.severity` gains the `warning`
  value the caveat builder has always emitted; `BenchmarkGroupListEnvelope`
  documents `matchedRuns`, `warnings`, `maxAgeDays`, `contextBand`,
  `distinctModelFamilies`, `distinctEngines`, `engineCohortedByDefault`,
  `freshnessTiers`, `outlierPolicy` and `unitAudit`; `BenchmarkGroup` and
  `BestResult` document `runsInStats`, `outliersExcludedFromStats`,
  `outlierIqrs`, `includeOutliers`, `outliers`, `contextBands`, `freshness`,
  `engines`, `engineVersion`, `mixedEngines`, `mixedContextBands`,
  `dataQuality` and the scenario walltime block (`ttftSeconds`,
  `decodeSeconds`, `projectedWalltimeSeconds`,
  `effectiveThroughputTokPerSec`, `prefillSharePct`, `decodeSharePct`);
  `BestListEnvelope` documents `maxAgeDays` + `contextBand`.
  Guarded by `api/_handlers/spec.wire-drift.test.js`, which generates real
  wire responses offline and fails if an emitted field is missing from the
  schema or a severity falls outside the enum.
- Affected endpoints: `/api/benchmarks`, `/api/best`, `/api/localmaxxing` (docs only).

### 1 — 2026-08-21

- Initial versioned schema. All `/api/*` JSON responses now include a
  top-level `schema_version: "1"` field and an `X-Schema-Version: 1` header.
- No breaking changes; this is the baseline every future change is measured
  against.
- Affected endpoints: `/api/compute`, `/api/presets`, `/api/localmaxxing`,
  `/api/benchmarks`, `/api/best`, `/api/spec`.

### 1 — 2026-08-22 (additive, no version bump)

- Context-length banding (#39): every run now carries a `contextBand` field
  (`lt1k`, `1k-8k`, `8k-32k`, `32k+`, or `null` when the run reports no usable
  contextLength). Aggregated groups carry a `contextBands` mix block and a
  `mixedContextBands` boolean; mixed groups surface a `mixed_context_bands`
  caveat and warning so cross-band comparisons aren't read as apples-to-apples.
- New optional query parameter `?context_band=lt1k|1k-8k|8k-32k|32k+` on
  `/api/localmaxxing`, `/api/benchmarks` and `/api/best`. Unknown values
  return 400 (`INVALID_PARAMS`).
- 2026-08-22 (additive, no version bump): new `GET /api/parse-constraints`
  (#65) — parses plain-language constraints into the canonical constraint
  struct with an explicit `ambiguities` array and a ready-made
  `/api/sizing` query string. New endpoint; no existing fields changed.
