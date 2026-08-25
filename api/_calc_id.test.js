import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeParams, computeCalcId, isValidCalcId } from './_calc_id.js';
import { computeBody as computeResponse } from '../api/_handlers/compute.js';
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

async function callCalc(pathId, query = {}) {
  const res = mockRes();
  await calcHandler({ method: 'GET', headers: {}, query: { ...query, id: pathId } }, res);
  return { status: res.statusCode, body: res.body, headers: res.headers };
}

test('ids are stable regardless of parameter order or number encoding', () => {
  const a = computeCalcId('compute', { model: 'singleTurn', promptTokens: '4096', outputTokens: 512 });
  const b = computeCalcId('compute', { outputTokens: '512', promptTokens: 4096, model: 'singleTurn' });
  assert.equal(a, b);
});

test('id format is calc_ + 12 lowercase hex chars', () => {
  const id = computeCalcId('compute', { model: 'kvCache' });
  assert.match(id, /^calc_[0-9a-f]{12}$/);
});

test('different inputs mint different ids', () => {
  const a = computeCalcId('compute', { model: 'singleTurn', promptTokens: 4096 });
  const b = computeCalcId('compute', { model: 'singleTurn', promptTokens: 8192 });
  assert.notEqual(a, b);
  const c = computeCalcId('best', { by: 'decode' });
  const d = computeCalcId('best', { by: 'prefill' });
  assert.notEqual(c, d);
});

test('empty and absent values are ignored so defaults hash equal', () => {
  assert.equal(
    computeCalcId('compute', { model: 'batched', batchSize: '' }),
    computeCalcId('compute', { model: 'batched' })
  );
});

test('normalizeParams canonicalizes numeric strings and sorts keys', () => {
  assert.deepEqual(normalizeParams({ b: '0.7', a: '42' }), { a: 42, b: 0.7 });
  assert.deepEqual(normalizeParams({ flag: false, x: undefined, y: null, z: '' }), { flag: false });
});

test('isValidCalcId rejects malformed ids', () => {
  assert.equal(isValidCalcId('calc_1a2b3c4d5e6f'), true);
  assert.equal(isValidCalcId('calc_UPPERCASEHEX00'), false);
  assert.equal(isValidCalcId('calc_short'), false);
  assert.equal(isValidCalcId('garbage'), false);
  assert.equal(isValidCalcId(undefined), false);
});

test('/api/compute responses carry a deterministic id derived from resolved inputs', () => {
  // Defaults resolve before hashing: omitting an explicit default changes nothing…
  const implicit = computeResponse({ model: 'singleTurn', promptTokens: '4096' });
  const explicit = computeResponse({ model: 'singleTurn', promptTokens: 4096, outputTokens: 512, prefillSpeed: 3800, decodeSpeed: 105 });
  assert.equal(implicit.status, 200);
  assert.match(implicit.body.id, /^calc_[0-9a-f]{12}$/);
  assert.equal(implicit.body.id, explicit.body.id);
  // …but changing an input does.
  const changed = computeResponse({ model: 'singleTurn', promptTokens: 8192 });
  assert.notEqual(changed.body.id, implicit.body.id);
});

test('compute ids match the pure hash of the effective request', () => {
  const r = computeResponse({ model: 'agentic', numTurns: 6 });
  assert.equal(
    r.body.id,
    computeCalcId('compute', {
      model: 'agentic',
      numTurns: 6,
      basePromptTokens: 1500,
      toolOutputTokensPerTurn: 800,
      decodeTokensPerTurn: 250,
      prefillSpeed: 3800,
      decodeSpeed: 105,
      enablePrefixCaching: true
    })
  );
});

test('/api/calc/<id> verifies a correct replay', async () => {
  const minted = computeResponse({ model: 'kvCache', architecture: 'llama70b', contextLength: 65536 }).body;
  const { status, body, headers } = await callCalc(minted.id, {
    model: 'kvCache',
    architecture: 'llama70b',
    contextLength: '65536'
  });
  assert.equal(status, 200);
  assert.equal(body.verified, true);
  assert.equal(body.id, minted.id);
  assert.equal(typeof body.totalGb, 'number');
});

// #957: the success replay must be the same versioned envelope as the cited
// response — schema_version + X-Schema-Version + rate_limit — and must NOT be
// publicly cacheable (a cached body would assert verified:true without the
// hash check re-running).
test('/api/calc success replay keeps the shared envelope and is not publicly cacheable (#957)', async () => {
  const minted = computeResponse({ model: 'singleTurn', promptTokens: 4096, outputTokens: 512 }).body;
  const { status, body, headers } = await callCalc(minted.id, { model: 'singleTurn', promptTokens: '4096', outputTokens: 512 });
  assert.equal(status, 200);
  assert.equal(body.schema_version, '1');
  assert.equal(headers['X-Schema-Version'], '1');
  assert.ok(body.rate_limit, 'success replay carries the rate_limit block');
  assert.equal(typeof body.rate_limit.limit, 'number');
  assert.equal(headers['X-RateLimit-Limit'], String(body.rate_limit.limit));
  assert.match(headers['Cache-Control'] || '', /private|no-store/);
  assert.doesNotMatch(headers['Cache-Control'] || '', /public/);
});

test('/api/calc/<id> detects tampered parameters', async () => {
  const minted = computeResponse({ model: 'speculative', draftTokens: 4 }).body;
  const { status, body } = await callCalc(minted.id, { model: 'speculative', draftTokens: '8' });
  assert.equal(status, 400);
  assert.equal(body.error, 'Calc id does not match the given parameters');
  // `expected` is the hash of the tampered params — a valid but different id.
  assert.match(body.expected, /^calc_[0-9a-f]{12}$/);
  assert.notEqual(body.expected, minted.id);
});

test('/api/calc/<id> without parameters explains the hash scheme', async () => {
  const minted = computeResponse({ model: 'singleTurn' }).body;
  const { status, body } = await callCalc(minted.id, {});
  assert.equal(status, 400);
  assert.equal(body.error, 'Missing request parameters');
});

test('/api/calc rejects malformed ids and unknown endpoints', async () => {
  const bad = await callCalc('nope', { model: 'singleTurn' });
  assert.equal(bad.status, 400);
  assert.match(bad.body.error, /Invalid calc id/);

  const badEp = await callCalc(computeCalcId('compute', { model: 'x' }), { endpoint: 'nope', model: 'x' });
  assert.equal(badEp.status, 400);
  assert.match(badEp.body.error, /Unknown endpoint/);
});

// #1056: any Number()-acceptable numeric spelling must collapse onto its
// decimal value — the handlers execute it identically, so the calc id (and
// /api/calc/<id> replay + dedup-by-id) must not distinguish spellings.
test('#1056 Number()-spellings of the same value hash to one calc id', () => {
  assert.deepEqual(
    normalizeParams({ promptTokens: '+2048' }),
    { promptTokens: 2048 }
  );
  assert.deepEqual(
    normalizeParams({ promptTokens: '0x800' }),
    { promptTokens: 2048 }
  );
  const decimal = computeCalcId('compute', { model: 'singleTurn', promptTokens: 2048 });
  assert.equal(computeCalcId('compute', { model: 'singleTurn', promptTokens: '0x800' }), decimal);
  assert.equal(computeCalcId('compute', { model: 'singleTurn', promptTokens: '+2048' }), decimal);
});

test('#1056 non-numeric and empty strings are not Number()-collapsed', () => {
  // Empty / whitespace-only strings mean "default" and must stay strings
  // (Number('') === 0 would wrongly mint the zero).
  assert.deepEqual(normalizeParams({ model: '' }), {});
  assert.deepEqual(normalizeParams({ q: '   ' }), { q: '   ' });
  assert.deepEqual(normalizeParams({ model: 'qwen3.6-27b' }), { model: 'qwen3.6-27b' });
  assert.deepEqual(normalizeParams({ engine: 'TRUE' }), { engine: 'TRUE' });
  // Non-finite coercions stay verbatim.
  assert.deepEqual(normalizeParams({ v: 'Infinity' }), { v: 'Infinity' });
  assert.deepEqual(normalizeParams({ v: '12abc' }), { v: '12abc' });
});

test('#1056 batch items with different numeric spellings mint the same per-item id', () => {
  const plain = computeResponse({ batch: [{ model: 'singleTurn', promptTokens: 2048 }] }).body.results[0];
  const hex = computeResponse({ batch: [{ model: 'singleTurn', promptTokens: '0x800' }] }).body.results[0];
  assert.equal(hex.ok, true);
  assert.equal(hex.result.id, plain.result.id);
});
