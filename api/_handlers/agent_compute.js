// GET|POST /api/agent/compute.json — agent-friendly wrapper around the
// inference math the MCP `compute_inference` tool exposes via GET /api/compute
// (api/_handlers/compute.js). This endpoint WRAPS computeBody() — it never
// re-implements any math — and reshapes the response for agents:
//
//   - flat, self-describing JSON: every response carries a `description`,
//     `endpoint`, `generatedAt`, echoed `scenario`, resolved `inputs`,
//     the deterministic calc id, and all math fields at the top level;
//   - a bare call (no ?model=) returns the same capability catalog as
//     GET /api/compute (models, batch contract, sanity codes, dry_run);
//   - batches (?batch=[...] / POST {"batch":[...]}) pass straight through
//     with the envelope fields added around them;
//   - errors keep the shared RFC 9457 problem+json rendering (ApiError
//     bubbles to sendProblemFromError), so agents branch on the same
//     machine-readable codes as every other endpoint.
import { computeBody, isDryRun } from './compute.js';
import { enforceRateLimit } from '../_ratelimit.js';
import { sendJson } from '../_schema.js';
import { sendProblemFromError } from '../_errors.js';

export const config = { runtime: 'nodejs' };

const ENDPOINT = '/api/agent/compute.json';

// Thin wrapper over the shared sender so every response carries
// schema_version + X-Schema-Version (see _schema.js / CHANGELOG-API.md).
// Results are pure math over echoed inputs — safe to cache briefly.
function json(res, body, status = 200) {
  return sendJson(res, body, { status, cacheTtl: 600 });
}

const DESCRIPTION =
  'LLM inference math for agents: TTFT, TPOT, walltime, effective throughput and KV-cache VRAM. ' +
  'Pass ?model=<singleTurn|speculative|batched|agentic|kvCache|flagged|cost> plus parameters ' +
  '(or POST JSON, or batch up to 50 sets via {"batch":[...]}). All speeds are user-supplied tok/s ' +
  'assumptions, not measurements; a bare call returns the full capability catalog. ' +
  'Identical math to GET /api/compute and the MCP compute_inference tool.';

const CAVEATS = [
  'All prefill/decode speeds are caller-provided assumptions in tok/s — this endpoint computes arithmetic, it never measures hardware.',
  'Results carry a non-blocking `warnings` array (empty when plausible) flagging outputs that violate known physical rooflines.',
  'Every result is stamped with a deterministic calc_<hash> id derived from the resolved inputs — reuse it via /api/calc/<id>.'
];

const RELATED_ENDPOINTS = {
  capabilityCatalog: '/api/agent/compute.json',
  rawEndpoint: '/api/compute?model=&promptTokens=&outputTokens=&prefillSpeed=&decodeSpeed=',
  replayById: '/api/calc/<id>',
  presets: '/api/presets',
  openapiSpec: '/api/spec'
};

/**
 * Shared core: run the existing /api/compute logic and wrap the result in
 * the agent-friendly envelope. Returns { status, body }; ApiErrors bubble.
 */
export function buildAgentComputeBody(params = {}, now = new Date()) {
  const { status, body } = computeBody(params);

  const base = {
    description: DESCRIPTION,
    endpoint: ENDPOINT,
    generatedAt: now.toISOString(),
    caveats: CAVEATS,
    relatedEndpoints: RELATED_ENDPOINTS
  };

  // Capability catalog (no model given): pass through the models/batch/
  // sanity/dry_run docs under our own envelope description.
  if (!(params.model || params.m)) {
    const { description: _drop, ...catalog } = body ?? {};
    return { status, body: { ...base, ...catalog } };
  }

  // Single scenario: flatten the math fields to the top level next to the
  // echoed scenario + resolved inputs so agents read one flat object.
  return {
    status,
    body: { ...base, scenario: params.model || params.m || '', ...body }
  };
}

export default function handler(req, res) {
  if (!enforceRateLimit(req, res)) return;

  // Accept both GET (?model=singleTurn&...) and POST (JSON body), like /api/compute.
  const params = req.method === 'POST' ? (req.body || {}) : req.query;

  try {
    const { status, body } = buildAgentComputeBody(params);
    return json(res, body, status);
  } catch (err) {
    return sendProblemFromError(res, req, err);
  }
}

export { isDryRun };
