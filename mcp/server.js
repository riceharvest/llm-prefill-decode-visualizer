#!/usr/bin/env node
/**
 * MCP server wrapping the LLM Prefill & Decode Visualizer API.
 *
 * Stdio transport. Base URL is configurable via the VISUALIZER_API_URL env
 * var and defaults to the production deployment.
 *
 * Tool metadata lives declaratively in ./tools.js (single source of truth —
 * contract tests read it directly); this file wires it into zod schemas,
 * handlers, and the stdio transport.
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
import { TOOLS } from './tools.js';

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

/** Build a zod schema object from a declarative property map in tools.js. */
function zodSchemaFor(def) {
  const shape = {};
  for (const [propName, p] of Object.entries(def.properties)) {
    let schema;
    switch (p.type) {
      case 'enum':
        schema = z.enum(p.values);
        break;
      case 'boolean':
        schema = z.boolean();
        break;
      case 'number':
        schema = p.integer ? z.number().int() : z.number();
        if (p.min !== undefined) schema = schema.min(p.min);
        if (p.max !== undefined) schema = schema.max(p.max);
        break;
      case 'string':
        schema = z.string();
        break;
      default:
        throw new Error(`tool ${def.name}: property ${propName} has unsupported type "${p.type}"`);
    }
    shape[propName] = schema.describe(p.description);
  }
  return shape;
}

// ---------------------------------------------------------------------------
// Handlers, keyed by tool name
// ---------------------------------------------------------------------------

const HANDLERS = {
  compute_inference: async (args) => jsonResult(await apiGet('/api/compute', args)),
  search_runs: async (args) => jsonResult(await apiGet('/api/localmaxxing', args)),
  best_configs: async (args) => jsonResult(await apiGet('/api/best', args)),
  compare_hardware: async ({ hardwareA, hardwareB, model, quant }) => {
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
};

// ---------------------------------------------------------------------------
// Registration + transport
// ---------------------------------------------------------------------------

const server = new McpServer({
  name: 'llm-prefill-decode-visualizer',
  version: '1.0.0',
});

for (const def of TOOLS) {
  const handler = HANDLERS[def.name];
  if (!handler) throw new Error(`MCP tool "${def.name}" has no handler registered`);
  server.tool(def.name, def.description, zodSchemaFor(def), handler);
}

const transport = new StdioServerTransport();
await server.connect(transport);
console.error(`llm-prefill-decode-visualizer MCP server ready (API: ${BASE_URL})`);
