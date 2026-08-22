import { test } from 'node:test';
import assert from 'node:assert/strict';
import handler, { MAX_BATCH_SIZE } from './handlers/compute.js';

// Minimal Vercel-style req/res mocks so we can unit-test the handler
// without a server.
function mockRes() {
  const res = {
    statusCode: 200,
    headers: {},
    body: undefined,
    setHeader(k, v) { this.headers[k] = v; },
    getHeader(k) { return this.headers[k]; },
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
  assert.equal(json.results[0].code, 'INVALID_PARAMS');
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

test('empty batch and oversized batch are rejected with an INVALID_PARAMS problem', () => {
  const empty = call({ method: 'POST', body: { batch: [] } });
  assert.equal(empty.status, 400);
  assert.equal(empty.json.code, 'INVALID_PARAMS');
  assert.match(empty.json.detail, /at least one/);

  const tooBig = call({ method: 'POST', body: { batch: Array(MAX_BATCH_SIZE + 1).fill({ model: 'singleTurn' }) } });
  assert.equal(tooBig.status, 400);
  assert.equal(tooBig.json.code, 'INVALID_PARAMS');
  assert.match(tooBig.json.detail, new RegExp(String(MAX_BATCH_SIZE)));
  assert.equal(tooBig.json.maxSize, MAX_BATCH_SIZE);

  // exactly at the cap is allowed
  const atCap = call({ method: 'POST', body: { batch: Array(MAX_BATCH_SIZE).fill({ model: 'kvCache' }) } });
  assert.equal(atCap.status, 200);
  assert.equal(atCap.json.count, MAX_BATCH_SIZE);
});

test('flagged model applies engine flag deltas and returns an audit trail', () => {
  const { status, json } = call({
    method: 'POST',
    body: { model: 'flagged', prefillSpeed: 2400, decodeSpeed: 65, flags: 'flash-attn,kv-q8' }
  });
  assert.equal(status, 200);
  assert.deepEqual(json.inputs.flags, ['flash-attn', 'kv-q8']);
  // flash-attn (+18/+3) then kv-q8 (+4/+8) compose multiplicatively
  assert.equal(json.adjusted.prefillSpeed, Math.round(2400 * 1.18 * 1.04));
  assert.equal(json.adjusted.kvBits, 8);
  assert.equal(json.adjustments.length, 2);
  assert.ok(json.adjustments.every(a => a.source === 'heuristic' && a.sourceNote));
  assert.ok(json.simulation.ttftSeconds > 0);
  assert.ok(json.simulation.totalWalltimeSeconds > 0);
});

test('flagged model warns on unknown flags and simulates unflagged when none given', () => {
  const unknown = call({ query: { model: 'flagged', flags: 'bogus' } });
  assert.equal(unknown.status, 200);
  assert.match(unknown.json.warnings[0], /Unknown flag id 'bogus'/);

  const bare = call({ query: { model: 'flagged', prefillSpeed: 3800, decodeSpeed: 105 } });
  assert.equal(bare.json.adjusted.prefillSpeed, 3800);
  assert.deepEqual(bare.json.adjustments, []);

  // Same math as singleTurn when no flags are active
  const plain = call({ query: { model: 'singleTurn', prefillSpeed: 3800, decodeSpeed: 105 } });
  assert.equal(bare.json.simulation.totalWalltimeSeconds, plain.json.totalWalltimeSeconds);
});

test('non-array batch payloads get a 400 INVALID_PARAMS problem', () => {
  const badJson = call({ query: { batch: '{not json' } });
  assert.equal(badJson.status, 400);
  assert.equal(badJson.json.code, 'INVALID_PARAMS');
  assert.match(badJson.error ?? badJson.json.detail, /JSON array|parse/);

  const obj = call({ method: 'POST', body: { batch: { model: 'singleTurn' } } });
  assert.equal(obj.status, 400);
  assert.equal(obj.json.code, 'INVALID_PARAMS');
  assert.match(obj.json.detail, /JSON array/);
});

test('unknown model gets an RFC 9457 INVALID_PARAMS problem served as application/problem+json', () => {
  const res = mockRes();
  handler({ method: 'GET', query: { model: 'nope' } }, res);
  assert.equal(res.statusCode, 400);
  assert.equal(res.headers['Content-Type'], 'application/problem+json');
  const json = JSON.parse(res.body);
  assert.equal(json.code, 'INVALID_PARAMS');
  assert.match(json.detail, /Unknown model/);
  assert.deepEqual(json.available, ['singleTurn', 'speculative', 'batched', 'agentic', 'kvCache', 'flagged', 'cost']);
});

test('implausible inputs return 200 with a non-blocking warnings array', () => {
  const { status, json } = call({
    method: 'POST',
    body: { model: 'singleTurn', promptTokens: 64, prefillSpeed: 900000, decodeSpeed: 5000 }
  });
  assert.equal(status, 200); // warnings never fail the request
  const codes = json.warnings.map(w => w.code);
  assert.ok(codes.includes('decode_above_bandwidth_roofline'));
  assert.ok(codes.includes('prefill_above_compute_roofline'));
  assert.ok(codes.includes('ttft_below_kernel_launch_floor'));
  // math is still computed and untouched
  assert.equal(typeof json.totalWalltimeSeconds, 'number');
});

test('plausible inputs return an empty warnings array', () => {
  const { json } = call({
    method: 'POST',
    body: { model: 'singleTurn', promptTokens: 4096, outputTokens: 512 }
  });
  assert.deepEqual(json.warnings, []);
});

test('capability list documents the sanity warnings', () => {
  const { json } = call({ query: {} });
  assert.equal(json.sanity.codes.length, 3);
  assert.match(json.sanity.description, /warnings/);
});

// ---------------------------------------------------------------------------
// dry_run mode (#17): validate + echo parsed params without executing
// ---------------------------------------------------------------------------

test('dry_run=true validates and echoes parsed params without executing', () => {
  const { status, json } = call({
    query: { model: 'singleTurn', promptTokens: '4096', dry_run: 'true' }
  });
  assert.equal(status, 200);
  assert.equal(json.dry_run, true);
  assert.equal(json.model, 'singleTurn');
  // explicit params echoed with type coercion...
  assert.equal(json.inputs.promptTokens, 4096);
  // ...and defaults filled in
  assert.equal(json.inputs.outputTokens, 512);
  assert.equal(json.inputs.decodeSpeed, 105);
  assert.match(json.id, /^calc_[0-9a-f]{12}$/);
  assert.match(json.note, /nothing was computed/i);
  // none of the computed fields appear — no math ran
  assert.equal(json.totalWalltimeSeconds, undefined);
  assert.equal(json.warnings, undefined);
});

test('a dry_run request returns the SAME id as the real execution', () => {
  const dry = call({ query: { model: 'singleTurn', promptTokens: '4096', outputTokens: '512', dry_run: '1' } });
  const real = call({ query: { model: 'singleTurn', promptTokens: '4096', outputTokens: '512' } });
  assert.equal(dry.status, 200);
  assert.equal(real.status, 200);
  assert.equal(typeof real.json.totalWalltimeSeconds, 'number');
  assert.equal(dry.json.id, real.json.id);
});

test('dry_run still rejects unknown models with INVALID_PARAMS', () => {
  const { status, json } = call({
    query: { model: 'nope', dry_run: 'true' }
  });
  assert.equal(status, 400);
  assert.equal(json.code, 'INVALID_PARAMS');
  assert.match(json.detail, /Unknown model/);
});

test('dry_run works via POST body (boolean) and covers every model', () => {
  for (const model of ['singleTurn', 'speculative', 'batched', 'agentic', 'kvCache', 'flagged', 'cost']) {
    const { status, json } = call({
      method: 'POST',
      body: { model, dry_run: true }
    });
    assert.equal(status, 200, model);
    assert.equal(json.dry_run, true, model);
    assert.equal(json.model, model);
    assert.equal(json.warnings, undefined, model);
    assert.ok(json.inputs && typeof json.inputs === 'object', model);
    // flagged echoes raw flags; kvCache resolves its architecture
    if (model === 'flagged') assert.equal(json.inputs.flags, '');
    if (model === 'kvCache') assert.equal(json.inputs.architecture, 'generic');
  }
});

test('dry_run inside a batch validates each item without executing any of them', () => {
  const { status, json } = call({
    method: 'POST',
    body: {
      dry_run: true,
      batch: [
        { model: 'singleTurn', promptTokens: 4096 },
        { model: 'kvCache', architecture: 'llama70b', contextLength: 131072 },
        { model: 'bogus' }
      ]
    }
  });
  assert.equal(status, 200);
  assert.equal(json.okCount, 2);
  assert.equal(json.errorCount, 1);
  const [a, b, bad] = json.results;
  assert.equal(a.result.dry_run, true);
  assert.equal(a.result.inputs.promptTokens, 4096);
  assert.equal(a.result.totalWalltimeSeconds, undefined);
  assert.equal(b.result.dry_run, true);
  assert.equal(b.result.inputs.contextLength, 131072);
  assert.equal(bad.ok, false);
  assert.match(bad.error, /Unknown model/);
});

test('dry_run=false or absent executes normally (no dry_run echo)', () => {
  for (const flag of [undefined, 'false', '0']) {
    const query = { model: 'singleTurn', promptTokens: '4096' };
    if (flag !== undefined) query.dry_run = flag;
    const { status, json } = call({ query });
    assert.equal(status, 200);
    assert.equal(json.dry_run, undefined);
    assert.equal(typeof json.totalWalltimeSeconds, 'number');
  }
});

test('capability list documents the dry-run mode', () => {
  const { json } = call({ query: {} });
  assert.match(json.dryRun.description, /dry_run/);
  assert.match(json.dryRun.example, /dry_run=true/);
});
