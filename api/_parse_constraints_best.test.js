// #718 — parse-constraints must emit a bestQuery alongside sizingQuery, and
// #717 — every /api/* response must expose x-vercel-mitigated/x-vercel-error
// so browser-context agents can classify platform challenge responses.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import handler from '../api/_handlers/parse-constraints.js';
import { constraintsToBestQuery } from '../api/_parse_constraints.js';

function makeRes() {
  const captured = {};
  return {
    captured,
    statusCode: 0,
    headers: {},
    setHeader(k, v) { this.headers[k] = v; },
    getHeader(k) { return this.headers[String(k).toLowerCase()]; },
    hasHeader(k) { return String(k).toLowerCase() in this.headers; },
    end(body) {
      captured.status = this.statusCode;
      captured.rawBody = body ?? '';
    },
    status(c) { this.statusCode = c; return this; }
  };
}

test('constraintsToBestQuery maps the parsed struct onto /api/best params', () => {
  const params = constraintsToBestQuery({
    modelFamily: 'qwen', quantization: 'q4_k_m', paramsB: 27,
    maxVramGb: 48, hwClass: 'discrete_gpu', contextLength: 32768
  });
  assert.equal(params.get('model'), 'qwen');
  assert.equal(params.get('quant'), 'q4_k_m');
  assert.equal(params.get('maxParamsB'), '27');
  assert.equal(params.get('maxVramGb'), '48');
  assert.equal(params.get('hwClass'), 'discrete_gpu');
  assert.equal(params.get('contextLength'), '32768');
  assert.equal(params.get('fitCheck'), 'true', 'stated context length implies the VRAM feasibility filter');
});

test('empty struct yields an empty param set (handler emits bestQuery: null)', () => {
  assert.equal(constraintsToBestQuery({}).toString(), '');
});

test('handler response carries bestQuery next to sizingQuery (#718)', async () => {
  const res = makeRes();
  await handler(
    { method: 'GET', query: { q: 'self-hosted Qwen 27B at Q4 for 10 users under $1500' }, headers: { 'x-forwarded-for': 'bestquery-test' } },
    res
  );
  assert.equal(res.captured.status, 200);
  const body = JSON.parse(res.captured.rawBody);
  assert.ok(body.sizingQuery.startsWith('/api/sizing?'), 'sizingQuery still present');
  assert.match(body.bestQuery, /^\/api\/best\?/, 'bestQuery is a ready-made /api/best query string');
  const parsed = new URLSearchParams(body.bestQuery.split('?')[1]);
  assert.equal(parsed.get('model'), 'qwen');
  assert.ok(parsed.get('quant'), 'quant must be forwarded to /api/best');
  // budgetUsdMax has no /api/best counterpart — must not be emitted blindly.
  assert.equal(parsed.get('budgetUsdMax'), null);
});

test('every /api/* response exposes x-vercel-mitigated/x-vercel-error to CORS consumers (#717)', async () => {
  const res = makeRes();
  await handler(
    { method: 'GET', query: { q: 'qwen 27B' }, headers: { 'x-forwarded-for': 'expose-test' } },
    res
  );
  const expose = String(res.headers['Access-Control-Expose-Headers'] || '');
  assert.ok(expose.toLowerCase().includes('x-vercel-mitigated'), `missing in: ${expose}`);
  assert.ok(expose.toLowerCase().includes('x-vercel-error'), `missing in: ${expose}`);
});
