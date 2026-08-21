import { parseConstraints, constraintsToSizingQuery } from './_parse_constraints.js';
import { enforceRateLimit } from './_ratelimit.js';
import { sendJson } from './_schema.js';
import { sendProblem } from './_errors.js';

export const config = { runtime: 'nodejs' };

/**
 * GET /api/parse-constraints?q=<plain-language constraints>   (#65)
 * POST /api/parse-constraints  {"q": "<...>"}                 (also accepts `text`)
 *
 * Converts a natural-language constraint string —
 *   "self-hosted Qwen 27B at Q4 for 10 users under $1500"
 * — into the canonical constraint JSON used by /api/sizing and /api/best.
 * Pure regex/heuristics: deterministic, no external LLM calls. The response
 * echoes the input, returns the parsed struct (null = not stated) and an
 * `ambiguities` array for every assumption the parser had to make, so agents
 * can ask the user instead of silently guessing. `sizingQuery` carries a
 * ready-made query string for the downstream /api/sizing decision endpoint.
 */
export default function handler(req, res) {
  if (!enforceRateLimit(req, res)) return;

  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    return res.status(204).end();
  }

  const params = req.method === 'POST' ? (req.body || {}) : (req.query || {});
  const raw = params.q ?? params.text ?? params.constraints ?? '';

  if (!String(raw).trim()) {
    return sendProblem(res, req, {
      code: 'INVALID_PARAMS',
      detail: 'Missing ?q=<plain-language constraints>. Example: ?q=self-hosted%20Qwen%2027B%20at%20Q4%20for%2010%20users%20under%20%241500'
    });
  }

  const { input, constraints, ambiguities } = parseConstraints(raw);
  const sizingParams = constraintsToSizingQuery(constraints);

  return sendJson(res, {
    description: 'Natural-language constraint parsing: canonical constraint struct + explicit ambiguities. Feed sizingQuery to /api/sizing for ranked hardware; resolve each ambiguity before trusting the numbers.',
    input,
    recognizedCount: Object.values(constraints).filter(v => v != null).length,
    constraints,
    ambiguities,
    ...(sizingParams.toString() ? { sizingQuery: `/api/sizing?${sizingParams.toString()}` } : { sizingQuery: null })
  }, { cacheTtl: 3600 });
}
