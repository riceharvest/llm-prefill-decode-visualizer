// Issue #550: documented /api/compute token-count params accepted negative
// and ~1e12 values silently — negative ttftSeconds/walltime with warnings:[].
// Fix is additive: a `tokens_implausible` warning on implausible counts,
// math/status/inputs echo unchanged.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { sanityWarnings, MAX_PLAUSIBLE_TOKEN_COUNT } from './_math.js';
import computeHandler from './_handlers/compute.js';

function mockRes() {
  const res = {
    statusCode: 200,
    headers: {},
    body: undefined,
    setHeader(k, v) { this.headers[String(k).toLowerCase()] = v; },
    getHeader(k) { return this.headers[String(k).toLowerCase()]; },
    hasHeader(k) { return Object.prototype.hasOwnProperty.call(this.headers, String(k).toLowerCase()); },
    end(payload) { if (payload !== undefined) this.body = payload; }
  };
  return res;
}

function compute(query) {
  const res = mockRes();
  computeHandler({ method: 'GET', query, headers: {}, url: '/api/compute' }, res);
  assert.equal(res.statusCode, 200);
  return JSON.parse(res.body);
}

test('#550 bug proof: negative token counts used to produce zero warnings', () => {
  const warnings = sanityWarnings({ promptTokens: -100, prefillSpeed: 3800, decodeSpeed: 105 });
  const codes = warnings.map(w => w.code);
  assert.ok(codes.includes('tokens_implausible'), `expected tokens_implausible, got ${codes}`);
});

test('sanityWarnings flags negative, zero and astronomic counts on both params', () => {
  for (const bad of [-100, 0, 1e12]) {
    for (const field of ['promptTokens', 'outputTokens']) {
      const warnings = sanityWarnings(
        field === 'promptTokens'
          ? { promptTokens: bad, prefillSpeed: 3800, decodeSpeed: 105 }
          : { promptTokens: 2048, outputTokens: bad, prefillSpeed: 3800, decodeSpeed: 105 }
      );
      const hit = warnings.filter(w => w.code === 'tokens_implausible' && w.message.includes(field));
      assert.equal(hit.length, 1, `${field}=${bad}: expected exactly one tokens_implausible warning, got ${JSON.stringify(warnings)}`);
    }
  }
});

test('plausible counts never emit the new warning (no false positives)', () => {
  const noTokenCode = w => w.code !== 'tokens_implausible';
  assert.deepEqual(sanityWarnings({ promptTokens: 2048, outputTokens: 512, prefillSpeed: 3800, decodeSpeed: 105 }), []);
  assert.deepEqual(sanityWarnings({ promptTokens: 1, outputTokens: 1, prefillSpeed: 105, decodeSpeed: 105 }).filter(noTokenCode), []);
  assert.deepEqual(sanityWarnings({ promptTokens: MAX_PLAUSIBLE_TOKEN_COUNT, outputTokens: MAX_PLAUSIBLE_TOKEN_COUNT, prefillSpeed: 3800, decodeSpeed: 105 }).filter(noTokenCode), []);
  // Omitted params (speculative-style caller) must not trip the check.
  assert.deepEqual(sanityWarnings({ decodeSpeed: 105 }).filter(noTokenCode), []);
});

test('/api/compute?model=singleTurn carries tokens_implausible without changing math or inputs', () => {
  const res = compute({ model: 'singleTurn', promptTokens: '-100', outputTokens: '-50' });
  assert.equal(res.inputs.promptTokens, -100, 'inputs echo must stay verbatim');
  assert.equal(res.inputs.outputTokens, -50);
  const codes = res.warnings.map(w => w.code);
  assert.ok(codes.includes('tokens_implausible'), `expected tokens_implausible, got ${codes}`);

  const clean = compute({ model: 'singleTurn' });
  assert.deepEqual(clean.warnings, [], 'clean calls keep warnings:[]');
});

test('/api/compute?model=batched also flags implausible counts', () => {
  const res = compute({ model: 'batched', promptTokens: '999999999999' });
  assert.ok(res.warnings.some(w => w.code === 'tokens_implausible' && w.message.includes('promptTokens')));
});
