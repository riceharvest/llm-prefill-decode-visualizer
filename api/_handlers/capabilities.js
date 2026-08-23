// GET /api/agent/capabilities.json — machine-readable discovery document for
// AI agents: every agent-facing surface of this app (JSON API endpoints, the
// MCP server, feeds, manifests and human/machine docs) in one structured list.
// Static by design: no upstream fetches, cheap to serve, CDN-cacheable.
import { sendJson } from '../_schema.js';

export const config = { runtime: 'nodejs' };

const BASE = 'https://llm-prefill-decode-visualizer.vercel.app';

function surface(path, methods, kind, description) {
  return { path, methods, kind, description };
}

// Ordered for a reader: discovery → math → data → ops. Keep descriptions in
// sync with /api/spec and /llms.txt.
const SURFACES = [
  // Discovery & contracts
  surface('/api/agent/capabilities.json', ['GET'], 'doc',
    'This document — all agent-facing surfaces in one machine-readable list.'),
  surface('/api/spec', ['GET'], 'doc',
    'Full OpenAPI 3.1 spec; derive every endpoint from this.'),
  surface('/llms.txt', ['GET'], 'doc',
    'Human-and-machine quick-start guide with worked examples per endpoint.'),
  surface('/agents.json', ['GET'], 'doc',
    'Agent-provider manifest listing the primary JSON endpoints.'),

  // Inference math
  surface('/api/compute', ['GET', 'POST'], 'json-api',
    'Run any inference math (TTFT, TPOT, walltime, VRAM, cost) via ?model=singleTurn|speculative|batched|agentic|kvCache|flagged|cost; POST accepts {"batch": [...]} of up to 50 parameter sets.'),
  surface('/api/vram', ['GET'], 'json-api',
    'Model + KV-cache + context VRAM from just an hfId; architecture resolved from the Hugging Face config.'),
  surface('/api/presets', ['GET'], 'json-api',
    'Built-in hardware speed presets and workload scenarios to feed /api/compute.'),
  surface('/api/calc/{id}', ['GET'], 'json-api',
    'Replay any computation deterministically from its calc_<hex> id; stamps verified: true.'),

  // Measured data
  surface('/api/localmaxxing', ['GET', 'POST'], 'json-api',
    'Community-measured single-stream benchmark runs; GET filters by hardware/model/quant, POST submits a run for review (202 = queued, never instant-publish).'),
  surface('/api/benchmarks', ['GET'], 'json-api',
    'Aggregated median + IQR speeds per hardware×model group with confidence blocks and caveats.'),
  surface('/api/best', ['GET'], 'json-api',
    'Ranked rig recommendations (?by=decode&maxParamsB=8&quant=q4_k_m) with VRAM-fit, pricing and power context.'),
  surface('/api/sizing', ['GET'], 'json-api',
    'One-call hardware sizing recommendation from a workload spec with meetsSlo flags.'),
  surface('/api/snapshots', ['GET'], 'json-api',
    'Versioned dataset snapshot IDs; all data endpoints accept ?snapshot=<id> for reproducible results.'),

 // Feeds & watch
  surface('/api/watch/rss.xml', ['GET'], 'feed',
    'RSS feed of new matching benchmark runs — poll it in any feed reader, no registration.'),
  surface('/api/watch', ['POST', 'GET', 'DELETE'], 'json-api',
    'Subscribe to a hardware+model combo: webhook on new runs plus the RSS URL; DELETE needs the one-time secret.'),

  // Agents & infra
  surface('/api/mcp', ['POST'], 'mcp',
    'MCP Streamable HTTP server (JSON-RPC): initialize, tools/list, tools/call, ping — tools proxy to the REST endpoints.'),
  surface('/.well-known/mcp.json', ['GET'], 'mcp',
    'MCP server manifest pointing at /api/mcp.'),
  surface('/api/health', ['GET'], 'json-api',
    'Liveness + upstream data freshness (fresh/stale/empty) for status checks.'),
  surface('/api/og', ['GET'], 'image',
    'Renders a 1200x630 PNG Open Graph chart card from URL params (binary image, not JSON).')
];

export default function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return sendJson(res, { ok: false, error: 'method_not_allowed' }, { status: 405 });
  }
  return sendJson(res, {
    ok: true,
    service: 'llm-prefill-decode-visualizer',
    description: 'LLM inference performance math (TTFT, TPOT, walltime, KV-cache VRAM, cost) plus community-measured hardware benchmarks. All JSON endpoints are CORS-enabled, require no auth, and are also served under the versioned /v1/ prefix.',
    base_url: BASE,
    auth: 'none',
    cors: true,
    rateLimit: {
      limitPerMinutePerInstance: 120,
      note: 'Best-effort per serverless instance; responses carry X-RateLimit-Limit/-Remaining/-Reset, exhaustion returns 429 with Retry-After.'
    },
    versioning: {
      schema_version: '1',
      versionedPrefix: '/v1/',
      policy: 'Additive changes do not bump the version; breaking changes bump the major and keep the previous version ≥90 days. See CHANGELOG-API.md.'
    },
    docs: {
      openapi: '/api/spec',
      guide: '/llms.txt',
      changelog: '/CHANGELOG-API.md'
    },
    surfaceCount: SURFACES.length,
    surfaces: SURFACES
  }, { cacheTtl: 3600 });
}
