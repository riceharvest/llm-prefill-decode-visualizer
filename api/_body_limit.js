// App-level request body size cap (#926).
//
// Vercel's serverless platform silently rejects bodies over ~4.5 MB at the
// edge with a bare `text/plain` 413 ("FUNCTION_PAYLOAD_TOO_LARGE") that
// carries no problem+json envelope, no `schema_version`, and no rate-limit
// headers — violating the API's documented error contract. We enforce our
// own, documented cap comfortably below that ceiling so oversized requests
// fail fast inside the app with the standard RFC 9457 problem+json shape.
//
// Every handler that reads a request body must go through one of these:
//   - rejectOversizedBody(req, res): Content-Length pre-check for handlers
//     that consume the platform-parsed `req.body` object.
//   - readBodyBuffer(req): bounded chunk accumulator for handlers that read
//     the raw stream themselves (/api/diff, /api/mcp).
import { ApiError, sendProblem } from './_errors.js';

/** Maximum accepted request body size: 4 MiB (platform edge sits at ~4.5 MB). */
export const MAX_BODY_BYTES = 4 * 1024 * 1024;

/**
 * True when the declared Content-Length already exceeds MAX_BODY_BYTES.
 * Tolerates missing/invalid headers (chunked encoding etc.) — the stream
 * readers bound those.
 */
export function bodyLimitExceeded(req) {
  const raw = req?.headers?.['content-length'];
  const n = Number(Array.isArray(raw) ? raw[0] : raw);
  return Number.isFinite(n) && n > MAX_BODY_BYTES;
}

/**
 * Pre-check for handlers that rely on platform-parsed `req.body`. Sends the
 * standard problem+json 413 (code PAYLOAD_TOO_LARGE) when the declared body
 * size is over the cap. Returns true if a 413 was sent (caller must stop).
 */
export function rejectOversizedBody(req, res) {
  if (!bodyLimitExceeded(req)) return false;
  sendProblem(res, req, {
    code: 'PAYLOAD_TOO_LARGE',
    detail: `request body exceeds the ${MAX_BODY_BYTES} byte maximum (Content-Length pre-check); reduce the payload and retry without backoff`
  });
  return true;
}

/**
 * Accumulate a request body up to MAX_BODY_BYTES and return it as a Buffer.
 * Throws ApiError('PAYLOAD_TOO_LARGE') as soon as the cap is crossed — the
 * stream stops being consumed, so memory stays bounded regardless of how
 * much the client sends. Callers render the error with sendProblemFromError.
 */
export async function readBodyBuffer(req) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += typeof chunk === 'string' ? Buffer.byteLength(chunk) : chunk.length;
    if (total > MAX_BODY_BYTES) {
      throw new ApiError('PAYLOAD_TOO_LARGE', `request body exceeds the ${MAX_BODY_BYTES} byte maximum; reduce the payload and retry without backoff`);
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
