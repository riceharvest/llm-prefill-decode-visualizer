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

import { createHash } from 'node:crypto';
import { rateLimitBody, applyRateLimitHeaders, defaultRateLimitInfo } from './_ratelimit.js';
import { wantsMarkdown } from './_markdown.js';

export const SCHEMA_VERSION = '1';

/** Instance boot time — Last-Modified floor for generated bodies (#615).
 *  The spec/presets documents change only on deploy, so any request that
 *  arrives after this instance booted with an If-Modified-Since at/after
 *  boot can be answered 304 when the ETag also matches (or is absent). */
const BOOT_TIME = new Date();

/** Strong ETag for a generated body: content hash of the exact object the
 *  handler would serialize (pre-schema_version-stamp, pre-rate_limit — both
 *  vary per call and must not destabilize the validator). */
function etagFor(body) {
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
  const etag = etagFor(body);
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
  for (const h of ['X-Schema-Version', 'Deprecation', 'Sunset', 'ETag']) expose.add(h);
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
 * Strong ETag over the exact serialized body (issue #584): agents can
 * revalidate with If-None-Match after max-age lapses instead of re-downloading.
 */
function etagForSerialized(serialized) {
  return `"${createHash('sha256').update(serialized).digest('hex').slice(0, 32)}"`;
}

/** RFC 9110 §13.1.2 If-None-Match evaluation: list match, weak-prefix tolerant, `*` matches any. */
function ifNoneMatchHits(req, etag) {
  const inm = req?.headers?.['if-none-match'];
  if (!inm) return false;
  const candidates = String(inm).split(',').map(s => s.trim()).filter(Boolean);
  if (candidates.includes('*')) return true;
  return candidates.some(c => c.replace(/^W\//i, '') === etag);
}

/**
 * True when this response carries a public (shared-cacheable) Cache-Control —
 * either preset by the handler or about to be set from opts.cacheTtl (#590).
 */
function resolvesPubliclyCacheable(res, cacheTtl) {
  let cc = res.getHeader('Cache-Control');
  if (cc == null && cacheTtl != null) {
    cc = `public, max-age=${cacheTtl}`;
    res.setHeader('Cache-Control', cc);
  }
  return typeof cc === 'string' && /\bpublic\b/.test(cc);
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
  const publiclyCached = resolvesPubliclyCacheable(res, cacheTtl);
  applySchemaHeaders(res);
  const payload = withSchemaVersion(body);

  // Per-client rate-limit info must never ride on a shared-cacheable
  // response (#590): the edge would replay one client's counters (body field
  // AND X-RateLimit-* headers) to every other client for up to an hour.
  // Uncached responses keep both, as documented in llms.txt.
  const rl = publiclyCached ? null : rateLimitBody(res);
  if (rl && payload.rate_limit === undefined) payload.rate_limit = rl;
  else if (!rl) {
    // Request path bypassed enforceRateLimit (e.g. /api/health, /api/version,
    // /api/agent/capabilities.json, /api/calc/<id>, router-level 404/500):
    // still honour the documented contract (public/llms.txt "Rate limits")
    // that every /api/* JSON response carries X-RateLimit-* headers. Reports
    // the documented budget without consuming from any client bucket.
    applyRateLimitHeaders(res, defaultRateLimitInfo());
  }
  if (publiclyCached && typeof res.removeHeader === 'function') {
    for (const h of ['X-RateLimit-Limit', 'X-RateLimit-Remaining', 'X-RateLimit-Reset']) {
      if (res.getHeader(h) !== undefined) res.removeHeader(h);
    }
  }

  // Trailing newline: POSIX-text-friendly final byte, matching the client
  // exporter (src/utils/exportJson.js serializeJson) so every JSON surface in
  // this repo agrees on the framing.
  const serialized = JSON.stringify(payload, null, 2) + '\n';

  // Conditional-request support (#584): strong ETag + If-None-Match → 304.
  // Only on success responses and only for the JSON representation (the
  // markdown variant has different bytes; Vary: Accept already covers it).
  // Handlers that already ran conditionalGet() keep THEIR validator — this
  // generic stamp must not clobber it (#615 contract).
  const req = res.req;
  if (status === 200 && !(req && wantsMarkdown(req)) && !res.getHeader('ETag')) {
    const etag = etagForSerialized(serialized);
    res.setHeader('ETag', etag);
    if (ifNoneMatchHits(req, etag)) {
      res.statusCode = 304;
      return res.end();
    }
  }

  res.end(serialized);
}
