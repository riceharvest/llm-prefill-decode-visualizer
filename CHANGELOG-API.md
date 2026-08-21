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

### 1 — 2026-08-21

- Initial versioned schema. All `/api/*` JSON responses now include a
  top-level `schema_version: "1"` field and an `X-Schema-Version: 1` header.
- No breaking changes; this is the baseline every future change is measured
  against.
- Affected endpoints: `/api/compute`, `/api/presets`, `/api/localmaxxing`,
  `/api/benchmarks`, `/api/best`, `/api/spec`.
