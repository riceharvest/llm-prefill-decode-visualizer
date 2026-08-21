// Best-effort per-instance rate limiting for the agent API.
//
// IMPORTANT LIMITATION: Vercel serverless functions share no memory between
// invocations or instances, so these counters live in one instance's memory
// only. Each warm instance enforces its own budget, so the effective global
// limit can be higher (and cold starts reset it). This is deliberate: the
// goal (see GitHub issue #14) is to give well-behaved agents honest
// self-throttling signals via X-RateLimit-* headers and 429 + Retry-After,
// not hard multi-tenant quotas. A durable limiter would need Upstash Redis
// or similar; not worth it while limits stay generous.
//
// Algorithm: fixed-window counter keyed by client IP (X-Forwarded-For).

// Documented budget: 120 requests per minute per client IP (per instance).
// Keep in sync with the "Rate limits" section of public/llms.txt and api/spec.js.
export const RATE_LIMIT = Number(process.env.RATE_LIMIT_MAX) || 120;
export const RATE_WINDOW_MS = 60_000;

const buckets = new Map(); // key -> { count, windowStart }

/** Client identity for bucketing: first X-Forwarded-For hop, else socket addr. */
export function clientKey(req) {
  const h = req.headers || {};
  const xff = h['x-forwarded-for'] ?? h['X-Forwarded-For'];
  if (typeof xff === 'string' && xff.trim()) return xff.split(',')[0].trim();
  if (Array.isArray(xff) && xff.length) return String(xff[0]).split(',')[0].trim();
  return req.socket?.remoteAddress || 'unknown';
}

/**
 * Consume one request against `key`'s fixed window.
 * Pure-ish and time-injectable so node --test can drive windows without sleeping.
 * Returns { allowed, limit, remaining, resetEpochSec, retryAfterSec }.
 */
export function rateLimit(key, now = Date.now()) {
  // Bound memory: drop expired buckets once the map gets large. Per-instance
  // and lazy, but enough to keep a long-lived warm function from leaking.
  if (buckets.size > 5_000) {
    for (const [k, b] of buckets) {
      if (now - b.windowStart >= RATE_WINDOW_MS) buckets.delete(k);
    }
  }

  let b = buckets.get(key);
  if (!b || now - b.windowStart >= RATE_WINDOW_MS) {
    b = { count: 0, windowStart: now };
    buckets.set(key, b);
  }
  b.count += 1;

  const windowEndMs = b.windowStart + RATE_WINDOW_MS;
  return {
    allowed: b.count <= RATE_LIMIT,
    limit: RATE_LIMIT,
    remaining: Math.max(0, RATE_LIMIT - b.count),
    resetEpochSec: Math.ceil(windowEndMs / 1000),
    retryAfterSec: Math.max(1, Math.ceil((windowEndMs - now) / 1000))
  };
}

/** Test hook: clear all counters. */
export function _resetRateLimits() {
  buckets.clear();
}

function send429(res, info) {
  res.statusCode = 429;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Retry-After', String(info.retryAfterSec));
  res.end(JSON.stringify({
    error: `Rate limit exceeded: max ${info.limit} requests per ${RATE_WINDOW_MS / 1000}s per client (per serverless instance). Retry after ${info.retryAfterSec}s.`,
    limit: info.limit,
    remaining: 0,
    reset: info.resetEpochSec,
    retryAfterSeconds: info.retryAfterSec,
    note: 'See /llms.txt for the documented budget. Headers: X-RateLimit-Limit / -Remaining / -Reset (epoch seconds).'
  }, null, 2));
}

/**
 * Check the caller's budget and stamp X-RateLimit-Limit/-Remaining/-Reset on
 * the response. On exhaustion writes a full 429 body (+ Retry-After) and
 * returns false — handlers must `if (!enforceRateLimit(req, res)) return;`.
 * Call this FIRST in every handler so even error responses carry the headers.
 */
export function enforceRateLimit(req, res, { key } = {}) {
  const info = rateLimit(key ?? clientKey(req));
  res.setHeader('X-RateLimit-Limit', String(info.limit));
  res.setHeader('X-RateLimit-Remaining', String(info.remaining));
  res.setHeader('X-RateLimit-Reset', String(info.resetEpochSec));
  if (!info.allowed) {
    send429(res, info);
    return false;
  }
  return true;
}
