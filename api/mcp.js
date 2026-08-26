/**
 * MCP (Model Context Protocol) server — Streamable HTTP transport.
 *
 * Exposes the site's inference-math API as MCP tools so agents (Claude,
 * ChatGPT, etc.) can call it natively. Implements the JSON-RPC methods
 * required for a basic stateless server:
 *   initialize, notifications/initialized, tools/list, tools/call, ping.
 *
 * Tool calls proxy to the existing REST handlers, so there is exactly one
 * implementation of every formula.
 */

import { readFileSync } from 'node:fs';
import { clientKey, rateLimit, RATE_WINDOW_MS } from './_ratelimit.js';
import { applySchemaHeaders, SCHEMA_VERSION } from './_schema.js';

// Issue #833: the tools/call proxy used to hardcode the production origin, so
// every self-hosted deployment silently proxied back to vercel.app — resolve
// the base from the incoming request's own Host header; production keeps
// working unchanged.
const DEFAULT_BASE = 'https://llm-prefill-decode-visualizer.vercel.app';

export function resolveBase(req = null, env = process.env) {
  const envBase = env.MCP_BASE_URL || env.VISUALIZER_API_URL;
  if (envBase) return String(envBase).replace(/\/+$/, '');
  const host = req?.headers?.host;
  if (!host) return DEFAULT_BASE;
  const fwdProto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
  const proto = fwdProto || ((host.startsWith('localhost') || host.startsWith('127.0.0.1') || host.startsWith('[::1]')) ? 'http' : 'https');
  return `${proto}://${host}`;
}

// MCP resources advertised by /.well-known/mcp.json (#794). The manifest has
// always listed these two documents; resources/list + resources/read below
// make the server actually serve them so capability-driven clients don't hit
// a method-not-found wall after trusting the manifest.
const RESOURCES = [
  {
    uri: `${DEFAULT_BASE}/llms.txt`,
    name: 'Agent guidance',
    description: 'When-to-use guidance, endpoint list, versioning policy',
    mimeType: 'text/plain',
  },
  {
    uri: `${DEFAULT_BASE}/api/spec`,
    name: 'OpenAPI spec',
    description: 'Full machine-readable API schema',
    mimeType: 'application/json',
  }
];

/** Resolve a resources/read uri against RESOURCES. Accepts the absolute
 *  manifest URIs and their bare-path spellings ('/llms.txt', '/api/spec'). */
export function resolveResource(uri) {
  const raw = String(uri || '');
  return RESOURCES.find(r => r.uri === raw || r.uri.endsWith(raw));
}

const TOOLS = [
  {
    name: 'compute_single_turn',
    description: 'TTFT, TPOT and total walltime for a single-turn chat request. Speeds in tok/s.',
    inputSchema: {
      type: 'object',
      properties: {
        promptTokens: { type: 'number', description: 'Prompt size in tokens' },
        outputTokens: { type: 'number', description: 'Generation length in tokens' },
        prefillSpeed: { type: 'number', description: 'Prefill speed tok/s (compute-bound)' },
        decodeSpeed: { type: 'number', description: 'Decode speed tok/s (bandwidth-bound)' }
      },
      required: ['promptTokens', 'outputTokens', 'prefillSpeed', 'decodeSpeed']
    }
  },
  {
    name: 'compute_agentic_loop',
    description: 'Turn-by-turn walltime for a multi-turn tool-calling loop, with and without prefix caching.',
    inputSchema: {
      type: 'object',
      properties: {
        numTurns: { type: 'number' },
        basePromptTokens: { type: 'number' },
        toolOutputTokensPerTurn: { type: 'number' },
        decodeTokensPerTurn: { type: 'number' },
        prefillSpeed: { type: 'number' },
        decodeSpeed: { type: 'number' },
        enablePrefixCaching: { type: 'boolean' }
      },
      required: ['numTurns', 'basePromptTokens', 'toolOutputTokensPerTurn', 'decodeTokensPerTurn', 'prefillSpeed', 'decodeSpeed']
    }
  },
  {
    name: 'kv_cache_vram',
    description: 'KV-cache VRAM for an architecture at a context length. precisionBytes: 2=FP16, 1=FP8, 0.5=INT4.',
    inputSchema: {
      type: 'object',
      properties: {
        architecture: { type: 'string', enum: ['llama70b', 'llama8b', 'qwen72b', 'mistral7b'] },
        contextLength: { type: 'number' },
        precisionBytes: { type: 'number' },
        batchSize: { type: 'number' }
      },
      required: ['architecture', 'contextLength']
    }
  },
  {
    name: 'vram_from_hf_id',
    description: 'Total VRAM (weights + KV cache) for any Hugging Face model at a given context. Architecture auto-resolved from HF config.',
    inputSchema: {
      type: 'object',
      properties: {
        hfId: { type: 'string' },
        context: { type: 'number' },
        quant: { type: 'string' },
        vramGb: { type: 'number', description: 'Optional budget; returns fits + maxContextTokens' }
      },
      required: ['hfId', 'context']
    }
  },
  {
    name: 'hardware_presets',
    description: 'Measured hardware presets with prefill/decode tok/s.',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'benchmarks',
    description: 'Live community benchmark runs grouped by hardware/model with median tok/s and CI95.',
    // Full filter surface (#484): these all work server-side (passthrough to
    // GET /api/benchmarks) but were undiscoverable from the inputSchema.
    inputSchema: {
      type: 'object',
      properties: {
        groupBy: { type: 'string', enum: ['hardwareModel', 'hardware', 'model', 'quant'], description: 'Cohort key (default hardwareModel = hardware × model family × engine build)' },
        limit: { type: 'number', description: 'Page size (default 25, max 200)' },
        cursor: { type: 'string', description: 'Opaque next_cursor from the previous page' },
        hardware: { type: 'string', description: 'Hardware substring filter, e.g. "rtx 3090"' },
        model: { type: 'string', description: 'Model family or hfId substring, e.g. "qwen3.6-27b"' },
        quant: { type: 'string', description: 'Exact quantization, e.g. q4_k_m' },
        hwClass: { type: 'string', enum: ['discrete_gpu', 'unified', 'cpu_only'] },
        engine: { type: 'string', description: 'Engine tag substring, e.g. "llama.cpp"' },
        context_band: { type: 'string', enum: ['lt1k', '1k-8k', '8k-32k', '32k+'] },
        max_age: { type: 'number', description: 'Exclude runs older than N days' },
        crossEngine: { type: 'boolean', description: 'Merge cohorts across engine builds' },
        include_outliers: { type: 'boolean', description: 'Include IQR-flagged runs in stats' },
        outlierIqrs: { type: 'number', description: 'Outlier fence in IQRs (1-10, default 2.5)' }
      }
    }
  },
  {
    name: 'cost_per_1m',
    description: '$/1M tokens on owned hardware: amortized purchase price + electricity.',
    inputSchema: {
      type: 'object',
      properties: {
        hardwarePriceUsd: { type: 'number' },
        powerDrawWatts: { type: 'number' },
        electricityRatePerKwh: { type: 'number' },
        promptTokens: { type: 'number' },
        outputTokens: { type: 'number' },
        prefillSpeed: { type: 'number' },
        decodeSpeed: { type: 'number' }
      },
      required: ['hardwarePriceUsd', 'powerDrawWatts', 'prefillSpeed', 'decodeSpeed']
    }
  },
  {
    name: 'engine_flags',
    description: 'Documented llama.cpp/vLLM launch-flag speed deltas applied to base speeds, with audit trail.',
    inputSchema: {
      type: 'object',
      properties: {
        flags: { type: 'string', description: 'comma-separated ids: flash-attn,kv-q8,kv-q4,no-mmap,vllm-fp8-kv,vllm-o3' },
        prefillSpeed: { type: 'number', description: 'Base prefill speed tok/s (defaults to 3800 like REST)' },
        decodeSpeed: { type: 'number', description: 'Base decode speed tok/s (defaults to 105 like REST)' },
        promptTokens: { type: 'number', description: 'Prompt size in tokens for the simulated single turn (default 2048)' },
        outputTokens: { type: 'number', description: 'Generation length in tokens for the simulated single turn (default 512)' }
      },
      required: ['flags']
    }
  }
];

/** Shared output-schema fragments: every REST payload is stamped with these. */
const SCHEMA_INPUTS = {
  type: 'object',
  description: 'Echo of the effective input parameters (defaults filled in).'
};
const SCHEMA_RATE_LIMIT = {
  type: 'object',
  properties: {
    limit: { type: 'number' },
    remaining: { type: 'number' },
    reset: { type: 'number' },
    window_seconds: { type: 'number' },
    policy: { type: 'string' }
  }
};
const SCHEMA_SPEED_STAT = {
  type: 'object',
  properties: {
    median: { type: ['number', 'null'] },
    q1: { type: ['number', 'null'] },
    q3: { type: ['number', 'null'] },
    min: { type: ['number', 'null'] },
    max: { type: ['number', 'null'] },
    ci95: { type: ['number', 'null'] },
    label: { type: 'string' }
  }
};

/** Per-tool outputSchema (MCP 2025-06-18): mirrors the upstream REST payloads
 *  so typed clients can machine-read results via result.structuredContent
 *  instead of JSON-parsing content[0].text. */
const OUTPUT_SCHEMAS = {
  compute_single_turn: {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'Deterministic calc id, e.g. calc_…' },
      inputs: SCHEMA_INPUTS,
      warnings: { type: 'array', items: { type: 'string' } },
      ttftSeconds: { type: 'number', description: 'Time to first token' },
      tpotMs: { type: 'number', description: 'Time per output token, ms' },
      decodeSeconds: { type: 'number' },
      totalWalltimeSeconds: { type: 'number' },
      effectiveThroughputTokPerSec: { type: 'number' },
      prefillSharePct: { type: 'number' },
      decodeSharePct: { type: 'number' },
      schema_version: { type: 'string' },
      rate_limit: SCHEMA_RATE_LIMIT
    },
    required: ['id', 'inputs', 'ttftSeconds', 'tpotMs', 'totalWalltimeSeconds']
  },
  compute_agentic_loop: {
    type: 'object',
    properties: {
      id: { type: 'string' },
      inputs: SCHEMA_INPUTS,
      warnings: { type: 'array', items: { type: 'string' } },
      turns: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            turn: { type: 'number' },
            totalPromptTokens: { type: 'number' },
            newTokensPrefilled: { type: 'number' },
            isCached: { type: 'boolean' },
            prefillSeconds: { type: 'number' },
            decodeSeconds: { type: 'number' },
            turnWalltimeSeconds: { type: 'number' },
            cumulativeWalltimeSeconds: { type: 'number' }
          }
        }
      },
      finalContextTokens: { type: 'number' },
      totalWalltimeSeconds: { type: 'number' },
      walltimeWithoutCachingSeconds: { type: 'number' },
      cachingSavesSeconds: { type: 'number' },
      cachingSavesPct: { type: 'number' },
      schema_version: { type: 'string' },
      rate_limit: SCHEMA_RATE_LIMIT
    },
    required: ['id', 'inputs', 'turns', 'totalWalltimeSeconds']
  },
  kv_cache_vram: {
    type: 'object',
    properties: {
      id: { type: 'string' },
      inputs: SCHEMA_INPUTS,
      bytesPerToken: { type: 'number' },
      kbPerToken: { type: 'number' },
      totalGb: { type: 'number' },
      totalMb: { type: 'number' },
      formula: { type: 'string' },
      schema_version: { type: 'string' },
      rate_limit: SCHEMA_RATE_LIMIT
    },
    required: ['id', 'bytesPerToken', 'totalGb']
  },
  vram_from_hf_id: {
    type: 'object',
    properties: {
      inputs: SCHEMA_INPUTS,
      model: {
        type: 'object',
        properties: {
          hfId: { type: 'string' },
          family: { type: 'string' },
          resolutionSource: { type: 'string' },
          architecture: { type: 'object' },
          paramsTotal: { type: 'number' },
          paramsB: { type: 'number' },
          notes: { type: 'array', items: { type: 'string' } }
        }
      },
      weights: {
        type: 'object',
        properties: {
          gb: { type: 'number' },
          source: { type: 'string' },
          sourceKind: { type: 'string' },
          quant: { type: 'string' },
          bytesPerParam: { type: 'number' }
        }
      },
      kvCache: {
        type: 'object',
        properties: {
          bytesPerToken: { type: 'number' },
          kbPerToken: { type: 'number' },
          mbPerToken: { type: 'number' },
          gbAtContext: { type: 'number' },
          formula: { type: 'string' }
        }
      },
      total: {
        type: 'object',
        properties: {
          gb: { type: 'number' },
          breakdown: {
            type: 'object',
            properties: {
              weightsGb: { type: 'number' },
              kvCacheGb: { type: 'number' }
            }
          }
        }
      },
      contextWindow: { type: 'object' },
      fits: {
        type: 'object',
        properties: {
          vramGb: { type: 'number' },
          fits: { type: 'boolean' },
          headroomGb: { type: 'number' },
          maxContextTokens: { type: 'number' },
          note: { type: 'string' }
        }
      },
      projection: { type: ['object', 'null'] }
    },
    required: ['model', 'weights', 'kvCache', 'total']
  },
  hardware_presets: {
    type: 'object',
    properties: {
      description: { type: 'string' },
      hardware: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            name: { type: 'string' },
            prefillSpeedTokPerSec: { type: 'number' },
            decodeSpeedTokPerSec: { type: 'number' },
            vramBandwidth: { type: 'string' },
            badge: { type: 'string' },
            tdpWatts: { type: 'number' },
            loadWatts: { type: 'number' },
            psuWatts: { type: 'number' },
            powerNote: { type: 'string' }
          }
        }
      },
      scenarios: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            label: { type: 'string' },
            promptTokens: { type: 'number' },
            outputTokens: { type: 'number' }
          }
        }
      },
      schema_version: { type: 'string' },
      rate_limit: SCHEMA_RATE_LIMIT
    },
    required: ['hardware']
  },
  benchmarks: {
    type: 'object',
    properties: {
      description: { type: 'string' },
      snapshot: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          createdAt: { type: 'string' },
          runCount: { type: 'number' }
        }
      },
      snapshotAt: { type: 'string' },
      total: { type: 'number', description: 'Groups after filtering' },
      matchedRuns: { type: 'number' },
      items: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            key: { type: 'string' },
            runs: { type: 'number' },
            runsInStats: { type: 'number' },
            prefill: SCHEMA_SPEED_STAT,
            decode: SCHEMA_SPEED_STAT,
            engines: { type: 'array', items: { type: 'string' } },
            confidence: { type: 'object' },
            freshness: { type: 'object' },
            bestRun: { type: 'object' },
            caveats: { type: 'array' }
          }
        }
      },
      has_more: { type: 'boolean' },
      next_cursor: { type: ['string', 'null'] },
      caveats: { type: 'array' },
      schema_version: { type: 'string' },
      rate_limit: SCHEMA_RATE_LIMIT
    },
    required: ['items', 'total']
  },
  cost_per_1m: {
    type: 'object',
    properties: {
      id: { type: 'string' },
      inputs: SCHEMA_INPUTS,
      effectiveThroughputTokPerSec: { type: 'number' },
      requestsPerHour: { type: 'number' },
      hardwareCostUsdPerHour: { type: 'number' },
      electricityCostUsdPerHour: { type: 'number' },
      totalCostUsdPerHour: { type: 'number' },
      costUsdPerMillionTokens: { type: 'number' },
      costUsdPerThousandRequests: { type: 'number' },
      schema_version: { type: 'string' },
      rate_limit: SCHEMA_RATE_LIMIT
    },
    required: ['id', 'costUsdPerMillionTokens']
  },
  engine_flags: {
    type: 'object',
    properties: {
      id: { type: 'string' },
      inputs: SCHEMA_INPUTS,
      adjusted: {
        type: 'object',
        properties: {
          prefillSpeed: { type: 'number' },
          decodeSpeed: { type: 'number' },
          kvBits: { type: ['number', 'null'] }
        }
      },
      totalPrefillDeltaPct: { type: 'number' },
      totalDecodeDeltaPct: { type: 'number' },
      adjustments: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            engine: { type: 'string' },
            flag: { type: 'string' },
            label: { type: 'string' },
            prefillDeltaPct: { type: 'number' },
            decodeDeltaPct: { type: 'number' },
            kvBits: { type: ['number', 'null'] },
            source: { type: 'string' },
            sourceNote: { type: 'string' }
          }
        }
      },
      warnings: { type: 'array', items: { type: 'string' } },
      simulation: { type: 'object' },
      schema_version: { type: 'string' },
      rate_limit: SCHEMA_RATE_LIMIT
    },
    required: ['id', 'adjusted', 'adjustments']
  }
};

for (const tool of TOOLS) {
  tool.outputSchema = OUTPUT_SCHEMAS[tool.name];
}

/** Build the upstream REST URL + query for a tool call. */
function toolToRequest(name, args = {}) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(args)) {
    if (v !== undefined && v !== null) qs.set(k, String(v));
  }
  switch (name) {
    case 'compute_single_turn':
      qs.set('model', 'singleTurn');
      return { path: '/api/compute', query: qs };
    case 'compute_agentic_loop':
      qs.set('model', 'agentic');
      return { path: '/api/compute', query: qs };
    case 'kv_cache_vram':
      qs.set('model', 'kvCache');
      return { path: '/api/compute', query: qs };
    case 'cost_per_1m':
      qs.set('model', 'cost');
      return { path: '/api/compute', query: qs };
    case 'engine_flags':
      qs.set('model', 'flagged');
      return { path: '/api/compute', query: qs };
    case 'vram_from_hf_id':
      return { path: '/api/vram', query: qs };
    case 'hardware_presets':
      return { path: '/api/presets', query: qs };
    case 'benchmarks':
      return { path: '/api/benchmarks', query: qs };
    default:
      return null;
  }
}

/** Proxy a tools/call to the internal REST handler via absolute-URL fetch. */
async function callTool(name, args, base) {
  const route = toolToRequest(name, args);
  if (!route) {
    return { content: [{ type: 'text', text: `Unknown tool: ${name}` }], isError: true };
  }
  // In-process dispatch would import handlers directly; fetch keeps one code
  // path and works identically on dev and prod. Vercel functions can fetch
  // their own origin (#833: base resolves from the request, not a hardcoded
  // production origin — self-hosted deployments serve their own data).
  const url = `${base}${route.path}?${route.query.toString()}`;
  const upstream = await fetch(url, { headers: { accept: 'application/json' } });
  const body = await upstream.text();
  const result = {
    content: [{ type: 'text', text: body }],
    isError: !upstream.ok
  };
  // MCP 2025-06-18 structured output: on success, also return the parsed
  // payload as structuredContent (validated against the tool's outputSchema).
  // The verbatim text block stays for backwards compatibility. Error paths
  // keep prose-only content per the CallToolResult spec.
  if (!result.isError) {
    try {
      result.structuredContent = JSON.parse(body);
    } catch {
      // Non-JSON body: text block is all we have.
    }
  }
  return result;
}

/** App release version from package.json — the same source /api/version
 *  reads — so the MCP handshake no longer reports a third, hardcoded
 *  version beside /api/version and /api/spec (#880). 'unknown' if the
 *  deploy bundle ships without package.json so metadata never 500s. */
function appVersion() {
  try {
    const pkg = JSON.parse(
      readFileSync(new URL('../package.json', import.meta.url), 'utf8')
    );
    return pkg.version || 'unknown';
  } catch {
    return 'unknown';
  }
}

/** Custom response headers browser fetch() consumers must be able to read
 *  (CORS-safelisted response headers would otherwise hide them). */
const EXPOSED_HEADERS = [
  'X-RateLimit-Limit',
  'X-RateLimit-Remaining',
  'X-RateLimit-Reset',
  'Retry-After'
];

function exposeAgentHeaders(res) {
  const expose = new Set(
    (res.getHeader('Access-Control-Expose-Headers') || '')
      .split(',')
      .map(s => s.trim())
      .filter(Boolean)
  );
  for (const h of EXPOSED_HEADERS) expose.add(h);
  res.setHeader('Access-Control-Expose-Headers', [...expose].join(', '));
}

function json(res, body, status = 200) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  exposeAgentHeaders(res);
  // Every other API route carries Vary (via _markdown negotiation). Without it,
  // shared caches can key this route on the URL alone and replay a compressed
  // variant to clients that cannot decompress it. Keep parity with _markdown.js.
  res.setHeader('Vary', 'Accept, Accept-Encoding');
  res.end(JSON.stringify(body));
}

// mcp.js wins Vercel file-routing over the catch-all dispatcher, so shared
// middleware from [...path].js must be imported explicitly here.
import { applyServerTiming } from './_server_timing.js';

export default async function handler(req, res) {
  // mcp.js wins Vercel file-routing over the catch-all, so wire response
  // telemetry here too (Server-Timing + Vary: Origin — issues #914/#916).
  applyServerTiming(res);
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept, Mcp-Session-Id');
    applySchemaHeaders(res);
    return res.end();
  }

  // MCP calls count against the same fixed-window bucket as the agent's own
  // REST calls (#877): stamp X-RateLimit-Limit/-Remaining/-Reset on every
  // response so an MCP-only client can pace itself like a REST client.
  const rl = rateLimit(clientKey(req));
  res.setHeader('X-RateLimit-Limit', String(rl.limit));
  res.setHeader('X-RateLimit-Remaining', String(rl.remaining));
  res.setHeader('X-RateLimit-Reset', String(rl.resetEpochSec));
  applySchemaHeaders(res);

  if (!rl.allowed) {
    // Keep the JSON-RPC envelope even on exhaustion — a bare HTTP error body
    // would break strict clients. Retry-After carries the backoff hint and
    // `data` mirrors it in-band (#877).
    res.setHeader('Retry-After', String(rl.retryAfterSec));
    return json(res, {
      jsonrpc: '2.0',
      id: null,
      error: {
        code: -32000,
        message: `Rate limit exceeded: max ${rl.limit} requests per ${RATE_WINDOW_MS / 1000}s per client (per serverless instance).`,
        data: { retryAfterSeconds: rl.retryAfterSec, reset: rl.resetEpochSec }
      }
    }, 429);
  }

  if (req.method === 'GET') {
    // Streamable HTTP transport (#491): a GET on the MCP endpoint must either
    // open an SSE stream or return 405 Method Not Allowed. This server is
    // stateless and offers no server-initiated stream, so 405 it is — with an
    // Allow header (RFC 9110 §15.5.5) and pointers to the discovery surfaces
    // that used to be served here (they remain available there).
    res.statusCode = 405;
    res.setHeader('Allow', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Vary', 'Accept, Accept-Encoding, Origin');
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify({
      error: 'Method not allowed',
      detail: 'This MCP endpoint speaks JSON-RPC over POST only (stateless Streamable HTTP, no SSE stream). GET is reserved by the transport spec.',
      transport: 'streamable-http',
      protocolVersion: '2025-06-18',
      endpoints: { manifest: '/.well-known/mcp.json', spec: '/api/spec', thisEndpoint: '/api/mcp' }
    }));
  }

  if (req.method !== 'POST') {
    return json(res, { error: 'Method not allowed' }, 405);
  }

  let rpc;
  try {
    rpc = typeof req.body === 'object' && req.body !== null ? req.body : JSON.parse(await readBody(req));
  } catch {
    return json(res, { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }, 400);
  }

  // A message WITHOUT an id is a notification per JSON-RPC 2.0: execute
  // nothing, reply 202 with no body (#870). Previously an id-less tools/call
  // was executed and answered with id coerced to null — an unsolicited
  // response a pipelining client could mis-attribute to another request.
  if (rpc !== null && typeof rpc === 'object' && !Array.isArray(rpc) && rpc.id === undefined) {
    res.statusCode = 202;
    res.setHeader('Vary', 'Accept, Accept-Encoding');
    return res.end();
  }

  // Batch arrays are not supported by this stateless server: reject cleanly
  // with -32600 instead of destructuring the array into nonsense fields (#870).
  if (Array.isArray(rpc)) {
    return json(res, {
      jsonrpc: '2.0',
      id: null,
      error: { code: -32600, message: 'Invalid Request: batch arrays are not supported; send one JSON-RPC message per POST' }
    });
  }

  const { id, method, params } = rpc || {};
  const reply = (result) => json(res, { jsonrpc: '2.0', id: id ?? null, result });

  switch (method) {
    case 'initialize':
      return reply({
        protocolVersion: '2025-06-18',
        capabilities: { tools: {}, resources: {} },
        serverInfo: {
          name: 'llm-prefill-decode-visualizer',
          title: 'LLM Prefill & Decode Speed Visualizer',
          // Same release version /api/version reports (package.json) — not a
          // third, transport-specific literal (#880).
          version: appVersion()
        },
        // Wire schema version so an MCP-only client can run the
        // compatibility check from CHANGELOG-API.md at handshake time,
        // before invoking any tool (#880). Mirrors X-Schema-Version.
        schema_version: SCHEMA_VERSION,
        instructions:
          'Deterministic LLM-inference math API. Use compute_single_turn for TTFT/TPOT questions, ' +
          'compute_agentic_loop for multi-turn walltime, kv_cache_vram or vram_from_hf_id for VRAM fit, ' +
          'cost_per_1m for budgeting. Speeds are tok/s; prefill is compute-bound, decode is bandwidth-bound. ' +
          'Agent guidance and the full schema are also available as MCP resources (resources/list).'
      });

    case 'notifications/initialized':
      res.statusCode = 202;
      res.setHeader('Vary', 'Accept, Accept-Encoding');
      return res.end();

    case 'tools/list':
      return reply({ tools: TOOLS });

    // Resources advertised by /.well-known/mcp.json — served here so the
    // manifest's promise is real (#794).
    case 'resources/list':
      return reply({
        resources: RESOURCES.map(({ uri, name, description, mimeType }) => ({ uri, name, description, mimeType }))
      });

    case 'resources/read': {
      const resource = resolveResource(params?.uri);
      if (!resource) {
        return json(res, {
          jsonrpc: '2.0', id: id ?? null,
          error: { code: -32602, message: `Unknown resource uri: ${params?.uri}` }
        });
      }
      try {
        const upstream = await fetch(resource.uri, { headers: { accept: resource.mimeType } });
        const text = await upstream.text();
        return reply({
          contents: [{ uri: resource.uri, mimeType: resource.mimeType, text }]
        });
      } catch (err) {
        return json(res, {
          jsonrpc: '2.0', id: id ?? null,
          error: { code: -32603, message: `Failed to read resource: ${err.message}` }
        });
      }
    }

    case 'tools/call': {
      const { name, arguments: args } = params || {};
      try {
        const result = await callTool(name, args, resolveBase(req));
        return reply(result);
      } catch (err) {
        return reply({ content: [{ type: 'text', text: `Tool error: ${err.message}` }], isError: true });
      }
    }

    case 'ping':
      return reply({});

    default:
      // JSON-RPC application errors ride in an HTTP 200 body per the MCP
      // Streamable HTTP transport — non-2xx is reserved for transport
      // failures and official SDK clients discard non-2xx bodies (#870).
      return json(res, { jsonrpc: '2.0', id: id ?? null, error: { code: -32601, message: `Method not found: ${method}` } });
  }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', c => { data += c; });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}
