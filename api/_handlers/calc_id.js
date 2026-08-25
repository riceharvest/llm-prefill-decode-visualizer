// GET /api/calc/<id> — replay a computation from its deterministic id (issue #68).
//
// Ids are pure content hashes of the request (see _calc_id.js), so there is no
// store to hit: supply the original request parameters and this endpoint
// re-runs the exact same math, verifies the hash matches the requested id, and
// returns the result stamped `verified: true`. Agents can therefore cite a
// result as calc_xxxx forever and anyone can re-derive it.

import { isValidCalcId, computeCalcId } from '../_calc_id.js';
import { computeBody as computeResponse } from './compute.js';
import { bestBody as bestResponse } from './best.js';
import { enforceRateLimit } from '../_ratelimit.js';
import { sendJson } from '../_schema.js';

export const config = { runtime: 'nodejs' };

// Thin wrapper over the shared sender so every response carries schema_version
// + X-Schema-Version + the rate_limit block (see _schema.js). A replay is a
// fresh verification, not cacheable content: responses are explicitly private
// and never stored at the edge (#957) — a cached body would assert verified:true
// without the hash check re-running and would bypass rate limiting.
function json(res, body, status = 200) {
  if (!res.getHeader('Cache-Control')) {
    // Successful replays are content-addressed and cacheable, but PRIVATE:
    // a shared-cache hit would assert verified:true without the hash check
    // re-running (#957). Errors are never cached (#598).
    res.setHeader('Cache-Control', status === 200 ? 'private, max-age=3600' : 'no-store');
  }
  return sendJson(res, body, { status });
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    return res.status(204).end();
  }

  // Metered like /api/compute (#957): a replay re-runs the same math, so it
  // must not be an unmetered bypass — and the rate_limit block below is
  // stamped by this call.
  if (!enforceRateLimit(req, res)) return;

  const raw = req.method === 'POST' ? { ...(req.query || {}), ...(req.body || {}) } : (req.query || {});
  const id = raw.id;
  const endpoint = raw.endpoint || 'compute';

  if (!isValidCalcId(id)) {
    return json(res, {
      error: `Invalid calc id '${id ?? ''}'`,
      expectedFormat: 'calc_<12 hex chars>',
      usage: '/api/calc/<id>?<original request parameters> — e.g. /api/calc/calc_1a2b3c4d5e6f?model=singleTurn&promptTokens=4096'
    }, 400);
  }

  if (!['compute', 'best'].includes(endpoint)) {
    return json(res, { error: `Unknown endpoint '${endpoint}'`, available: ['compute', 'best'] }, 400);
  }

  // Strip routing/meta keys; whatever remains is the request being replayed.
  const params = { ...raw };
  delete params.id;
  delete params.endpoint;

  // A hash cannot be inverted: replaying requires the original parameters.
  // Batch payloads (#964) qualify: either the full `batch` array (replayed
  // through computeBody like any other request) or the caller-supplied
  // `batchId` the id was pinned to.
  const hasParams = endpoint === 'compute'
    ? Boolean(params.model || params.m || params.batch !== undefined || params.batchId !== undefined)
    : Object.keys(params).length > 0;
  if (!hasParams) {
    return json(res, {
      error: 'Missing request parameters',
      detail: `Calc ids are content hashes of the request — they are not a lookup key into a database. Re-send the original ${endpoint === 'best' ? 'filters' : 'parameters'} alongside the id and this endpoint will re-run the same math and verify the hash.`,
      example: endpoint === 'best'
        ? `/api/calc/${id}?endpoint=best&by=decode&maxParamsB=8`
        : `/api/calc/${id}?model=singleTurn&promptTokens=4096&outputTokens=512`
    }, 400);
  }

  // #964: batch recovery by id. A batch id minted under a caller-supplied
  // batchId is a pure hash of that batchId, so it can be VERIFIED from the
  // batchId alone — no need to still hold the original item payload. This
  // makes GET /api/calc/<batch-id>?batchId=<batchId> resolve instead of
  // dead-ending, giving partial-failure recovery an id-based path.
  if (
    endpoint === 'compute' &&
    params.batchId !== undefined &&
    params.batch === undefined && params.variants === undefined &&
    !params.model && !params.m
  ) {
    const batchId = String(params.batchId);
    const expected = computeCalcId('compute', { batchId });
    if (expected !== id) {
      return json(res, {
        error: 'Calc id does not match the given parameters',
        id,
        expected,
        hint: 'The batchId does not hash to this id. Use the expected id, or fix the batchId.'
      }, 400);
    }
    return json(res, {
      id,
      verified: true,
      batchId,
      note: 'Batch id verified against the caller-supplied batchId. To continue a partially failed run, resend POST /api/compute {"batchId": "...", "batch": [...]} — any subset of items, same batchId, same id.'
    }, 200);
  }

  let out;
  try {
    out = endpoint === 'best' ? await bestResponse(params) : computeResponse(params);
  } catch (err) {
    return json(res, { error: String(err.message || err) }, 500);
  }

  if (out.status !== 200 || !out.body || !out.body.id) {
    return json(res, out.body, out.status);
  }

  if (out.body.id !== id) {
    return json(res, {
      error: 'Calc id does not match the given parameters',
      id,
      expected: out.body.id,
      hint: 'The parameters were altered after the id was minted. Use the expected id, or fix the parameters.'
    }, 400);
  }

  return json(res, { ...out.body, verified: true });
}
