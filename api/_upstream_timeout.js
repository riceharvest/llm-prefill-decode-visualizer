// Shared outbound-fetch timeout contract (#901).
//
// Every server-side outbound fetch runs under an AbortSignal.timeout() budget
// and maps the abort onto the machine-readable UPSTREAM_TIMEOUT problem code
// from api/_errors.js, so a stalled upstream fails fast with the documented
// problem+json shape instead of hanging until the invisible platform ceiling.
// Webhook delivery already had its own budget (api/_watch.js WEBHOOK_TIMEOUT_MS);
// these constants cover the remaining sites.

import { ApiError } from './_errors.js';

/**
 * Per-upstream budgets in ms. Plain mutable object so tests can shrink a
 * budget instead of waiting out the real one.
 */
export const UPSTREAM_TIMEOUTS = {
  hfConfig: 15_000,        // huggingface.co config.json / model-info lookups (api/_hfconfig.js)
  ggufChunk: 20_000,       // one .gguf range-read chunk (api/_gguf.js)
  leaderboardPage: 15_000, // one localmaxxing.com leaderboard page (api/_localmaxxing.js)
  mcpSelfFetch: 10_000     // MCP tools/call self-proxy to the REST handlers (api/mcp.js)
};

/** True when a thrown value is an abort caused by our deadline. */
export function isAbortTimeout(err) {
  return err?.name === 'TimeoutError' || err?.name === 'AbortError';
}

/**
 * fetch() with a hard deadline. A missed deadline throws
 * ApiError('UPSTREAM_TIMEOUT') so central handlers render the documented
 * problem+json shape; every other network error propagates unchanged.
 */
export async function fetchWithTimeout(url, options = {}, timeoutMs) {
  try {
    return await fetch(url, { ...options, signal: AbortSignal.timeout(timeoutMs) });
  } catch (err) {
    if (isAbortTimeout(err)) {
      throw new ApiError(
        'UPSTREAM_TIMEOUT',
        `upstream ${url} did not respond within ${timeoutMs}ms`,
        { extras: { upstreamTimeoutMs: timeoutMs } }
      );
    }
    throw err;
  }
}
