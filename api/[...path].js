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

import { withMarkdownNegotiation } from './_markdown.js';
import { sendProblem } from './_errors.js';

export const config = { runtime: 'nodejs' };

// Read-only routes (#517): /api/spec declares GET-only operations for these
// paths, yet any HTTP method used to fall through to the GET handler and
// return 200 + full payload. Mutating verbs now get 405 + Allow: GET so a
// misbuilt agent request is diagnosable instead of silently "succeeding".
// Deliberately NOT listed: endpoints with documented mutating verbs
// (/api/compute POST batch, /api/watch POST/DELETE, /api/localmaxxing POST,
// /api/diff POST, /api/mcp POST) and handlers that already branch on method
// (/api/vram, /api/sizing).
const READ_ONLY_ROUTES = new Set([
  '/presets', '/benchmarks', '/best', '/runs', '/health', '/version',
  '/spec', '/snapshots', '/export', '/watch/rss.xml',
  '/agent/capabilities.json', '/agent/compute.json', '/agent/benchmarks.json',
  '/agent/scenario.json', '/agent/freshness.json', '/agent/confidence.json'
]);
const CALC_ID_RE = /^\/calc\/([^/]+)$/;

/** 405/OPTIONS handling for the read-only routes (#517). True = handled. */
function handleReadOnlyMethod(req, res, clean) {
  const readOnly = READ_ONLY_ROUTES.has(clean) || CALC_ID_RE.test(clean);
  if (!readOnly) return false;
  const method = String(req.method || 'GET').toUpperCase();
  if (method === 'GET' || method === 'HEAD') return false;
  if (method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.statusCode = 204;
    res.end();
    return true;
  }
  res.setHeader('Allow', 'GET');
  sendProblem(res, req, {
    status: 405,
    code: 'METHOD_NOT_ALLOWED',
    detail: `${method} is not supported on this endpoint — it is read-only. Use GET as declared in /api/spec.`
  });
  return true;
}

function json(res, body, status = 200) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.end(JSON.stringify(body, null, 2));
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

export default async function handler(req, res) {
  withMarkdownNegotiation(req, res);
  applyRequestIdEcho(req, res);
  applyAgentEndpointsHeader(req, res);
  const pathname = (req.url || '').split('?')[0].replace(/^\/api\/?/, '/');

  try {
    // Strip /v1/ prefix if present (versioning rewrite)
    const clean = pathname.replace(/^\/v1\//, '/');

    if (handleReadOnlyMethod(req, res, clean)) return;

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
      case '/og': return og(req, res);
      case '/parse-constraints': return parseConstraints(req, res);
      case '/sizing': return sizing(req, res);
      case '/snapshots': return snapshots(req, res);
      case '/spec': return spec(req, res);
      case '/vram': return vram(req, res);
      case '/watch': return watch(req, res);
      case '/watch/rss.xml': return watchRss(req, res);
      case '/watch/dispatch': return watchDispatch(req, res);
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
