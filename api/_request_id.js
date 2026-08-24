/**
 * Shared X-Request-Id echo middleware (issues #946 #949).
 *
 * Echoes a client-supplied X-Request-Id header back on every response so
 * agents can correlate a request with server logs and retries. Purely
 * pass-through: when the client sends no request id, none is generated.
 *
 * Used by BOTH api/[...path].js (REST catch-all) and api/mcp.js — on Vercel's
 * file-based routing api/mcp.js wins over the catch-all for /api/mcp, so the
 * MCP transport must apply the echo itself or agents lose correlation exactly
 * where it matters most (#946).
 */

export const REQUEST_ID_MAX_LENGTH = 200;

export function applyRequestIdEcho(req, res) {
  const raw = req.headers?.['x-request-id'];
  if (!raw) return;
  // Duplicate headers arrive pre-joined by the runtime ("first, second").
  // Keep only the first value so the echoed id is deterministic (#949).
  let value = String(raw).split(',')[0].trim();
  if (!value) return;
  const truncated = value.length > REQUEST_ID_MAX_LENGTH;
  if (truncated) {
    value = value.slice(0, REQUEST_ID_MAX_LENGTH); // bound header size
    // Make the amputation observable instead of silent (#949).
    res.setHeader('X-Request-Id-Truncated', 'true');
  }
  res.setHeader('X-Request-Id', value);
  // Expose it to browser fetch() consumers alongside the other custom headers.
  const expose = new Set(
    (res.getHeader('Access-Control-Expose-Headers') || '')
      .split(',')
      .map(s => s.trim())
      .filter(Boolean)
  );
  if (!expose.has('X-Request-Id')) {
    expose.add('X-Request-Id');
  }
  if (truncated && !expose.has('X-Request-Id-Truncated')) {
    expose.add('X-Request-Id-Truncated');
  }
  res.setHeader('Access-Control-Expose-Headers', [...expose].join(', '));
}
