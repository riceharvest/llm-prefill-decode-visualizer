// #598 — the calc_id handler's local json() stamped `Cache-Control: public,
// max-age=3600` on ALL responses, including 400/500 error bodies. Errors must
// be no-store like every other endpoint (via _errors.js); only successful
// replays keep the deterministic content-addressed cache TTL.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeCalcId } from './_calc_id.js';
import { computeBody } from './_handlers/compute.js';
import calcHandler from './_handlers/calc_id.js';

function mockRes() {
  return {
    statusCode: 0,
    headers: {},
    body: null,
    setHeader(k, v) { this.headers[k] = v; },
    getHeader(k) { return this.headers[k]; },
    status(c) { this.statusCode = c; return this; },
    end(b) { this.body = b ? JSON.parse(b) : null; }
  };
}

async function callCalc(query = {}) {
  const res = mockRes();
  await calcHandler({ method: 'GET', query }, res);
  return { status: res.statusCode, headers: res.headers, body: res.body };
}

test('#598: a 400 invalid-id response is no-store', async () => {
  const { status, headers } = await callCalc({ id: 'not-a-calc-id' });
  assert.equal(status, 400);
  assert.equal(headers['Cache-Control'], 'no-store');
});

test('#598: a 400 unknown-endpoint response is no-store', async () => {
  const id = computeCalcId('compute', { model: 'singleTurn' });
  const { status, headers } = await callCalc({ id, endpoint: 'nope' });
  assert.equal(status, 400);
  assert.equal(headers['Cache-Control'], 'no-store');
});

test('#598/#957: a successful replay stays privately cacheable', async () => {
  // #957 (merged later) downgraded success replays from public to private:
  // a shared-cache hit would assert verified:true without re-running the
  // hash check. Private caching still honors #598's intent.
  const params = { model: 'singleTurn', promptTokens: 4096 };
  const minted = computeBody(params); // resolve the full-input hash
  const { status, headers, body } = await callCalc({ id: minted.body.id, ...params });
  assert.equal(status, 200);
  assert.equal(body.verified, true);
  assert.match(headers['Cache-Control'], /private/);
});
