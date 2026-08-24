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

const BASE = 'https://llm-prefill-decode-visualizer.vercel.app';

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
    inputSchema: { type: 'object', properties: { groupBy: { type: 'string' }, limit: { type: 'number' } } }
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
        prefillSpeed: { type: 'number' },
        decodeSpeed: { type: 'number' }
      },
      required: ['flags', 'prefillSpeed', 'decodeSpeed']
    }
  }
];

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
async function callTool(name, args) {
  const route = toolToRequest(name, args);
  if (!route) {
    return { content: [{ type: 'text', text: `Unknown tool: ${name}` }], isError: true };
  }
  // In-process dispatch would import handlers directly; fetch keeps one code
  // path and works identically on dev and prod. Vercel functions can fetch
  // their own origin.
  const url = `${BASE}${route.path}?${route.query.toString()}`;
  const upstream = await fetch(url, { headers: { accept: 'application/json' } });
  const body = await upstream.text();
  return {
    content: [{ type: 'text', text: body }],
    isError: !upstream.ok
  };
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
  res.end(JSON.stringify(body));
}

export default async function handler(req, res) {
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
    // Discovery: point at the manifest and spec.
    return json(res, {
      server: 'llm-prefill-decode-visualizer',
      transport: 'streamable-http',
      protocolVersion: '2025-06-18',
      endpoints: { manifest: '/.well-known/mcp.json', spec: '/api/spec', thisEndpoint: '/api/mcp' }
    });
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

  const { id, method, params } = rpc || {};
  const reply = (result) => json(res, { jsonrpc: '2.0', id: id ?? null, result });

  switch (method) {
    case 'initialize':
      return reply({
        protocolVersion: '2025-06-18',
        capabilities: { tools: {} },
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
          'cost_per_1m for budgeting. Speeds are tok/s; prefill is compute-bound, decode is bandwidth-bound.'
      });

    case 'notifications/initialized':
      res.statusCode = 202;
      return res.end();

    case 'tools/list':
      return reply({ tools: TOOLS });

    case 'tools/call': {
      const { name, arguments: args } = params || {};
      try {
        const result = await callTool(name, args);
        return reply(result);
      } catch (err) {
        return reply({ content: [{ type: 'text', text: `Tool error: ${err.message}` }], isError: true });
      }
    }

    case 'ping':
      return reply({});

    default:
      return json(res, { jsonrpc: '2.0', id: id ?? null, error: { code: -32601, message: `Method not found: ${method}` } }, 404);
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
