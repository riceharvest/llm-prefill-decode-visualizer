/**
 * Shared X-Request-Id echo middleware.
 *
 * Echoes a client-supplied X-Request-Id header back on every response so
 * agents can correlate a request with server logs and retries. Purely
 * pass-through: when the client sends no request id, none is generated.
 *
 * Used by BOTH transports:
 *   - api/[...path].js (every REST route), and
 *   - api/mcp.js (the agent-native MCP transport, issue #946: api/mcp.js wins
 *     Vercel file-routing over the catch-all, so it must apply the echo
 *     itself or correlation silently breaks on that surface).
 */

/** Bound on the echoed header size; ids longer than this are amputated. */
export const REQUEST_ID_MAX_LENGTH = 200;

export function applyRequestIdEcho(req, res) {
  const id = req.headers?.['x-request-id'];
  if (!id) return;
  const raw = String(id);
  const value = raw.slice(0, REQUEST_ID_MAX_LENGTH); // bound header size
  res.setHeader('X-Request-Id', value);
  if (raw.length > value.length) {
    // Issue #949: silent amputation broke strict request↔response
    // correlation with no discoverable signal. Emit an explicit,
    // machine-readable marker carrying the ORIGINAL length so clients can
    // detect (and avoid sending) oversized ids.
    res.setHeader('X-Request-Id-Truncated', String(raw.length));
  }
  // Expose it to browser fetch() consumers alongside the other custom headers.
  const expose = new Set(
    (res.getHeader('Access-Control-Expose-Headers') || '')
      .split(',')
      .map(s => s.trim())
      .filter(Boolean)
  );
  for (const h of ['X-Request-Id', 'X-Request-Id-Truncated']) {
    if (!expose.has(h)) expose.add(h);
  }
  res.setHeader('Access-Control-Expose-Headers', [...expose].join(', '));
}
