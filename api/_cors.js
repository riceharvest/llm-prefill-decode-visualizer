/**
 * Shared CORS preflight helper (issue #634).
 *
 * Before this module every API handler hand-rolled its own OPTIONS block:
 * some returned 204 with full headers, some answered OPTIONS with a full GET
 * body and no CORS headers at all, /api/vram omitted Allow-Headers entirely,
 * and X-Request-Id — which the API echoes on every response and documents for
 * "browser fetch() consumers" — was allowlisted NOWHERE, so cross-origin
 * browser agents could never actually send it.
 *
 * One policy, one emitter: respond 204 to OPTIONS with ACAO:*, the route's
 * methods from the central route table, an Allow-Headers list that always
 * includes Content-Type/Accept/X-Request-Id (callers may extend it), and a
 * uniform Access-Control-Max-Age. Responses are explicitly uncacheable so a
 * preflight can never be served stale by the edge (cf. issue #906).
 */

export const PREFLIGHT_ALLOW_HEADERS = ['Content-Type', 'Accept', 'X-Request-Id'];

export const PREFLIGHT_MAX_AGE = '86400';

/**
 * Answer a CORS preflight. `methods` should come from the central route table
 * (ROUTES[].methods); `extraAllowHeaders` lets a route widen the list without
 * being able to shrink the baseline.
 */
export function sendPreflight(req, res, { methods = ['GET', 'OPTIONS'], extraAllowHeaders = [] } = {}) {
  const allowHeaders = [...PREFLIGHT_ALLOW_HEADERS];
  for (const h of extraAllowHeaders) {
    if (!allowHeaders.some(a => a.toLowerCase() === String(h).toLowerCase())) {
      allowHeaders.push(h);
    }
  }
  res.statusCode = 204;
  res.setHeader('Access-Control-Allow-Origin', '*');
  const methodList = [...new Set([...methods, 'OPTIONS'])].join(', ');
  res.setHeader('Access-Control-Allow-Methods', methodList);
  res.setHeader('Access-Control-Allow-Headers', allowHeaders.join(', '));
  res.setHeader('Access-Control-Max-Age', PREFLIGHT_MAX_AGE);
  // Preflights are per-client negotiations, never cacheable content.
  res.setHeader('Cache-Control', 'no-store');
  res.end();
  return true;
}
