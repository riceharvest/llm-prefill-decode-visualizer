// Shared per-response telemetry + cache-correctness headers, wired once at the
// dispatcher edge so every /api/* reply carries them without each handler
// having to remember.
//
// 1. Server-Timing (#914): `app;dur=<ms>` — in-band backend latency for the
//    application portion of the request. Agents can finally distinguish a
//    cold compute from a warm CDN HIT at the header level.
// 2. Vary: Origin (#916): responses advertise `Access-Control-Allow-Origin: *`
//    (anonymous-only CORS). Stamping Vary: Origin now keeps any future
//    origin-reflecting/credentialed variant cache-safe, and signals caches
//    that origin matters.
//
// Both are stamped just before the response ends by wrapping res.end() once,
// because handlers end their own responses. Idempotent: calling twice on one
// response is a no-op.

/** Merge `Origin` into an existing Vary header without duplicating entries. */
export function applyVaryOrigin(res) {
  if (typeof res.getHeader !== 'function') return;
  const current = res.getHeader('Vary');
  if (!current) {
    res.setHeader('Vary', 'Origin');
    return;
  }
  const parts = String(current)
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
  if (!parts.some(p => p.toLowerCase() === 'origin')) parts.push('Origin');
  res.setHeader('Vary', parts.join(', '));
}

/**
 * Wrap res.end() so Server-Timing (+ Vary: Origin) land on the final headers
 * no matter which handler emitted the response. Safe on plain mock objects:
 * anything without a callable end is left untouched.
 */
export function applyServerTiming(res, t0 = Date.now()) {
  if (!res || typeof res.end !== 'function' || res.__telemetryWired) return res;
  res.__telemetryWired = true;
  const originalEnd = res.end.bind(res);
  res.end = function telemetryEnd(...args) {
    try {
      if (typeof res.getHeader === 'function' && !res.getHeader('Server-Timing')) {
        const dur = Math.max(0, Date.now() - t0);
        res.setHeader('Server-Timing', `app;dur=${dur}`);
      }
      applyVaryOrigin(res);
    } catch {
      // Telemetry must never break the actual response.
    }
    return originalEnd(...args);
  };
  return res;
}
