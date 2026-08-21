#!/usr/bin/env node
/**
 * MCP server wrapping the LLM Prefill & Decode Visualizer API.
 *
 * Stdio transport. Base URL is configurable via the VISUALIZER_API_URL env
 * var and defaults to the production deployment.
 *
 * Tools:
 *   compute_inference — run inference math (TTFT, TPOT, walltime, VRAM)
 *   search_runs       — search community-measured benchmark runs
 *   compare_hardware  — A-vs-B hardware comparison with computed deltas
 *   best_configs      — ranked hardware×model configs by measured speed
 *
 * Human/agent docs: https://llm-prefill-decode-visualizer.vercel.app/llms.txt
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const BASE_URL = (
  process.env.VISUALIZER_API_URL ||
  'https://llm-prefill-decode-visualizer.vercel.app'
).replace(/\/+$/, '');

/** GET {BASE_URL}{path}?query and return parsed JSON. */
async function apiGet(path, params = {}) {
  const url = new URL(path, BASE_URL);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
  }
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`API ${res.status} ${res.statusText} for ${url.pathname}${url.search}: ${text.slice(0, 500)}`);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`API returned non-JSON for ${url.pathname}: ${text.slice(0, 500)}`);
  }
}

function jsonResult(data) {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
}

const server = new McpServer({
  name: 'llm-prefill-decode-visualizer',
  version: '1.0.0',
});

// ---------------------------------------------------------------------------
// compute_inference
// ---------------------------------------------------------------------------
server.tool(
  'compute_inference',
  'Run LLM inference math against the visualizer: TTFT, TPOT, walltime, effective throughput, KV-cache VRAM. Scenarios: singleTurn (prompt/output tokens at given prefill/decode speeds), speculative (draft-token acceptance math), batched (concurrent streams), agentic (multi-turn with optional prefix caching), kvCache (VRAM for a given architecture/context/precision). Omit `model` to get a self-describing capability list.',
  {
    model: z.enum(['singleTurn', 'speculative', 'batched', 'agentic', 'kvCache']).optional()
      .describe('Scenario to compute. Omit for a capability list.'),
    promptTokens: z.number().optional().describe('singleTurn/batched/agentic'),
    outputTokens: z.number().optional().describe('singleTurn/batched/agentic'),
    prefillSpeed: z.number().optional().describe('tok/s'),
    decodeSpeed: z.number().optional().describe('tok/s'),
    numTurns: z.number().int().optional().describe('agentic: turns per session'),
    enablePrefixCaching: z.boolean().optional().describe('agentic'),
    batchSize: z.number().int().optional().describe('batched/kvCache: concurrent streams'),
    draftTokens: z.number().int().optional().describe('speculative: draft tokens per step'),
    acceptanceRate: z.number().optional().describe('speculative: 0..1'),
    architecture: z.enum(['llama70b', 'llama8b', 'qwen72b', 'mistral7b']).optional()
      .describe('kvCache: model architecture preset'),
    contextLength: z.number().int().optional().describe('kvCache: context length in tokens'),
    precisionBytes: z.number().optional().describe('kvCache: KV element size — 2 (FP16), 1 (FP8), 0.5 (INT4)'),
  },
  async (args) => jsonResult(await apiGet('/api/compute', args))
);

// ---------------------------------------------------------------------------
// search_runs
// ---------------------------------------------------------------------------
server.tool(
  'search_runs',
  'Search community-measured single-stream LLM benchmark runs (from localmaxxing.com). Bare call returns a hardware-group summary; pass filters to get raw runs with measured prefillTokPerSec / decodeTokPerSec.',
  {
    hardware: z.string().optional().describe('Substring match on rig name/key, e.g. "4090", "M4"'),
    model: z.string().optional().describe('Substring match on normalized model family or HF id, e.g. "llama", "qwen3"'),
    quant: z.string().optional().describe('Exact quantization, e.g. "q4_k_m"'),
    limit: z.number().int().min(1).max(500).optional().describe('Max runs returned (default 50, max 500)'),
  },
  async (args) => jsonResult(await apiGet('/api/localmaxxing', args))
);

// ---------------------------------------------------------------------------
// best_configs
// ---------------------------------------------------------------------------
server.tool(
  'best_configs',
  'Ranked hardware×model configs by measured community speed (median per group, outlier-resistant). Answers questions like "fastest hardware for a 8B model at q4_k_m".',
  {
    by: z.enum(['decode', 'prefill', 'efficiency']).optional()
      .describe('Rank metric (default decode)'),
    model: z.string().optional().describe('Restrict to model family / HF id substring, e.g. "llama-8b", "qwen"'),
    maxParamsB: z.number().optional().describe('Only models at or under this size (billions of params)'),
    quant: z.string().optional().describe('Exact quantization match, e.g. q4_k_m'),
    hwClass: z.enum(['discrete_gpu', 'unified', 'cpu_only']).optional()
      .describe('Hardware class filter'),
    hardware: z.string().optional().describe('Restrict rigs by name substring'),
    limit: z.number().int().min(1).max(50).optional().describe('Max results (default 10)'),
  },
  async (args) => jsonResult(await apiGet('/api/best', args))
);

// ---------------------------------------------------------------------------
// compare_hardware
// ---------------------------------------------------------------------------
server.tool(
  'compare_hardware',
  'A-vs-B hardware comparison: fetches measured community data for two rigs, aligns them on shared model families, and returns per-metric deltas (decode %, prefill %) plus a verdict of which rig is faster for what.',
  {
    hardwareA: z.string().describe('Rig A name substring, e.g. "4090", "M4 Max"'),
    hardwareB: z.string().describe('Rig B name substring, e.g. "3090", "7800X3D"'),
    model: z.string().optional().describe('Restrict both sides to a model family substring, e.g. "llama"'),
    quant: z.string().optional().describe('Exact quantization match on both sides, e.g. q4_k_m'),
  },
  async ({ hardwareA, hardwareB, model, quant }) => {
    const shared = { model, quant, limit: 50 };
    const [a, b] = await Promise.all([
      apiGet('/api/best', { ...shared, hardware: hardwareA }),
      apiGet('/api/best', { ...shared, hardware: hardwareB }),
    ]);

    const byFamily = (payload) => {
      const map = new Map();
      for (const r of payload.results || []) {
        if (!map.has(r.modelFamily)) map.set(r.modelFamily, r);
      }
      return map;
    };
    const fa = byFamily(a);
    const fb = byFamily(b);
    const families = [...fa.keys()].filter((f) => fb.has(f));

    const pctDelta = (av, bv) =>
      av > 0 && Number.isFinite(bv) ? Math.round(((bv - av) / av) * 1000) / 10 : null;

    const comparisons = families.map((family) => {
      const ra = fa.get(family);
      const rb = fb.get(family);
      const decodeDeltaPct = pctDelta(ra.medianDecodeTokPerSec, rb.medianDecodeTokPerSec);
      const prefillDeltaPct = pctDelta(ra.medianPrefillTokPerSec, rb.medianPrefillTokPerSec);
      let verdict;
      if (decodeDeltaPct === null && prefillDeltaPct === null) {
        verdict = 'inconclusive';
      } else {
        const bFasterDecode = decodeDeltaPct !== null && decodeDeltaPct > 0;
        const bFasterPrefill = prefillDeltaPct !== null && prefillDeltaPct > 0;
        if (bFasterDecode && bFasterPrefill) verdict = `${rb.hardware} faster (decode +${decodeDeltaPct}%, prefill +${prefillDeltaPct}%)`;
        else if (!bFasterDecode && !bFasterPrefill) verdict = `${ra.hardware} faster (decode ${decodeDeltaPct}%, prefill ${prefillDeltaPct}% for ${rb.hardware} vs ${ra.hardware})`;
        else verdict = `mixed: ${bFasterDecode ? rb.hardware : ra.hardware} faster at decode, ${bFasterPrefill ? rb.hardware : ra.hardware} faster at prefill`;
      }
      return {
        modelFamily: family,
        a: { hardware: ra.hardware, quantization: ra.quantization, engine: ra.engine, runsInGroup: ra.runsInGroup, medianDecodeTokPerSec: ra.medianDecodeTokPerSec, medianPrefillTokPerSec: ra.medianPrefillTokPerSec },
        b: { hardware: rb.hardware, quantization: rb.quantization, engine: rb.engine, runsInGroup: rb.runsInGroup, medianDecodeTokPerSec: rb.medianDecodeTokPerSec, medianPrefillTokPerSec: rb.medianPrefillTokPerSec },
        decodeDeltaPct,
        prefillDeltaPct,
        verdict,
      };
    });

    return jsonResult({
      hardwareA: hardwareA,
      hardwareB: hardwareB,
      filters: { model: model ?? null, quant: quant ?? null },
      matchedModelFamilies: comparisons.length,
      matchedRuns: { a: a.matchedRuns, b: b.matchedRuns },
      comparisons,
      note: comparisons.length === 0
        ? 'No overlapping model families between the two rigs for these filters. Raw ranked lists are in `aRanked` / `bRanked`.'
        : 'Deltas are (B − A) / A × 100 on median measured tok/s per shared model family.',
      aRanked: comparisons.length === 0 ? (a.results || []).slice(0, 10) : undefined,
      bRanked: comparisons.length === 0 ? (b.results || []).slice(0, 10) : undefined,
    });
  }
);

// ---------------------------------------------------------------------------
const transport = new StdioServerTransport();
await server.connect(transport);
console.error(`llm-prefill-decode-visualizer MCP server ready (API: ${BASE_URL})`);
