// GET /api/agent/scenario.json — agent-friendly loader for the built-in
// workload scenario presets (the same SCENARIO_PRESETS the UI quick-start
// chips and GET /api/presets expose).
//
// Design goals for agents (mirrors /api/agent/benchmarks.json):
//   - flat, self-describing JSON: every response carries a `description`,
//     an echoed `requestedId` where relevant, and token counts baked into
//     the field names (*Tokens);
//   - validated loads: ?id=<preset> must match a known preset id exactly;
//     unknown or empty-but-present ids are rejected with 400 and the list
//     of valid ids so an agent can self-correct;
//   - derived convenience fields (totalTokens, prefillShare) so an agent
//     never has to do arithmetic it could get wrong;
//   - pointers to the next hop (/api/compute) including a ready-to-use
//     example query for the loaded scenario.
//
// No ?id= → directory mode: every valid scenario id with its counts, so a
// planning agent can pick one without a second round-trip.
import { SCENARIO_PRESETS } from '../../src/utils/presets.js';
import { enforceRateLimit } from '../_ratelimit.js';
import { sendJson } from '../_schema.js';

export const config = { runtime: 'nodejs' };

const ENDPOINT = '/api/agent/scenario.json';

/**
 * Structural guard over the shared preset source: a preset is only served
 * when its shape is intact (string id/label, positive integer token counts).
 * Keeps the API contract safe even if the UI-facing preset file drifts.
 */
export function isValidScenario(s) {
  return Boolean(
    s &&
    typeof s.id === 'string' && s.id.length > 0 &&
    typeof s.label === 'string' && s.label.length > 0 &&
    Number.isInteger(s.promptTokens) && s.promptTokens > 0 &&
    Number.isInteger(s.outputTokens) && s.outputTokens > 0
  );
}

/** Case-insensitive exact-id lookup; whitespace-trimmed. Returns null when absent. */
export function findScenario(id) {
  if (id == null || String(id).trim() === '') return null;
  const needle = String(id).trim().toLowerCase();
  return SCENARIO_PRESETS.find(s => s.id === needle) || null;
}

/**
 * Compact flat per-scenario shape for agents: token counts in the field
 * names, prompt share of the total workload precomputed, no nested objects.
 */
export function toAgentScenario(s) {
  const totalTokens = s.promptTokens + s.outputTokens;
  return {
    id: s.id,
    label: s.label,
    promptTokens: s.promptTokens,
    outputTokens: s.outputTokens,
    totalTokens,
    // Fraction of all tokens that are prompt (prefill) tokens, 0..1, so an
    // agent can reason about prefill-vs-decode dominance without computing.
    prefillShare: Math.round((s.promptTokens / totalTokens) * 1000) / 1000
  };
}

// Thin wrapper over the shared sender so every response carries
// schema_version + X-Schema-Version (see _schema.js / CHANGELOG-API.md).
function json(res, body, status = 200) {
  return sendJson(res, body, { status, cacheTtl: 3600 });
}

export default function handler(req, res) {
  if (!enforceRateLimit(req, res)) return;

  const q = req.query || {};

  // Directory mode: no ?id= → list every valid scenario id.
  if (q.id == null || String(q.id).trim() === '') {
    const scenarios = SCENARIO_PRESETS.filter(isValidScenario).map(toAgentScenario);
    return json(res, {
      endpoint: ENDPOINT,
      description:
        'Built-in workload scenario presets (prompt/output token shapes). Load one with ?id=<id>, then feed promptTokens/outputTokens into /api/compute.',
      count: scenarios.length,
      scenarios,
      nextSteps: [
        { step: 'Pick a scenario id from this list.', example: `${ENDPOINT}?id=codegen` },
        { step: 'Run the inference math for it.', example: '/api/compute?model=singleTurn&promptTokens=2048&outputTokens=4096&prefillSpeed=5000&decodeSpeed=120' },
        { step: 'Full parameter reference.', example: '/api/spec' }
      ]
    });
  }

  // Validated load mode: exact known id required.
  const requestedId = String(q.id).trim();
  const scenario = findScenario(requestedId);
  if (!scenario || !isValidScenario(scenario)) {
    return json(res, {
      error: 'unknown_scenario',
      message: `No scenario preset with id '${requestedId}'. Use one of the ids in availableIds, or call ${ENDPOINT} without ?id= for the full directory.`,
      requestedId,
      availableIds: SCENARIO_PRESETS.map(s => s.id)
    }, 400);
  }

  return json(res, {
    endpoint: ENDPOINT,
    description: `Workload scenario '${scenario.label}' (${scenario.id}): ${scenario.promptTokens.toLocaleString('en-US')} prompt tokens in, ${scenario.outputTokens.toLocaleString('en-US')} output tokens out.`,
    requestedId,
    scenario: toAgentScenario(scenario),
    nextSteps: [
      { step: 'Run the inference math for this workload.', example: `/api/compute?model=singleTurn&promptTokens=${scenario.promptTokens}&outputTokens=${scenario.outputTokens}&prefillSpeed=5000&decodeSpeed=120` },
      { step: 'Check a specific rig fits it.', example: `/api/sizing?promptTokens=${scenario.promptTokens}&outputTokens=${scenario.outputTokens}` },
      { step: 'Full parameter reference.', example: '/api/spec' }
    ]
  });
}
