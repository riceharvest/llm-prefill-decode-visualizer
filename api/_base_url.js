// Shared request-origin base URL derivation (#833 #928).
//
// /api/spec servers[] and /api/agent/capabilities.json base_url used to be
// compile-time constants pointing at the production host, so every
// self-hosted, preview or local deployment served discovery documents that
// silently redirected generated clients back at production. Derive the base
// from the incoming request instead.
//
// Precedence:
//   1. VISUALIZER_API_URL env override — mirrors the stdio MCP server
//      (mcp/server.js) so operators can pin an explicit origin.
//   2. Request host + protocol (X-Forwarded-* first, per Vercel/standard
//      proxy conventions; first hop wins when proxies append values).
//   3. Production host as a last-resort fallback (headerless callers such as
//      unit tests); kept as documented fallback only, never the resolved
//      default on a real request.

export const PROD_BASE = 'https://llm-prefill-decode-visualizer.vercel.app';

function firstHop(value) {
  return String(value).split(',')[0].trim();
}

export function requestBaseUrl(req) {
  const override = process.env.VISUALIZER_API_URL;
  if (override) return override.replace(/\/+$/, '');

  const headers = req?.headers || {};
  const host = headers['x-forwarded-host'] ? firstHop(headers['x-forwarded-host']) : headers.host;
  if (!host) return PROD_BASE;

  const proto = headers['x-forwarded-proto']
    ? firstHop(headers['x-forwarded-proto'])
    : (req?.socket?.encrypted ? 'https' : 'http');
  return `${proto}://${host}`;
}
