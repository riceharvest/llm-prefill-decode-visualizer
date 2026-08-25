import { getAllRuns } from '../_localmaxxing.js';
import { computeRunDiff, evaluateDiffSlo, REF_PROMPT_TOKENS, REF_OUTPUT_TOKENS } from '../_diff.js';
import { bestBody } from './best.js';
import { computeWhatIfDiff } from '../_whatif.js';
import { sendJson } from '../_schema.js';

export const config = { runtime: 'nodejs' };

// Single shared sender (#963): stamps schema_version + X-Schema-Version.
function json(res, body, status = 200, cacheTtl = 300) {
  return sendJson(res, body, { status, cacheTtl });
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
  'What-if decision diffing: pass two /api/best-style constraint sets (a and b) and get back only the deltas — options entering/leaving the feasible set and per-option VRAM headroom changes. Constraint sets accept JSON objects (POST body or ?a={...}) or URL-encoded query strings (?a=fitCheck=true&contextLength=8192). Enable fitCheck/contextLength in the sets for headroom deltas; headroom values are estimates (see _vramfit). Comparison covers the top-N ranked options per set (default limit 50, the /api/best cap).';

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
  try {
    const body = await readJsonBody(req);
    if (body === undefined) return json(res, { error: 'request body is not valid JSON' }, 400);
    const q = { ...(req.query || {}), ...(body && typeof body === 'object' ? body : {}) };

    if (String(q.mode || '').toLowerCase() === 'whatif') {
      return await whatIfHandler(q, res, parseWhatIfQuery(req.url));
    }

    const idA = q.runA ?? q.a;
    const idB = q.runB ?? q.b;

    if (!idA || !idB) {
      return json(res, {
        error: 'missing parameters',
        detail: 'Provide two run ids: /api/diff?runA=<id>&runB=<id> (aliases a/b accepted), or two constraint sets for what-if mode: /api/diff?mode=whatif&a=<constraints>&b=<constraints>.',
        example: '/api/diff?runA=cmsxu9zyi0ck7ms01v41wipnd&runB=cmrpa80mz05aolg011rjzkfvk'
      }, 400);
    }
    if (String(idA) === String(idB)) {
      return json(res, { error: 'runA and runB must be different run ids' }, 400);
    }

    const runs = await getAllRuns();
    // Issue #395: ids are generated lowercase, but agents commonly normalize
    // casing — fall back to a case-insensitive match instead of failing.
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
    // Issue #395: report EVERY unknown id in one response so an agent fixing
    // two bad ids needs one round-trip, not one per mistake.
    if (missing.length === 1) {
      return json(res, { error: `run ${missing[0]} not found`, hint: 'browse ids via /api/localmaxxing' }, 404);
    }
    if (missing.length > 1) {
      return json(res, { error: `runs ${missing.join(' and ')} not found`, hint: 'browse ids via /api/localmaxxing' }, 404);
    }

    // Optional SLO budgets (#560): present-but-invalid values fail loudly
    // instead of silently disabling the check (same policy as sizing's SLO caps).
    const SLO_PARAM_NAMES = ['sloTtftMs', 'sloTpotMs', 'sloWalltimeSec'];
    for (const name of SLO_PARAM_NAMES) {
      const raw = q[name];
      if (raw === undefined || raw === null || String(raw).trim() === '') continue;
      const n = Number(raw);
      if (!Number.isFinite(n) || n <= 0) {
        return json(res, { error: `invalid SLO budget ${name}=${raw}`, detail: `${name} must be a positive number (e.g. ${name}=400), or omit it to disable that check.` }, 400);
      }
    }
    const hasBudgets = SLO_PARAM_NAMES.some(name => {
      const v = q[name];
      return v !== undefined && v !== null && String(v).trim() !== '';
    });

    return json(res, {
      description: `Diffs two measured runs. Time metrics are normalized to a reference workload (${REF_PROMPT_TOKENS}-token prompt, ${REF_OUTPUT_TOKENS}-token output); delta is B − A, ratio is B ÷ A, winner is from A's point of view.`,
      runA,
      runB,
      diff: computeRunDiff(runA, runB),
      ...(hasBudgets ? { slo: evaluateDiffSlo(runA, runB, { ttftMs: q.sloTtftMs, tpotMs: q.sloTpotMs, walltimeSec: q.sloWalltimeSec }) } : {})
    });
  } catch (err) {
    // Honor client-input error statuses so agents don't retry non-retryable
    // input as if it were an upstream failure (#747).
    return json(res, { error: String(err.message || err) }, statusFromError(err));
  }
}

/**
 * What-if mode (#71): resolve both constraint sets through the same
 * decision engine /api/best uses, then report only the deltas.
 */
async function whatIfHandler(q, res, rawSets = null) {
  let constraintsA;
  let constraintsB;
  try {
    constraintsA = parseConstraintSet(q.a);
    constraintsB = parseConstraintSet(q.b);
  } catch (err) {
    return json(res, { error: 'invalid constraint set', detail: String(err.message || err) }, 400);
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
    return json(res, {
      error: 'missing parameters',
      detail: 'What-if mode needs two constraint sets: /api/diff?mode=whatif&a=<constraints>&b=<constraints>.',
      example: '/api/diff?mode=whatif&a=fitCheck=true&contextLength=8192&model=qwen&b=fitCheck=true&contextLength=65536&model=qwen'
    }, 400);
  }

  // Compare like with like: same ranking basis and, unless the caller set
  // one, a wide shared limit so the feasible set isn't truncated at 10.
  const sharedLimit = Math.min(50, Math.max(1, Number(q.limit) || 50));
  const normalize = set => ({
    by: 'decode',
    ...set,
    limit: Number.isFinite(Number(set.limit)) ? Number(set.limit) : sharedLimit
  });
  const setA = normalize(constraintsA);
  const setB = normalize(constraintsB);

  let bodyA;
  let bodyB;
  try {
    [bodyA, bodyB] = await Promise.all([bestBody(setA), bestBody(setB)]);
  } catch (err) {
    return json(res, { error: 'failed to resolve constraint sets', detail: String(err.message || err) }, 502);
  }
  if (bodyA.status !== 200) return json(res, { error: 'constraint set a failed', detail: bodyA.body }, bodyA.status);
  if (bodyB.status !== 200) return json(res, { error: 'constraint set b failed', detail: bodyB.body }, bodyB.status);

  // Surface constraint keys /api/best silently ignored instead of letting a
  // full-dataset diff masquerade as a filtered one (#558).
  const ignoredA = ignoredConstraintKeys(constraintsA);
  const ignoredB = ignoredConstraintKeys(constraintsB);
  const warnings = [
    ...(ignoredA.length ? [`constraint set a: unsupported key(s) ignored — not applied to the matched runs: ${ignoredA.join(', ')}`] : []),
    ...(ignoredB.length ? [`constraint set b: unsupported key(s) ignored — not applied to the matched runs: ${ignoredB.join(', ')}`] : [])
  ];

  return json(res, {
    description: WHATIF_DESCRIPTION,
    mode: 'whatif',
    ...(warnings.length ? { warnings } : {}),
    a: { constraints: setA, ...(ignoredA.length ? { ignoredKeys: ignoredA } : {}), matchedRuns: bodyA.body.matchedRuns, id: bodyA.body.id, resultCount: bodyA.body.results.length },
    b: { constraints: setB, ...(ignoredB.length ? { ignoredKeys: ignoredB } : {}), matchedRuns: bodyB.body.matchedRuns, id: bodyB.body.id, resultCount: bodyB.body.results.length },
    delta: computeWhatIfDiff(bodyA.body.results, bodyB.body.results)
  }, 200, 120);
}
