import { test } from 'node:test';
import assert from 'node:assert/strict';
import handler, { MAX_BATCH_SIZE } from './compute.js';

// Minimal Vercel-style req/res mocks so we can unit-test the handler
// without a server.
function mockRes() {
  const res = {
    statusCode: 200,
    headers: {},
    body: undefined,
    setHeader(k, v) { this.headers[k] = v; },
    status(code) { this.statusCode = code; return this; },
    end(payload) { if (payload !== undefined) this.body = payload; }
  };
  return res;
}

function call({ method = 'GET', query = {}, body } = {}) {
  const req = { method, query, body };
  const res = mockRes();
  handler(req, res);
  assert.ok(res.body, 'handler should write a JSON body');
  return { status: res.statusCode, json: JSON.parse(res.body) };
}

test('single (non-batch) requests still work and match _math output shape', () => {
  const { status, json } = call({
    method: 'POST',
    body: { model: 'singleTurn', promptTokens: 4096, outputTokens: 512 }
  });
  assert.equal(status, 200);
  assert.equal(json.inputs.promptTokens, 4096);
  assert.equal(typeof json.totalWalltimeSeconds, 'number');
});

test('batch POST returns per-index results for every parameter set', () => {
  const { status, json } = call({
    method: 'POST',
    body: {
      batch: [
        { model: 'singleTurn', promptTokens: 4096, outputTokens: 512 },
        { model: 'kvCache', architecture: 'llama70b', contextLength: 131072 },
        { model: 'agentic', numTurns: 4 }
      ]
    }
  });
  assert.equal(status, 200);
  assert.equal(json.batch, true);
  assert.equal(json.count, 3);
  assert.equal(json.okCount, 3);
  assert.equal(json.errorCount, 0);
  assert.deepEqual(json.results.map(r => r.index), [0, 1, 2]);
  assert.ok(json.results.every(r => r.ok === true && r.result));
});

test('batch results are identical to individual calls (same math)', () => {
  const single = call({
    method: 'POST',
    body: { model: 'speculative', baseDecodeSpeed: 120, draftTokens: 4, acceptanceRate: 0.8 }
  }).json;
  const batchedCall = call({
    method: 'POST',
    body: { variants: [{ model: 'speculative', baseDecodeSpeed: 120, draftTokens: 4, acceptanceRate: 0.8 }] }
  });
  assert.deepEqual(batchedCall.json.results[0].result, single);
});

test('one bad scenario does not fail the batch — per-item error instead', () => {
  const { status, json } = call({
    method: 'POST',
    body: {
      batch: [
        { model: 'nope', bogus: true },
        { model: 'singleTurn' },
        'not-an-object'
      ]
    }
  });
  assert.equal(status, 200); // batch itself succeeds
  assert.equal(json.count, 3);
  assert.equal(json.okCount, 1);
  assert.equal(json.errorCount, 2);
  assert.equal(json.results[0].ok, false);
  assert.match(json.results[0].error, /Unknown model/);
  assert.equal(json.results[1].ok, true);
  assert.equal(json.results[2].ok, false);
  assert.match(json.results[2].error, /must be an object/);
});

test('GET ?batch=<json array> works like POST batch', () => {
  const { status, json } = call({
    query: { batch: JSON.stringify([{ model: 'kvCache' }, { model: 'kvCache', batchSize: 8 }]) }
  });
  assert.equal(status, 200);
  assert.equal(json.okCount, 2);
  assert.notEqual(json.results[1].result.totalGb, json.results[0].result.totalGb);
});

test('empty batch and oversized batch are rejected with a clear error', () => {
  const empty = call({ method: 'POST', body: { batch: [] } });
  assert.equal(empty.status, 400);
  assert.match(empty.json.error, /at least one/);

  const tooBig = call({ method: 'POST', body: { batch: Array(MAX_BATCH_SIZE + 1).fill({ model: 'singleTurn' }) } });
  assert.equal(tooBig.status, 400);
  assert.match(tooBig.json.error, new RegExp(String(MAX_BATCH_SIZE)));
  assert.equal(tooBig.json.maxSize, MAX_BATCH_SIZE);

  // exactly at the cap is allowed
  const atCap = call({ method: 'POST', body: { batch: Array(MAX_BATCH_SIZE).fill({ model: 'kvCache' }) } });
  assert.equal(atCap.status, 200);
  assert.equal(atCap.json.count, MAX_BATCH_SIZE);
});

test('non-array batch payloads get a 400', () => {
  const badJson = call({ query: { batch: '{not json' } });
  assert.equal(badJson.status, 400);
  assert.match(badJson.error ?? badJson.json.error, /JSON array|parse/);

  const obj = call({ method: 'POST', body: { batch: { model: 'singleTurn' } } });
  assert.equal(obj.status, 400);
  assert.match(obj.json.error, /JSON array/);
});
