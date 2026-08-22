import test from 'node:test';
import assert from 'node:assert/strict';
import handler from './handlers/parse-constraints.js';

function mockReq({ method = 'GET', query = {}, body } = {}) {
  return { method, query, ...(body !== undefined ? { body } : {}) };
}

function mockRes() {
  return {
    statusCode: 0,
    headers: {},
    body: null,
    setHeader(k, v) { this.headers[k] = v; },
    getHeader(k) { return this.headers[k]; },
    end(b) { this.body = b; },
    status(code) { this.statusCode = code; return this; }
  };
}

test('GET parses the issue example into canonical constraints + ambiguities', () => {
  const res = mockRes();
  handler(mockReq({ query: { q: 'self-hosted Qwen 27B at Q4 for 10 users under $1500' } }), res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['Content-Type'], 'application/json; charset=utf-8');
  assert.equal(res.headers['X-Schema-Version'], '1');

  const body = JSON.parse(res.body);
  assert.equal(body.schema_version, '1');
  assert.equal(body.input, 'self-hosted Qwen 27B at Q4 for 10 users under $1500');
  assert.equal(body.constraints.deployment, 'self-hosted');
  assert.equal(body.constraints.modelFamily, 'qwen');
  assert.equal(body.constraints.paramsB, 27);
  assert.equal(body.constraints.quantization, 'q4');
  assert.equal(body.constraints.concurrency, 10);
  assert.equal(body.constraints.budgetUsdMax, 1500);
  assert.ok(Array.isArray(body.ambiguities));
  assert.ok(body.ambiguities.length >= 1);
  assert.equal(body.recognizedCount >= 5, true);
  assert.match(body.sizingQuery, /^\/api\/sizing\?/);
  assert.ok(body.sizingQuery.includes('model=qwen'));
});

test('missing q returns a 400 problem+json', () => {
  const res = mockRes();
  handler(mockReq({ query: {} }), res);

  assert.equal(res.statusCode, 400);
  assert.equal(res.headers['Content-Type'], 'application/problem+json');
  const body = JSON.parse(res.body);
  assert.equal(body.code, 'INVALID_PARAMS');
  assert.match(body.detail, /Missing \?q=/);
});

test('POST accepts a JSON body with q', () => {
  const res = mockRes();
  handler(mockReq({ method: 'POST', body: { q: 'llama 70B q4_k_m on a 48GB GPU' } }), res);

  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.equal(body.constraints.quantization, 'q4_k_m');
  assert.equal(body.constraints.maxVramGb, 48);
});

test('unparseable input still returns 200 with an input ambiguity', () => {
  const res = mockRes();
  handler(mockReq({ query: { q: 'gibberish' } }), res);

  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.equal(body.recognizedCount, 0);
  assert.ok(body.ambiguities.some(a => a.field === 'input'));
  assert.equal(body.sizingQuery, null);
});
