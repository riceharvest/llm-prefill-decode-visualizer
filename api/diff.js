import { getAllRuns } from './_localmaxxing.js';
import { computeRunDiff, REF_PROMPT_TOKENS, REF_OUTPUT_TOKENS } from './_diff.js';
import { bestBody } from './best.js';
import { computeWhatIfDiff } from './_whatif.js';

export const config = { runtime: 'nodejs' };

function json(res, body, status = 200, cacheTtl = 300) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', `public, max-age=${cacheTtl}`);
  res.end(JSON.stringify(body, null, 2));
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
export default async function handler(req, res) {
  try {
    const body = await readJsonBody(req);
    if (body === undefined) return json(res, { error: 'request body is not valid JSON' }, 400);
    const q = { ...(req.query || {}), ...(body && typeof body === 'object' ? body : {}) };

    if (String(q.mode || '').toLowerCase() === 'whatif') {
      return await whatIfHandler(q, res);
    }

    const idA = q.runA ?? q.a;
    const idB = q.runB ?? q.b;

    if (!idA || !idB) {
      return json(res, {
        error: 'missing parameters',
        detail: 'Provide two run ids: /api/diff?runA=<id>&runB=<id> (aliases a/b accepted), or two constraint sets for what-if mode: /api/diff?mode=whatif&a=<constraints>&b=<constraints>.',
        example: '/api/diff?runA=1234&runB=5678'
      }, 400);
    }
    if (String(idA) === String(idB)) {
      return json(res, { error: 'runA and runB must be different run ids' }, 400);
    }

    const runs = await getAllRuns();
    const findRun = id => runs.find(r => String(r.runId) === String(id));
    const runA = findRun(idA);
    if (!runA) return json(res, { error: `run ${idA} not found`, hint: 'browse ids via /api/localmaxxing' }, 404);
    const runB = findRun(idB);
    if (!runB) return json(res, { error: `run ${idB} not found`, hint: 'browse ids via /api/localmaxxing' }, 404);

    return json(res, {
      description: `Diffs two measured runs. Time metrics are normalized to a reference workload (${REF_PROMPT_TOKENS}-token prompt, ${REF_OUTPUT_TOKENS}-token output); delta is B − A, ratio is B ÷ A, winner is from A's point of view.`,
      runA,
      runB,
      diff: computeRunDiff(runA, runB)
    });
  } catch (err) {
    return json(res, { error: String(err.message || err) }, 502);
  }
}

/**
 * What-if mode (#71): resolve both constraint sets through the same
 * decision engine /api/best uses, then report only the deltas.
 */
async function whatIfHandler(q, res) {
  let constraintsA;
  let constraintsB;
  try {
    constraintsA = parseConstraintSet(q.a);
    constraintsB = parseConstraintSet(q.b);
  } catch (err) {
    return json(res, { error: 'invalid constraint set', detail: String(err.message || err) }, 400);
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

  return json(res, {
    description: WHATIF_DESCRIPTION,
    mode: 'whatif',
    a: { constraints: setA, matchedRuns: bodyA.body.matchedRuns, id: bodyA.body.id, resultCount: bodyA.body.results.length },
    b: { constraints: setB, matchedRuns: bodyB.body.matchedRuns, id: bodyB.body.id, resultCount: bodyB.body.results.length },
    delta: computeWhatIfDiff(bodyA.body.results, bodyB.body.results)
  }, 200, 120);
}
