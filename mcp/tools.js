// Declarative MCP tool registry — single source of truth for tool metadata.
//
// mcp/server.js imports this module and turns each definition into a zod
// schema at registration time (see zodSchemaFor there), so the descriptions
// agents see and the schemas they must satisfy can never drift apart.
//
// IMPORTANT: this file must stay dependency-free (no zod, no MCP SDK) so that
// contract tests can import it without installing the server's runtime deps.

/**
 * @typedef {Object} ToolProperty
 * @property {'string'|'number'|'boolean'|'enum'} type
 * @property {string} description  human/agent-facing explanation (required)
 * @property {Array<string>} [values]  choices when type is 'enum'
 * @property {boolean} [integer]  restrict numbers to integers
 * @property {number} [min]  inclusive lower bound for numbers
 * @property {number} [max]  inclusive upper bound for numbers
 */

/**
 * @typedef {Object} ToolDef
 * @property {string} name  snake_case tool name
 * @property {string} description  shown to agents in tools/list
 * @property {string} endpoint  visualizer API path backing this tool
 * @property {Record<string, ToolProperty>} properties  input schema
 * @property {string[]} required  names of required properties
 * @property {string[]} [apiParamExceptions]  property names that are tool-level
 *   only (not passed through verbatim as query params to `endpoint`)
 */

export const TOOLS = [
  {
    name: 'compute_inference',
    description:
      'Run LLM inference math against the visualizer: TTFT, TPOT, walltime, effective throughput, KV-cache VRAM. Scenarios: singleTurn (prompt/output tokens at given prefill/decode speeds), speculative (draft-token acceptance math), batched (concurrent streams), agentic (multi-turn with optional prefix caching), kvCache (VRAM for a given architecture/context/precision). Omit `model` to get a self-describing capability list.',
    endpoint: '/api/compute',
    properties: {
      model: {
        type: 'enum',
        values: ['singleTurn', 'speculative', 'batched', 'agentic', 'kvCache'],
        description: 'Scenario to compute. Omit for a capability list.'
      },
      promptTokens: { type: 'number', description: 'singleTurn/batched/agentic' },
      outputTokens: { type: 'number', description: 'singleTurn/batched/agentic' },
      prefillSpeed: { type: 'number', description: 'tok/s' },
      decodeSpeed: { type: 'number', description: 'tok/s' },
      numTurns: { type: 'number', integer: true, description: 'agentic: turns per session' },
      enablePrefixCaching: { type: 'boolean', description: 'agentic' },
      batchSize: { type: 'number', integer: true, description: 'batched/kvCache: concurrent streams' },
      draftTokens: { type: 'number', integer: true, description: 'speculative: draft tokens per step' },
      acceptanceRate: { type: 'number', description: 'speculative: 0..1' },
      architecture: {
        type: 'enum',
        values: ['llama70b', 'llama8b', 'qwen72b', 'mistral7b'],
        description: 'kvCache: model architecture preset'
      },
      contextLength: { type: 'number', integer: true, description: 'kvCache: context length in tokens' },
      precisionBytes: { type: 'number', description: 'kvCache: KV element size — 2 (FP16), 1 (FP8), 0.5 (INT4)' }
    },
    required: []
  },
  {
    name: 'search_runs',
    description:
      'Search community-measured single-stream LLM benchmark runs (from localmaxxing.com). Bare call returns a hardware-group summary; pass filters (`hardware`, `model`, `quant`, `limit`) to get raw runs with measured prefillTokPerSec / decodeTokPerSec.',
    endpoint: '/api/localmaxxing',
    properties: {
      hardware: { type: 'string', description: 'Substring match on rig name/key, e.g. "4090", "M4"' },
      model: { type: 'string', description: 'Substring match on normalized model family or HF id, e.g. "llama", "qwen3"' },
      quant: { type: 'string', description: 'Exact quantization, e.g. "q4_k_m"' },
      limit: { type: 'number', integer: true, min: 1, max: 500, description: 'Max runs returned (default 50, max 500)' }
    },
    required: []
  },
  {
    name: 'best_configs',
    description:
      'Ranked hardware×model configs by measured community speed (median per group, outlier-resistant). Answers questions like "fastest hardware for a 8B model at q4_k_m". Rank with `by` (decode/prefill/efficiency); narrow with `model`, `maxParamsB`, `quant`, `hwClass`, `hardware`, `limit`.',
    endpoint: '/api/best',
    properties: {
      by: {
        type: 'enum',
        values: ['decode', 'prefill', 'efficiency'],
        description: 'Rank metric (default decode)'
      },
      model: { type: 'string', description: 'Restrict to model family / HF id substring, e.g. "llama-8b", "qwen"' },
      maxParamsB: { type: 'number', description: 'Only models at or under this size (billions of params)' },
      quant: { type: 'string', description: 'Exact quantization match, e.g. q4_k_m' },
      hwClass: {
        type: 'enum',
        values: ['discrete_gpu', 'unified', 'cpu_only'],
        description: 'Hardware class filter'
      },
      hardware: { type: 'string', description: 'Restrict rigs by name substring' },
      limit: { type: 'number', integer: true, min: 1, max: 50, description: 'Max results (default 10)' }
    },
    required: []
  },
  {
    name: 'compare_hardware',
    description:
      'A-vs-B hardware comparison: fetches measured community data for the two rigs named by the required `hardwareA` and `hardwareB` substrings, aligns them on shared model families (narrow both sides with optional `model` / `quant`), and returns per-metric deltas (decode %, prefill %) plus a verdict of which rig is faster for what.',
    endpoint: '/api/best',
    properties: {
      hardwareA: { type: 'string', description: 'Rig A name substring, e.g. "4090", "M4 Max"' },
      hardwareB: { type: 'string', description: 'Rig B name substring, e.g. "3090", "7800X3D"' },
      model: { type: 'string', description: 'Restrict both sides to a model family substring, e.g. "llama"' },
      quant: { type: 'string', description: 'Exact quantization match on both sides, e.g. q4_k_m' }
    },
    required: ['hardwareA', 'hardwareB'],
    apiParamExceptions: ['hardwareA', 'hardwareB']
  }
];

/** Look up a tool definition by name (throws on unknown names). */
export function toolDef(name) {
  const def = TOOLS.find(t => t.name === name);
  if (!def) throw new Error(`unknown MCP tool: ${name}`);
  return def;
}
