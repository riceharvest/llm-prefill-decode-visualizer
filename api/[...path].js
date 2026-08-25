// Catch-all serverless function for Vercel Hobby plan (12-function limit).
// Routes /api/* requests to the individual endpoint handlers.
// Each handler module is imported and dispatched based on the pathname.

import { default as compute } from './_handlers/compute.js';
import { default as presets } from './_handlers/presets.js';
import { default as localmaxxing } from './_handlers/localmaxxing.js';
import { default as benchmarks } from './_handlers/benchmarks.js';
import { default as best } from './_handlers/best.js';
import { default as diff } from './_handlers/diff.js';
import { default as exportHandler } from './_handlers/export.js';
import { default as runsDump } from './_handlers/runs.js';
import { default as health } from './_handlers/health.js';
import { default as version } from './_handlers/version.js';
import { default as og } from './_handlers/og.js';
import { default as parseConstraints } from './_handlers/parse-constraints.js';
import { default as sizing } from './_handlers/sizing.js';
import { default as snapshots } from './_handlers/snapshots.js';
import { default as spec } from './_handlers/spec.js';
import { default as vram } from './_handlers/vram.js';
import { default as watch } from './_watch_impl.js';
import { default as watchRss } from './_handlers/rss.xml.js';
import { default as watchDispatch } from './_handlers/dispatch.js';
import { default as calcId } from './_handlers/calc_id.js';
import { default as capabilities } from './_handlers/capabilities.js';
import { default as agentBenchmarks } from './_handlers/agent_benchmarks.js';
import { default as agentScenario } from './_handlers/agent_scenario.js';
import { default as mcp } from './mcp.js';
import { default as agentCompute } from './_handlers/agent_compute.js';
import { default as agentFreshness } from './_handlers/agent_freshness.js';
import { default as versions } from './_handlers/versions.js';

import { ROUTES } from './_route_table.js';
import { withMarkdownNegotiation } from './_markdown.js';
import { applyVersionTrustHeaders } from './_versions.js';
import { sendJson } from './_schema.js';

export const config = { runtime: 'nodejs' };

/**
 * Vercel routes URLs that look like static assets (a file extension in the
 * last segment, e.g. `.json`/`.xml`) to the static layer first; when no
 * static file matches they 404 before ever reaching this function. That is
 * why every dotted /api route (agent capabilities/compute/benchmarks/
 * scenario/freshness/confidence .json and watch/rss.xml) returned NOT_FOUND
 * in production while extensionless routes worked (#548 #380 #468).
 *
 * vercel.json rewrites those misses to the extensionless form of the path;
 * this restores the canonical dotted path so the switch below keeps serving
 * both spellings through the same handlers.
 */
const DOTTED_ROUTES = ROUTES.map((r) => r.path).filter((p) => /\.(json|xml)$/.test(p));
export function canonicalApiPath(pathname) {
  if (pathname.includes('.')) return pathname;
  for (const p of DOTTED_ROUTES) {
    if (p === `${pathname}.json` || p === `${pathname}.xml`) return p;
  }
  return pathname;
}

function json(res, body, status = 200) {
  return sendJson(res, body, { status });
}

/**
 * Echo a client-supplied X-Request-Id header back on every response so
 * agents can correlate a request with server logs and retries. Purely
 * pass-through: when the client sends no request id, none is generated.
 */
function applyRequestIdEcho(req, res) {
  const id = req.headers?.['x-request-id'];
  if (!id) return;
  const value = String(id).slice(0, 200); // bound header size
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
    res.setHeader('Access-Control-Expose-Headers', [...expose].join(', '));
  }
}

/**
 * Expose the agent API surface in a single response header (issue #364) so a
 * `curl -I <site>/` (or any /api/* call) reveals the discovery map without
 * fetching prose. Complements the <link> tags (index.html #362) and sitemap
 * (#363). Additive only — never overrides an existing value.
 */
const AGENT_ENDPOINTS = '/api/spec, /llms.txt, /agents.json, /api/mcp, /api/agent/index.json';
function applyAgentEndpointsHeader(req, res) {
  if (res.hasHeader('X-Agent-Endpoints')) return;
  res.setHeader('X-Agent-Endpoints', AGENT_ENDPOINTS);
  const expose = new Set(
    (res.getHeader('Access-Control-Expose-Headers') || '')
      .split(',')
      .map(s => s.trim())
      .filter(Boolean)
  );
  for (const h of ['X-Agent-Endpoints', 'X-Schema-Version']) expose.add(h);
  res.setHeader('Access-Control-Expose-Headers', [...expose].join(', '));
}

/**
 * Central OPTIONS handling (issue #906).
 *
 * Before this, handlers without their own `req.method === 'OPTIONS'` branch
 * fell straight through into the GET path: every probe returned 200 with the
 * FULL representation (≈1 MB for /api/export), no `Allow` header, and — on
 * /api/spec and /api/presets — a `public, max-age=3600` cache stamp that put
 * probe responses into shared CDN caches keyed to the same URL GETs use.
 *
 * OPTIONS is now answered once here, before dispatch: 204 No Content with an
 * `Allow` header (plus CORS preflight headers) derived from the central route
 * table, and `Cache-Control: no-store` so probes are never cached. The
 * per-handler OPTIONS branches remain for direct callers but are bypassed on
 * the wire.
 */
const EXTRA_ALLOW_HEADERS = { '/mcp': 'Content-Type, Accept, Mcp-Session-Id' };

function matchRouteMethods(clean) {
  const exact = ROUTES.find((r) => r.path === clean);
  if (exact) return exact.methods;
  if (/^\/calc\/[^/]+$/.test(clean)) {
    const dynamic = ROUTES.find((r) => r.path === '/calc/:id');
    return dynamic ? dynamic.methods : null;
  }
  return null;
}

function handleOptions(req, res, clean) {
  // Probes must never populate caches, even when the path is unknown.
  res.setHeader('Cache-Control', 'no-store');
  const methods = matchRouteMethods(clean);
  if (!methods) return false; // unknown path → fall through to the 404 branch

  const allow = [...methods, 'OPTIONS'].join(', ');
  res.statusCode = 204;
  res.setHeader('Allow', allow);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', allow);
  res.setHeader(
    'Access-Control-Allow-Headers',
    EXTRA_ALLOW_HEADERS[clean] || 'Content-Type'
  );
  res.end();
  return true;
}

export default async function handler(req, res) {
  withMarkdownNegotiation(req, res);
  applyRequestIdEcho(req, res);
  applyAgentEndpointsHeader(req, res);
  const pathname = (req.url || '').split('?')[0].replace(/^\/api\/?/, '/');
  // Version trust (issue #685): if the request targets a deprecated URL
  // prefix, stamp Deprecation/Sunset/Link headers centrally — handlers never
  // need to remember. No-op while every prefix is 'current'.
  applyVersionTrustHeaders(req, res, pathname);

  try {
    // Strip /v1/ prefix if present (versioning rewrite), then tolerate a
    // trailing slash so /api/spec/ and /api/spec resolve identically
    // (issues #943/#953). vercel.json's "trailingSlash": false normally
    // 308-redirects slashed URLs before they reach this function; this is
    // the safety net for clients/environments where it did not apply.
    let clean = pathname.replace(/^\/v1\//, '/').replace(/\/+$/, '') || '/';
    clean = canonicalApiPath(clean);

    if (req.method === 'OPTIONS' && handleOptions(req, res, clean)) {
      return;
    }

    switch (clean) {
      case '/compute': return compute(req, res);
      case '/presets': return presets(req, res);
      case '/localmaxxing': return localmaxxing(req, res);
      case '/benchmarks': return benchmarks(req, res);
      case '/best': return best(req, res);
      case '/diff': return diff(req, res);
      case '/export': return exportHandler(req, res);
      case '/runs': return runsDump(req, res);
      case '/health': return health(req, res);
      case '/version': return version(req, res);
      case '/versions': return versions(req, res);
      case '/og': return og(req, res);
      case '/parse-constraints': return parseConstraints(req, res);
      case '/sizing': return sizing(req, res);
      case '/snapshots': return snapshots(req, res);
      case '/spec': return spec(req, res);
      case '/vram': return vram(req, res);
      case '/watch': return watch(req, res);
      case '/watch/rss.xml': return watchRss(req, res);
      case '/watch/dispatch': return watchDispatch(req, res);
      // Single-segment aliases (issue #372 #373 #376 #381): the platform edge
      // never routes multi-segment /api/* paths to this function, so
      // vercel.json rewrites them to these aliases with the original path's
      // parameters carried in the query string (?id= / ?file=).
      case '/calc-replay': return calcId(req, res); // from /api/calc/<id> rewrite
      case '/watch-rss': return watchRss(req, res); // from /api/watch/rss.xml rewrite
      case '/watch-dispatch': return watchDispatch(req, res); // from /api/watch/dispatch rewrite
      case '/agent-json': {
        const file = String((req.query || {}).file || '');
        const agentDoc = {
          'capabilities.json': capabilities,
          'compute.json': agentCompute,
          'benchmarks.json': agentBenchmarks,
          'scenario.json': agentScenario,
          'freshness.json': agentFreshness,
          'confidence.json': agentFreshness, // alias, same report
        }[file];
        if (!agentDoc) return json(res, { error: 'Not found', path: pathname }, 404);
        return agentDoc(req, res);
      }
      case '/mcp': return mcp(req, res);
      case '/agent/capabilities.json': return capabilities(req, res);
      case '/agent/compute.json': return agentCompute(req, res);
      case '/agent/benchmarks.json': return agentBenchmarks(req, res);
      case '/agent/scenario.json': return agentScenario(req, res);
      case '/agent/freshness.json': return agentFreshness(req, res);
      case '/agent/confidence.json': return agentFreshness(req, res); // alias, same report
      default:
        // /api/calc/<id>
        const calcMatch = clean.match(/^\/calc\/([^/]+)$/);
        if (calcMatch) {
          req.query = { ...req.query, id: calcMatch[1] };
          return calcId(req, res);
        }
        return json(res, { error: 'Not found', path: pathname }, 404);
    }
  } catch (err) {
    return json(res, { error: String(err.message || err) }, 500);
  }
}