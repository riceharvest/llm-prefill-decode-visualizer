// Shared X-Request-Id echo helper (issues #946, #949).
//
// Every API surface — including api/mcp.js, which wins Vercel file-routing
// over the [...path].js catch-all and therefore bypasses its middleware —
// echoes a client-supplied X-Request-Id header back on every response so
// agents can correlate a request with server logs and retries.
//
// Normalization contract (#949): duplicate headers collapse to the FIRST
// value, surrounding whitespace is trimmed, values longer than
// MAX_REQUEST_ID_LENGTH are truncated defensively AND marked with an
// X-Request-Id-Truncated: true response header so strict request↔response
// correlation never fails silently.

export const MAX_REQUEST_ID_LENGTH = 200;

/**
 * Echo a client-supplied X-Request-Id back on the response. Purely
 * pass-through: when the client sends no request id, none is generated.
 */
export function applyRequestIdEcho(req, res) {
  const raw = req.headers?.['x-request-id'];
  if (raw === undefined || raw === null || raw === '') return;

  // Node joins repeated headers with ', '; keep only the first value so the
  // echoed id is deterministic regardless of how many the client sent.
  const first = Array.isArray(raw) ? raw[0] : String(raw);
  let value = String(first).trim();
  if (!value) return;

  let truncated = false;
  if (value.length > MAX_REQUEST_ID_LENGTH) {
    value = value.slice(0, MAX_REQUEST_ID_LENGTH); // bound header size
    truncated = true;
  }

  res.setHeader('X-Request-Id', value);
  if (truncated) res.setHeader('X-Request-Id-Truncated', 'true');

  // Expose it to browser fetch() consumers alongside the other custom headers.
  const expose = new Set(
    (res.getHeader('Access-Control-Expose-Headers') || '')
      .split(',')
      .map(s => s.trim())
      .filter(Boolean)
  );
  const toExpose = truncated
    ? ['X-Request-Id', 'X-Request-Id-Truncated']
    : ['X-Request-Id'];
  let changed = false;
  for (const h of toExpose) {
    if (!expose.has(h)) { expose.add(h); changed = true; }
  }
  if (changed) res.setHeader('Access-Control-Expose-Headers', [...expose].join(', '));
}
