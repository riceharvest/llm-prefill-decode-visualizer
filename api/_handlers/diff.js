import { resolveRuns } from '../_snapshots.js';
import { computeRunDiff, evaluateDiffSlo, REF_PROMPT_TOKENS, REF_OUTPUT_TOKENS } from '../_diff.js';
import { bestBody } from './best.js';
import { computeWhatIfDiff } from '../_whatif.js';
import { applySchemaHeaders, sendJson } from '../_schema.js';
import { sendProblem } from '../_errors.js';
import { enforceRateLimit } from '../_ratelimit.js';

export const config = { runtime: 'nodejs' };

/**
 * Issue #834: thread the ?snapshot= pin into a what-if constraint set so both
 * legs resolve through the same frozen dataset. Exported pure for tests.
 */
export function applySnapshotPin(set, q = {}) {
  const id = q.snapshot ?? q.snapshotId;
  return id ? { ...set, snapshot: String(id) } : set;
}

function json(res, body, status = 200, cacheTtl = 300) {
  return sendJson(res, body, { status, cacheTtl });
}

// RFC 9457 problem+json error renderer (#570). Legacy flat members (error,
// hint, example, …) ride along as extra problem members so existing clients
// that branch on `error` keep working.
function problem(res, req, { status, code, detail, ...legacy }) {
  // Tolerate minimal mock res objects in tests (no getHeader) — the schema
  // headers are additive metadata, never worth failing a response over.
  try { applySchemaHeaders(res); } catch { /* best-effort */ }
  return sendProblem(res, req, { status, code, detail, ...legacy });
}

/**
 * Parse one what-if constraint set. Accepts an object (POST body), a
 * JSON-encoded object string, or a URL-encoded query string — e.g.
 *   a={"fitCheck":"true","contextLength":8192}
 *   a=fitCheck=true&contextLength=8192
 */
export function parseConstraintSet(value) {
  if (value == null) return null;
  if (typeof value === 'object') return value;
  const s = String(value).trim();
  if (!s) return null;
  if (s.startsWith('{') || s.startsWith('[')) {
    try {
      const parsed = JSON.parse(s);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
    } catch {
      const err = new Error('constraint set is not valid JSON');
      err.statusCode = 400;
      throw err;
    }
  }
  const obj = {};
  for (const [k, v] of new URLSearchParams(s)) obj[k] = v;
  return Object.keys(obj).length ? obj : null;
}

/** Constraint keys /api/best actually applies (see _handlers/best.js). */
const KNOWN_CONSTRAINT_KEYS = new Set([
  'by', 'sort_by', 'limit',
  'model', 'maxParamsB', 'quant', 'hwClass', 'hardware', 'engine',
  'minDecode', 'maxVramGb',
  'max_age', 'maxAge', 'context_band', 'contextBand',
  'contextLength', 'fitCheck', 'precisionBytes', 'batchSize',
  'scenario', 'promptTokens', 'outputTokens',
  'price', 'hardwarePriceUsd', 'electricityRate', 'electricityRatePerKwh',
  'amortizationMonths', 'powerWatts'
]);

/**
 * Keys of a constraint set that /api/best will silently ignore — echoed
 * into `constraints` but never applied to the matched run pool (#558).
 */
export function ignoredConstraintKeys(set) {
  return Object.keys(set || {}).filter(k => !KNOWN_CONSTRAINT_KEYS.has(k));
}

/**
 * The documented `?a=k=v&…&b=k=v` format cannot survive standard query
 * parsing: everything after the first `&` inside a's value is hoisted to a
 * top-level param, so both sets collapse to their first key (#556).
 * Recover the two segments from the RAW query string: tokens after `a=`
 * belong to A until `b=` (or another reserved key), tokens after `b=`
 * belong to B until the next reserved key.
 *
 * Returns { a, b } objects (possibly null) or null when no a=/b= present.
 */
export function parseWhatIfQuery(rawQuery) {
  if (rawQuery == null) return null;
  const tokens = String(rawQuery).replace(/^\?/, '').split('&').filter(Boolean);
  const segments = {}; // side -> { first, rest }
  let sawSide = false;
  let cur = null;
  // Decode %xx/+ per token up front so JSON-encoded segment values survive;
  // reserved keys are plain ASCII so this never changes segment detection.
  const dec = s => { try { return decodeURIComponent(String(s).replace(/\+/g, ' ')); } catch { return s; } };
  for (const tok of tokens) {
    const eq = tok.indexOf('=');
    const key = dec(eq === -1 ? tok : tok.slice(0, eq));
    const val = eq === -1 ? '' : dec(tok.slice(eq + 1));
    if (key === 'a' || key === 'b') {
      cur = key;
      sawSide = true;
      segments[cur] = { first: val, rest: [] };
      continue;
    }
    if (key === 'mode' || key === 'limit') { cur = null; continue; } // top-level params
    if (cur && segments[cur]) segments[cur].rest.push([key, val]);
  }
  if (!sawSide) return null;
  const toSet = side => {
    if (!side) return null;
    const s = [side.first, ...side.rest.map(([k, v]) => `${k}=${v}`)].filter(Boolean).join('&');
    if (!s) return null;
    // Delegate to parseConstraintSet so JSON-encoded segments ({…}) and
    // k=v query segments flow through the exact same parser.
    try {
      return parseConstraintSet(s);
    } catch {
      return null;
    }
  };
  return { a: toSet(segments.a), b: toSet(segments.b) };
}

/** Read a JSON request body (POST), tolerating mocked res objects in tests. */
async function readJsonBody(req) {
  if (!req || typeof req !== 'object' || req.method !== 'POST') return null;
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.on !== 'function') return null;
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return null;
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    const err = new Error('request body is not valid JSON');
    err.statusCode = 400;
    throw err;
  }
}

const WHATIF_DESCRIPTION =
  'What-if decision diffing: pass two /api/best-style constraint sets (a and b) and get back only the deltas — options entering/leaving the feasible set and per-option VRAM headroom changes. Constraint sets accept JSON objects (POST body or ?a={...}) or URL-encoded query strings (?a=fitCheck=true&contextLength=8192). Enable fitCheck/contextLength in the sets for headroom deltas; headroom values are estimates (see _vramfit). Comparison covers the top-N ranked options PER SET (each set may carry its own limit; default 50, the /api/best cap). When a side returns its full cap the response flags truncated:true and adds a whatif_truncated warning — options ranked below the cap are reported as entering/leaving even though constraint feasibility did not change (#847).';

// GET/POST /api/diff
//   Default mode: ?runA=<id>&runB=<id> — diff two measured runs.
//   What-if mode: ?mode=whatif&a=<constraints>&b=<constraints> — diff two
//   decision requests (#71), returning only the deltas.
/**
 * Map a thrown error onto an HTTP status: client-input errors carry a 4xx
 * statusCode (e.g. malformed JSON body → 400 from readJsonBody) and are
 * honored as-is; anything else is a genuine unexpected throw → 502 (#747).
 */
export function statusFromError(err) {
  const code = Number(err?.statusCode);
  return Number.isInteger(code) && code >= 400 && code < 500 ? code : 502;
}

export default async function handler(req, res) {
  if (!enforceRateLimit(req, res)) return;
  try {
    const body = await readJsonBody(req);
    if (body === undefined) {
      return problem(res, req, { status: 400, code: 'INVALID_PARAMS', detail: 'request body is not valid JSON', error: 'request body is not valid JSON' });
    }
    const q = { ...(req.query || {}), ...(body && typeof body === 'object' ? body : {}) };

    if (String(q.mode || '').toLowerCase() === 'whatif') {
      return await whatIfHandler(q, res, req, parseWhatIfQuery(req.url));
    }

    const idA = q.runA ?? q.a;
    const idB = q.runB ?? q.b;

    if (!idA || !idB) {
      return problem(res, req, {
        status: 400,
        code: 'INVALID_PARAMS',
        detail: 'Provide two run ids: /api/diff?runA=<id>&runB=<id> (aliases a/b accepted), or two constraint sets for what-if mode: /api/diff?mode=whatif&a=<constraints>&b=<constraints>.',
        error: 'missing parameters',
        example: '/api/diff?runA=cmsxu9zyi0ck7ms01v41wipnd&runB=cmrpa80mz05aolg011rjzkfvk'
      });
    }
    if (String(idA) === String(idB)) {
      return problem(res, req, { status: 400, code: 'INVALID_PARAMS', detail: 'runA and runB must be different run ids', error: 'runA and runB must be different run ids' });
    }

    // Issue #834: resolve through the pinned-snapshot pipeline instead of raw
    // getAllRuns() — ?snapshot=<id> now actually pins the rows (unknown ids
    // serve live data with an honest served:false) and the response carries
    // the snapshot metadata so a diff verdict is citable + reproducible.
    // Issue #395 (kept from the integration tree): ids are generated
    // lowercase, but agents commonly normalize casing — fall back to a
    // case-insensitive match, and report EVERY unknown id in one response.
    const { runs, snapshot } = await resolveRuns(q);
    const findRun = id => {
      const wanted = String(id);
      return runs.find(r => String(r.runId) === wanted)
        || runs.find(r => String(r.runId).toLowerCase() === wanted.toLowerCase());
    };
    const missing = [];
    const runA = findRun(idA);
    if (!runA) missing.push(String(idA));
    const runB = findRun(idB);
    if (!runB) missing.push(String(idB));
    if (missing.length) {
      const detail = missing.length === 1
        ? `run ${missing[0]} not found`
        : `runs ${missing.join(' and ')} not found`;
      return problem(res, req, {
        status: 404,
        code: 'NOT_FOUND',
        detail,
        error: detail,
        hint: 'browse ids via /api/localmaxxing'
      });
    }

    // Optional SLO budgets (#560): present-but-invalid values fail loudly
    // instead of silently disabling the check (same policy as sizing's SLO caps).
    const SLO_PARAM_NAMES = ['sloTtftMs', 'sloTpotMs', 'sloWalltimeSec'];
    for (const name of SLO_PARAM_NAMES) {
      const raw = q[name];
      if (raw === undefined || raw === null || String(raw).trim() === '') continue;
      const n = Number(raw);
      if (!Number.isFinite(n) || n <= 0) {
        return problem(res, req, {
          status: 400,
          code: 'INVALID_PARAMS',
          detail: `${name} must be a positive number (e.g. ${name}=400), or omit it to disable that check.`,
          error: `invalid SLO budget ${name}=${raw}`
        });
      }
    }
    const hasBudgets = SLO_PARAM_NAMES.some(name => {
      const v = q[name];
      return v !== undefined && v !== null && String(v).trim() !== '';
    });

    return json(res, {
      description: `Diffs two measured runs. Time metrics are normalized to a reference workload (${REF_PROMPT_TOKENS}-token prompt, ${REF_OUTPUT_TOKENS}-token output); delta is B − A, ratio is B ÷ A, winner is from A's point of view.`,
      snapshot,
      runA,
      runB,
      diff: computeRunDiff(runA, runB),
      ...(hasBudgets ? { slo: evaluateDiffSlo(runA, runB, { ttftMs: q.sloTtftMs, tpotMs: q.sloTpotMs, walltimeSec: q.sloWalltimeSec }) } : {})
    });
  } catch (err) {
    // Honor client-input error statuses so agents don't retry non-retryable
    // input as if it were an upstream failure (#747), rendered per the
    // RFC 9457 problem contract (#570).
    const status = statusFromError(err);
    const detail = String(err.message || err);
    return problem(res, req, {
      status,
      code: status < 500 ? 'INVALID_PARAMS' : 'UPSTREAM_UNAVAILABLE',
      detail,
      error: detail
    });
  }
}

/**
 * What-if mode (#71): resolve both constraint sets through the same
 * decision engine /api/best uses, then report only the deltas.
 */
async function whatIfHandler(q, res, req, rawSets = null) {
  let constraintsA;
  let constraintsB;
  try {
    constraintsA = parseConstraintSet(q.a);
    constraintsB = parseConstraintSet(q.b);
  } catch (err) {
    return problem(res, req, {
      status: 400,
      code: 'INVALID_PARAMS',
      detail: `invalid constraint set — ${String(err.message || err)}`,
      error: 'invalid constraint set'
    });
  }
  // The documented `?a=k=v&k=v&b=k=v` form loses every key after the first
  // to top-level query parsing (#556); prefer the raw-query segmentation
  // when it recovered a fuller set.
  if (rawSets) {
    if (rawSets.a && (!constraintsA || Object.keys(rawSets.a).length > Object.keys(constraintsA).length)) {
      constraintsA = rawSets.a;
    }
    if (rawSets.b && (!constraintsB || Object.keys(rawSets.b).length > Object.keys(constraintsB).length)) {
      constraintsB = rawSets.b;
    }
  }
  if (!constraintsA || !constraintsB) {
    return problem(res, req, {
      status: 400,
      code: 'INVALID_PARAMS',
      detail: 'What-if mode needs two constraint sets: /api/diff?mode=whatif&a=<constraints>&b=<constraints>.',
      error: 'missing parameters',
      example: '/api/diff?mode=whatif&a=fitCheck=true&contextLength=8192&model=qwen&b=fitCheck=true&contextLength=65536&model=qwen'
    });
  }

  // Compare like with like: same ranking basis and, unless the caller set
  // one, a wide shared limit so the feasible set isn't truncated at 10.
  const sharedLimit = Math.min(50, Math.max(1, Number(q.limit) || 50));
  const normalize = set => ({
    by: 'decode',
    ...set,
    limit: Number.isFinite(Number(set.limit)) ? Number(set.limit) : sharedLimit
  });
  const setA = applySnapshotPin(normalize(constraintsA), q);
  const setB = applySnapshotPin(normalize(constraintsB), q);

  let bodyA;
  let bodyB;
  try {
    [bodyA, bodyB] = await Promise.all([bestBody(setA), bestBody(setB)]);
  } catch (err) {
    const detail = String(err.message || err);
    return problem(res, req, { status: 502, code: 'UPSTREAM_UNAVAILABLE', detail, error: 'failed to resolve constraint sets' });
  }
  if (bodyA.status !== 200) {
    return problem(res, req, {
      status: bodyA.status,
      code: bodyA.status === 404 ? 'NOT_FOUND' : 'INVALID_PARAMS',
      detail: `constraint set a failed with HTTP ${bodyA.status} (see the upstream problem in the "a" member's constraints)`,
      error: 'constraint set a failed',
      upstream: bodyA.body
    });
  }
  if (bodyB.status !== 200) {
    return problem(res, req, {
      status: bodyB.status,
      code: bodyB.status === 404 ? 'NOT_FOUND' : 'INVALID_PARAMS',
      detail: `constraint set b failed with HTTP ${bodyB.status} (see the upstream problem in the "b" member's constraints)`,
      error: 'constraint set b failed',
      upstream: bodyB.body
    });
  }

  // Surface constraint keys /api/best silently ignored instead of letting a
  // full-dataset diff masquerade as a filtered one (#558).
  const ignoredA = ignoredConstraintKeys(constraintsA);
  const ignoredB = ignoredConstraintKeys(constraintsB);
  const warnings = [
    ...(ignoredA.length ? [`constraint set a: unsupported key(s) ignored — not applied to the matched runs: ${ignoredA.join(', ')}`] : []),
    ...(ignoredB.length ? [`constraint set b: unsupported key(s) ignored — not applied to the matched runs: ${ignoredB.join(', ')}`] : [])
  ];

  // #847: limit is honored PER SIDE by bestBody() — surface the effective
  // per-side cutoffs and flag when a delta may contain rank-cutoff
  // artifacts rather than real feasibility changes.
  const effectiveLimit = set => Math.min(50, Math.max(1, Number(set.limit) || 10));
  const limitA = effectiveLimit(setA);
  const limitB = effectiveLimit(setB);
  const truncatedA = bodyA.body.results.length >= limitA;
  const truncatedB = bodyB.body.results.length >= limitB;
  if (limitA !== limitB) {
    warnings.push({
      code: 'whatif_limit_mismatch',
      message: `Per-side limits differ (a=${limitA}, b=${limitB}); entered/left verdicts are only comparable up to the smaller cutoff.`
    });
  }
  if (truncatedA || truncatedB) {
    warnings.push({
      code: 'whatif_truncated',
      message: 'One or both constraint sets returned their full top-N cap of ranked options; options ranked below the cap appear as entering/leaving even though constraint feasibility did not change. Raise ?limit= (max 50 per side) to widen the comparison.'
    });
  }

  return json(res, {
    description: WHATIF_DESCRIPTION,
    mode: 'whatif',
    limits: { a: limitA, b: limitB },
    truncated: { a: truncatedA, b: truncatedB },
    ...(warnings.length ? { warnings } : {}),
    a: { constraints: setA, ...(ignoredA.length ? { ignoredKeys: ignoredA } : {}), matchedRuns: bodyA.body.matchedRuns, id: bodyA.body.id, snapshot: bodyA.body.snapshot, resultCount: bodyA.body.results.length, limit: limitA, truncated: truncatedA },
    b: { constraints: setB, ...(ignoredB.length ? { ignoredKeys: ignoredB } : {}), matchedRuns: bodyB.body.matchedRuns, id: bodyB.body.id, snapshot: bodyB.body.snapshot, resultCount: bodyB.body.results.length, limit: limitB, truncated: truncatedB },
    delta: computeWhatIfDiff(bodyA.body.results, bodyB.body.results)
  }, 200, 120);
}
