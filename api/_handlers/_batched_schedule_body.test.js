// Issue #529 — model=batched scheduling mode: optional chunkTokens /
// arrivalIntervalMs / numRequests switch the response from the smooth B^0.25
// aggregate curve to a discrete engine-step schedule produced by the SAME
// module the Batching view animates (src/utils/batchScheduling.js).
//
// Issue #537 — malformed/non-object POST bodies must return 400 problem+json
// with a stable code, not an off-contract 500 or a silent 200.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import handler, { normalizeJsonBody, MAX_SCHEDULE_STEPS_RETURNED } from './compute.js';
import { generateRequests, simulateBatching } from '../../src/utils/batchScheduling.js';

function mockRes() {
  const res = {
    statusCode: 200,
    headers: {},
    body: undefined,
    setHeader(k, v) { this.headers[k] = v; },
    getHeader(k) { return this.headers[k]; },
    hasHeader(k) { return Object.prototype.hasOwnProperty.call(this.headers, k); },
    removeHeader(k) { delete this.headers[k]; },
    status(code) { this.statusCode = code; return this; },
    end(payload) { if (payload !== undefined) this.body = payload; }
  };
  return res;
}

function call({ method = 'GET', query = {}, body } = {}) {
  const req = { method, query, body };
  const res = mockRes();
  handler(req, res);
  assert.ok(res.body !== undefined, 'handler should write a body');
  let json;
  try { json = JSON.parse(res.body); } catch { json = undefined; }
  return { status: res.statusCode, json, contentType: res.headers['Content-Type'] || res.headers['content-type'] };
}

// ---------- #529: batched scheduling mode ----------

test('batched without scheduling params keeps the legacy aggregate-only response', () => {
  const { status, json } = call({ query: { model: 'batched', batchSize: '8' } });
  assert.equal(status, 200);
  assert.equal(json.simulation, undefined);
  assert.equal(json.scheduling, undefined);
});

test('batched + chunkTokens returns a per-step schedule matching the UI simulator', () => {
  const { status, json } = call({
    query: {
      model: 'batched',
      numRequests: '6',
      maxBatchSize: '4',
      promptTokens: '1024',
      outputTokens: '64',
      chunkTokens: '256',
      arrivalIntervalMs: '40',
      seed: '7'
    }
  });
  assert.equal(status, 200);
  assert.ok(json.simulation, 'expected additive simulation block');
  assert.equal(json.scheduling.startsWith('engine-step simulation'), true);

  const sim = json.simulation;
  assert.equal(sim.inputs.numRequests, 6);
  assert.equal(sim.inputs.maxBatchSize, 4);
  assert.equal(sim.inputs.chunkTokens, 256);
  assert.equal(sim.inputs.arrivalIntervalMs, 40);
  assert.equal(sim.inputs.seed, 7);

  assert.ok(sim.stepCount > 0);
  assert.equal(sim.steps.length, Math.min(sim.stepCount, MAX_SCHEDULE_STEPS_RETURNED));
  assert.equal(typeof sim.makespanSeconds, 'number');

  // Steps carry phase / occupancy / queue depth.
  const first = sim.steps[0];
  for (const key of ['index', 'tStartSeconds', 'tEndSeconds', 'durationSeconds', 'phase', 'batchSize', 'queued', 'admitted', 'finished', 'prefill', 'decodedCount']) {
    assert.ok(key in first, `step missing ${key}`);
  }
  // Chunked prefill caps per-step prefill work at chunkTokens.
  const prefills = sim.steps.filter(s => s.prefill).map(s => s.prefill.tokens);
  assert.ok(prefills.length > 0, 'chunked prefill should appear');
  assert.ok(prefills.every(t => t <= 256), `prefill chunk over chunkTokens: ${Math.max(...prefills)}`);

  // Determinism: same seed → identical makespan and step count.
  const again = call({ query: { model: 'batched', numRequests: '6', maxBatchSize: '4', promptTokens: '1024', outputTokens: '64', chunkTokens: '256', arrivalIntervalMs: '40', seed: '7' } });
  assert.equal(again.json.simulation.makespanSeconds, sim.makespanSeconds);
  assert.equal(again.json.simulation.stepCount, sim.stepCount);

  // Cross-check against the UI module driven directly with the same inputs.
  const reqs = generateRequests({ numRequests: 6, meanPromptTokens: 1024, meanOutputTokens: 64, arrivalIntervalMs: 40, seed: 7 });
  const ui = simulateBatching({ requests: reqs, maxBatchSize: 4, chunkSize: 256, prefillSpeed: 3800, decodeSpeed: 105 });
  assert.equal(sim.stepCount, ui.steps.length);
  assert.equal(sim.makespanSeconds, Math.round(ui.makespan * 1e6) / 1e6);

  // Summary metrics mirror the module's summary.
  assert.equal(sim.summary.totalOutputTokens, ui.summary.totalOutputTokens);
  assert.ok(Number.isFinite(sim.summary.throughputTokPerSec));

  // Per-request timeline: TTFT present, no raw itls arrays.
  assert.equal(sim.requests.length, 6);
  for (const r of sim.requests) {
    assert.ok(!('itls' in r), 'raw itls arrays must not be serialized');
    assert.ok('ttftSeconds' in r && 'finishTimeSeconds' in r);
  }

  // The legacy aggregate curve still rides along (additive change).
  assert.ok(Number.isFinite(json.perUserDecodeTokPerSec) && Number.isFinite(json.aggregateDecodeTokPerSec),
    'legacy batched fields should remain');
});

test('batched chunkTokens=0 disables chunking (whole-prompt steps)', () => {
  const { json } = call({
    query: { model: 'batched', numRequests: '2', promptTokens: '512', outputTokens: '8', chunkTokens: '0', arrivalIntervalMs: '0' }
  });
  const sim = json.simulation;
  // With chunking off, every request's ENTIRE prompt is ingested in one
  // step: one prefill-carrying step per request, matching its full prompt.
  const prefillSteps = sim.steps.filter(s => s.prefill);
  assert.equal(prefillSteps.length, 2);
  for (const s of prefillSteps) {
    const req = sim.requests.find(r => r.id === s.prefill.id);
    assert.equal(s.prefill.tokens, req.promptTokens, 'unchunked step must carry the whole prompt');
  }
});

// ---------- #537: POST body contract ----------

test('malformed JSON POST body → 400 problem+json INVALID_PARAMS (was off-contract failure)', () => {
  const { status, json, contentType } = call({ method: 'POST', body: '{not json' });
  assert.equal(status, 400, 'a syntactically invalid body is a client error');
  assert.match(String(contentType), /problem\+json/);
  assert.equal(json.code, 'INVALID_PARAMS');
  assert.match(json.detail, /valid JSON/);
});

test("the Vercel-style literal 'Invalid JSON' string body also lands on 400", () => {
  const { status, json } = call({ method: 'POST', body: 'Invalid JSON' });
  assert.equal(status, 400);
  assert.equal(json.code, 'INVALID_PARAMS');
});

test('non-object JSON bodies (array / number) → 400 instead of a silent 200 capability index', () => {
  for (const bad of [[1, 2], 42, '"str"', true]) {
    const { status, json } = call({ method: 'POST', body: bad });
    assert.equal(status, 400, `expected 400 for body ${JSON.stringify(bad)}`);
    assert.equal(json.code, 'INVALID_PARAMS');
    assert.match(json.detail, /JSON object/);
  }
});

test('valid JSON object POST bodies still compute normally', () => {
  const { status, json } = call({ method: 'POST', body: { model: 'singleTurn', promptTokens: 4096, outputTokens: 512 } });
  assert.equal(status, 200);
  assert.equal(json.inputs.promptTokens, 4096);
});

test('empty / absent POST body still yields the capability list (back-compat)', () => {
  assert.equal(call({ method: 'POST' }).status, 200);
  assert.equal(call({ method: 'POST', body: '' }).status, 200);
});

test('normalizeJsonBody unit contract', () => {
  assert.deepEqual(normalizeJsonBody(undefined), {});
  assert.deepEqual(normalizeJsonBody(null), {});
  assert.deepEqual(normalizeJsonBody(''), {});
  assert.deepEqual(normalizeJsonBody('   '), {});
  assert.deepEqual(normalizeJsonBody('{"model":"cost"}'), { model: 'cost' });
  assert.throws(() => normalizeJsonBody('{oops'), /valid JSON/);
  assert.throws(() => normalizeJsonBody('[1]'), /JSON object/);
});
