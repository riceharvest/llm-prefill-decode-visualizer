/**
 * Version-trust registry + deprecation wiring (issues #685).
 *
 * Single source of truth for "which URL prefixes are served, on which wire
 * schema version, and which of them are deprecated". The dispatcher
 * (api/[...path].js) calls applyVersionTrustHeaders() on every request so a
 * deprecated prefix automatically carries Deprecation / Sunset / Link
 * rel="deprecation" headers — no handler has to remember.
 *
 * Policy (full text in CHANGELOG-API.md): when a prefix is deprecated it keeps
 * working for at least 90 days past its `sunset` announcement, and every
 * response on that prefix is stamped with the standard headers.
 */

import { SCHEMA_VERSION, applyDeprecationHeaders } from './_schema.js';

export { SCHEMA_VERSION };

/**
 * Served URL prefixes, in discovery order.
 *   - status: 'current' (safe to harden onto) or 'deprecated' (sunset set).
 *   - canonical: the prefix the docs (/api/spec) are written against.
 *   - deprecatedAt / sunset: ISO timestamps; null while status is 'current'.
 * When a breaking change ships: flip the old prefix's status to 'deprecated',
 * set deprecatedAt = now and sunset = now + 90d. The middleware below then
 * stamps every response on that prefix with no further code changes.
 */
export const API_VERSIONS = [
  {
    prefix: '/api',
    schemaVersion: SCHEMA_VERSION,
    status: 'current',
    canonical: true,
    deprecatedAt: null,
    sunset: null,
    link: '/CHANGELOG-API.md'
  },
  {
    prefix: '/v1',
    schemaVersion: SCHEMA_VERSION,
    status: 'current',
    canonical: false,
    deprecatedAt: null,
    sunset: null,
    link: '/CHANGELOG-API.md'
  }
];

/** Which registry entry serves this pathname? ('/v1/compute' → '/v1'). */
export function prefixForPath(pathname) {
  const p = String(pathname || '');
  if (/^\/v1(\/|$)/.test(p)) return '/v1';
  return '/api';
}

/** Registry entry for a request path (never null — /api is the fallback). */
export function versionForPath(pathname) {
  const prefix = prefixForPath(pathname);
  return API_VERSIONS.find((v) => v.prefix === prefix) || API_VERSIONS[0];
}

/**
 * Central middleware: stamp deprecation headers whenever the request's URL
 * prefix is marked deprecated in the registry. Cheap no-op while everything
 * is 'current', but guarantees the 90-day notice is automatic the moment an
 * entry flips — handlers never need to call applyDeprecationHeaders
 * themselves.
 */
export function applyVersionTrustHeaders(req, res, pathname) {
  const entry = versionForPath(pathname);
  if (entry.status !== 'deprecated') return;
  applyDeprecationHeaders(res, {
    deprecatedAt: entry.deprecatedAt || undefined,
    sunset: entry.sunset || undefined,
    link: entry.link
  });
}
