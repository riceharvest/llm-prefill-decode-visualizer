import { getAllRuns } from './_localmaxxing.js';
import { computeRunDiff, REF_PROMPT_TOKENS, REF_OUTPUT_TOKENS } from './_diff.js';

export const config = { runtime: 'nodejs' };

function json(res, body, status = 200, cacheTtl = 300) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', `public, max-age=${cacheTtl}`);
  res.end(JSON.stringify(body, null, 2));
}

// GET /api/diff?runA=<id>&runB=<id>
// Returns both runs plus per-metric deltas, ratios and a plain-language
// summary — one call instead of two /api/localmaxxing lookups + math.
export default async function handler(req, res) {
  try {
    const q = req.query || {};
    const idA = q.runA ?? q.a;
    const idB = q.runB ?? q.b;

    if (!idA || !idB) {
      return json(res, {
        error: 'missing parameters',
        detail: 'Provide two run ids: /api/diff?runA=<id>&runB=<id> (aliases a/b accepted).',
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
