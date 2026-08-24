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

function json(res, body, status = 200) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.end(JSON.stringify(body));
}

export default async function handler(req, res) {
  // /api/mcp is file-routed by Vercel and never passes through the catch-all
  // router's shared middleware (api/[...path].js). The platform compresses
  // this JSON per Accept-Encoding, so — like every other API route — the
  // response must declare Vary: Accept-Encoding or a CDN may cross-serve an
  // identity body to a gzip-capable client (or vice versa) (#1002).
  res.setHeader('Vary', 'Accept-Encoding');

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept, Mcp-Session-Id');
    return res.end();
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
          version: '1.0.0'
        },
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
