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
    getHeader(k) { return this.headers[String(k).toLowerCase()]; },
    hasHeader(k) { return String(k).toLowerCase() in this.headers; },
    status(c) { this.statusCode = c; return this; },
    end(b) { this.body = b ? JSON.parse(b) : null; }
  };
}

async function callCalc(pathId, query = {}) {
  const res = mockRes();
  await calcHandler({ method: 'GET', query: { ...query, id: pathId } }, res);
  return { status: res.statusCode, body: res.body };
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
  const { status, body } = await callCalc(minted.id, {
    model: 'kvCache',
    architecture: 'llama70b',
    contextLength: '65536'
  });
  assert.equal(status, 200);
  assert.equal(body.verified, true);
  assert.equal(body.id, minted.id);
  assert.equal(typeof body.totalGb, 'number');
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
