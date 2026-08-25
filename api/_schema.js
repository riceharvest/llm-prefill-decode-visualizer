/**
 * Schema versioning + deprecation policy for every JSON API response.
 *
 * Every JSON response carries:
 *   - `schema_version` in the body (string, currently "1"), and
 *   - `X-Schema-Version` as a response header (readable even when a client
 *     only inspects headers, e.g. on HEAD/OPTIONS or error short-circuits).
 *
 * Policy (full text in CHANGELOG-API.md):
 *   - Additive changes (new fields, new query params, new endpoints) do NOT
 *     bump the version.
 *   - Breaking changes (removing/renaming fields, changing types or
 *     semantics of existing fields) bump the major version. The previous
 *     major version keeps working for at least 90 days, announced via the
 *     `Deprecation` and `Sunset` headers plus a CHANGELOG-API.md entry.
 */

import { rateLimitBody, applyRateLimitHeaders, defaultRateLimitInfo } from './_ratelimit.js';
import { createHash } from 'node:crypto';

export const SCHEMA_VERSION = '1';

/** Instance boot time — Last-Modified floor for generated bodies (#615).
 *  The spec/presets documents change only on deploy, so any request that
 *  arrives after this instance booted with an If-Modified-Since at/after
 *  boot can be answered 304 when the ETag also matches (or is absent). */
const BOOT_TIME = new Date();

/** Strong ETag for a generated body: content hash of the exact object the
 *  handler would serialize (pre-schema_version-stamp, pre-rate_limit — both
 *  vary per call and must not destabilize the validator). */
function bodyEtagFor(body) {
  return '"' + createHash('sha256').update(JSON.stringify(body)).digest('hex').slice(0, 32) + '"';
}

/** RFC 7232 If-None-Match matching: comma-separated list, weak prefix ignored. */
function matchesEtag(headerValue, etag) {
  return String(headerValue)
    .split(',')
    .map(s => s.trim().replace(/^W\//i, ''))
    .includes(etag);
}

function writeNotModified(res) {
  res.statusCode = 304;
  if (!res.getHeader('Access-Control-Allow-Origin')) {
    res.setHeader('Access-Control-Allow-Origin', '*');
  }
  applySchemaHeaders(res);
  res.end(); // 304 responses carry headers only, never a body
}

/**
 * Conditional-request support for cacheable generated bodies (#615).
 *
 * Stamps a strong `ETag` (content hash of the body) plus `Last-Modified` on
 * the response, then answers `If-None-Match` / `If-Modified-Since` with a
 * bare 304 when the client already has the current representation. Call it
 * BEFORE sendJson with the same body/cacheTtl; returns true when a 304 was
 * written so the caller can return without sending a payload.
 *
 * @param {object} req
 * @param {object} res
 * @param {object} body           response payload (pre-sendJson stamping)
 * @param {object} [opts]
 * @param {number} [opts.cacheTtl] seconds; sets Cache-Control on 200 AND 304
 * @returns {boolean} true when a 304 was written
 */
export function conditionalGet(req, res, body, { cacheTtl } = {}) {
  const etag = bodyEtagFor(body);
  res.setHeader('ETag', etag);
  res.setHeader('Last-Modified', BOOT_TIME.toUTCString());
  if (cacheTtl != null && !res.getHeader('Cache-Control')) {
    res.setHeader('Cache-Control', `public, max-age=${cacheTtl}`);
  }
  const inm = req?.headers?.['if-none-match'];
  if (inm && matchesEtag(inm, etag)) {
    writeNotModified(res);
    return true;
  }
  const ims = req?.headers?.['if-modified-since'];
  if (!inm && ims) {
    const t = new Date(String(ims));
    const bootSec = Math.floor(BOOT_TIME.getTime() / 1000);
    if (!Number.isNaN(t.getTime()) && bootSec <= Math.floor(t.getTime() / 1000)) {
      writeNotModified(res);
      return true;
    }
  }
  return false;
}

/** Stamp the schema version onto a response body without mutating it.
 *  The stamp always reflects the current SCHEMA_VERSION, even if the body
 *  already carries one (the API layer owns the value). */
export function withSchemaVersion(body) {
  return { ...body, schema_version: SCHEMA_VERSION };
}

/**
 * Set the schema-version headers on a response.
 * Safe to call more than once and alongside other header helpers.
 */
export function applySchemaHeaders(res) {
  res.setHeader('X-Schema-Version', SCHEMA_VERSION);
  // Expose the custom headers to browser clients (CORS-safelisted response
  // headers would otherwise hide them from fetch() consumers).
  const expose = new Set(
    (res.getHeader('Access-Control-Expose-Headers') || '')
      .split(',')
      .map(s => s.trim())
      .filter(Boolean)
  );
  // X-Vercel-Mitigated / X-Vercel-Error (#717): during a platform Security
  // Checkpoint the edge answers with `x-vercel-mitigated: challenge` before
  // this app's middleware ever runs. Browser-context agents can only read
  // these non-safelisted headers if they are CORS-exposed on every /api/*
  // response, so advertise them alongside the schema headers.
  for (const h of ['X-Schema-Version', 'Deprecation', 'Sunset', 'X-Vercel-Mitigated', 'X-Vercel-Error']) {
    expose.add(h);
  }
  res.setHeader('Access-Control-Expose-Headers', [...expose].join(', '));
}

/**
 * Mark a response as coming from a deprecated API surface.
 *
 * - `Deprecation` header (draft-ietf-httpapi-deprecation-header):
 *   `@<unix-seconds>` — when the deprecation was announced.
 * - `Sunset` header (RFC 8594): HTTP-date after which the old surface may
 *   stop responding.
 * - `Link` with `rel="deprecation"`: where to read the migration notes.
 *
 * @param {object} res
 * @param {object} opts
 * @param {string|Date} [opts.deprecatedAt]  announcement date (default: now)
 * @param {string|Date} opts.sunset          removal date (required-ish)
 * @param {string} [opts.link]               migration-doc URL
 */
export function applyDeprecationHeaders(res, { deprecatedAt, sunset, link } = {}) {
  const announced = deprecatedAt ? new Date(deprecatedAt) : new Date();
  if (!Number.isNaN(announced.getTime())) {
    res.setHeader('Deprecation', `@${Math.floor(announced.getTime() / 1000)}`);
  }
  if (sunset) {
    const d = new Date(sunset);
    if (!Number.isNaN(d.getTime())) res.setHeader('Sunset', d.toUTCString());
  }
  if (link) res.setHeader('Link', `<${link}>; rel="deprecation"`);
  applySchemaHeaders(res);
}

/**
 * Deprecation registry (#714): route path (as seen by the /api dispatcher,
 * e.g. '/compute') -> { deprecatedAt, sunset, link }. Empty until a surface
 * is actually deprecated; the dispatcher consults it on every request via
 * applyDeprecationForPath(), so registering a route activates the documented
 * Deprecation/Sunset/Link header contract for it immediately.
 */
export const DEPRECATION_REGISTRY = {};

/** Mark an API route deprecated (see DEPRECATION_REGISTRY). */
export function registerDeprecatedRoute(route, { deprecatedAt, sunset, link } = {}) {
  DEPRECATION_REGISTRY[route] = { ...(deprecatedAt && { deprecatedAt }), sunset, link };
}

/** Remove a registration (used by tests). */
export function unregisterDeprecatedRoute(route) {
  delete DEPRECATION_REGISTRY[route];
}

/**
 * Apply the deprecation headers for `pathname` when it is registered as
 * deprecated. Returns true when headers were applied. Safe to call on every
 * request: the common case is one Map lookup and no header writes.
 */
export function applyDeprecationForPath(res, pathname) {
  const meta = DEPRECATION_REGISTRY[pathname];
  if (!meta) return false;
  applyDeprecationHeaders(res, meta);
  return true;
}

/**
 * Shared JSON sender used by every /api route: stamps the schema version,
 * sets the standard headers, and serializes with stable formatting.
 *
 * @param {object} res
 * @param {object} body        response payload (schema_version added on top)
 * @param {object} [opts]
 * @param {number} [opts.status=200]
 * @param {number} [opts.cacheTtl]  seconds; omit for no Cache-Control
 */
export function sendJson(res, body, { status = 200, cacheTtl } = {}) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  if (!res.getHeader('Access-Control-Allow-Origin')) {
    res.setHeader('Access-Control-Allow-Origin', '*');
  }
  if (cacheTtl != null && !res.getHeader('Cache-Control')) {
    res.setHeader('Cache-Control', `public, max-age=${cacheTtl}`);
  }
  applySchemaHeaders(res);
  const payload = withSchemaVersion(body);
  // Agent-facing rate-limit info in the body itself (mirrors the X-RateLimit-*
  // headers): present whenever the handler ran enforceRateLimit before
  // sending. Additive field — does not bump schema_version. See AGENTS.md,
  // "Rate limits".
  const rl = rateLimitBody(res);
  if (rl && payload.rate_limit === undefined) payload.rate_limit = rl;
  if (rl && payload.rate_limit === undefined) payload.rate_limit = rl;
  else if (!rl) {
    // Request path bypassed enforceRateLimit (e.g. /api/health, /api/version,
    // /api/agent/capabilities.json, /api/calc/<id>, router-level 404/500):
    // still honour the documented contract (public/llms.txt "Rate limits")
    // that every /api/* JSON response carries X-RateLimit-* headers. Reports
    // the documented budget without consuming from any client bucket.
    applyRateLimitHeaders(res, defaultRateLimitInfo());
  }
  // Trailing newline: POSIX-text-friendly final byte, matching the client
  // exporter (src/utils/exportJson.js serializeJson) so every JSON surface in
  // this repo agrees on the framing.
  res.end(JSON.stringify(payload, null, 2) + '\n');
}

/** Strong ETag for one exact response body: sha256 of the exact serialized
 *  bytes, base64url-quoted (long form distinguishes the edge validator from
 *  the inner body-hash used by conditionalGet()). */
export function etagFor(chunk) {
  return `"${createHash('sha256').update(String(chunk)).digest('base64url')}"`;
}

function ifNoneMatchSatisfied(headerValue, etag) {
  // Weak comparison per RFC 9110 §13.1.2: ignore W/ prefixes; `*` matches any.
  const candidates = String(headerValue).split(',').map(v => v.trim().replace(/^W\//, ''));
  return candidates.includes('*') || candidates.includes(etag);
}

/**
 * Conditional-GET support for every /api/* JSON response (#606): stamps a
 * strong ETag computed from the exact serialized body and answers a matching
 * `If-None-Match` with an empty-bodied 304 instead of re-sending the payload.
 * Installed at the dispatcher edge (like markdown negotiation) so handlers
 * stay untouched; clients that send no conditional headers see byte-identical
 * responses plus the new ETag header.
 */
export function withConditionalGet(req, res) {
  const originalEnd = res.end.bind(res);
  res.end = function patchedEnd(chunk, ...rest) {
    const contentType = String(res.getHeader('Content-Type') || '');
    const isJson = contentType.includes('application/json');
    if (!isJson || chunk == null || res.statusCode !== 200) {
      return originalEnd(chunk, ...rest);
    }
    // Handlers using conditionalGet() already stamped a stable, content-
    // derived validator on the pre-rate-limit body — respect it instead of
    // overwriting with a per-call-varying hash.
    let etag = res.getHeader('ETag');
    if (!etag) {
      etag = etagFor(chunk);
      res.setHeader('ETag', etag);
    }
    if (!res.getHeader('Last-Modified')) {
      res.setHeader('Last-Modified', BOOT_TIME.toUTCString());
    }
    if (!res.getHeader('Cache-Control')) {
      res.setHeader('Cache-Control', 'public, max-age=3600');
    }
    const expose = new Set(
      (res.getHeader('Access-Control-Expose-Headers') || '')
        .split(',')
        .map(s => s.trim())
        .filter(Boolean)
    );
    if (!expose.has('ETag')) {
      expose.add('ETag');
      res.setHeader('Access-Control-Expose-Headers', [...expose].join(', '));
    }
    const inm = req?.headers?.['if-none-match'];
    if (inm && ifNoneMatchSatisfied(inm, etag)) {
      res.statusCode = 304;
      res.removeHeader?.('Content-Type');
      return originalEnd();
    }
    return originalEnd(chunk, ...rest);
  };
}
