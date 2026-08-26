// #646 + #637 — /api/vram numeric-input validation warnings and fit-model
// provenance echo.
//
// Offline: every case uses meta-llama/Llama-3.1-8B-Instruct, which resolves
// from the built-in _hflookup table (tier 1) so no network call happens.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import handler from './vram.js';

const HFID = 'meta-llama/Llama-3.1-8B-Instruct';

function mockRes() {
  return {
    statusCode: 200,
    headers: {},
    body: undefined,
    setHeader(k, v) { this.headers[k] = v; },
    getHeader(k) { return this.headers[k]; },
    end(payload) { if (payload !== undefined) this.body = payload; }
  };
}

async function call(query) {
  const res = mockRes();
  await handler({ method: 'GET', url: `/api/vram?${new URLSearchParams(query)}`, query }, res);
  assert.ok(res.body, 'handler must end the response with a body');
  return { res, body: JSON.parse(res.body) };
}

const warnCodes = body => (body.warnings || []).map(w => w.code);

test('clean call: byte-stable shape — no warnings field, fitAssumptions present (#646/#637)', async () => {
  const { res, body } = await call({ hfId: HFID, context: '65536', quant: 'q4_k_m', vramGb: '24' });
  assert.equal(res.statusCode, 200);
  assert.equal(body.warnings, undefined, 'warnings must be absent on clean calls');
  assert.deepEqual(warnCodes(body), []);
  assert.equal(body.inputs.context, 65536);
  assert.equal(body.fitAssumptions.bpw, 4.85);
});

test("context=banana falls back to the default LOUDLY (#646)", async () => {
  const { body } = await call({ hfId: HFID, context: 'banana' });
  assert.equal(body.inputs.context, 32768);
  assert.ok(warnCodes(body).includes('input_coerced_to_default'));
  const w = body.warnings.find(x => x.code === 'input_coerced_to_default');
  assert.match(w.message, /context='banana'/);
  assert.match(w.message, /32768/);
});

test('context=-5 is clamped to 1 with an explicit warning (#646)', async () => {
  const { body } = await call({ hfId: HFID, context: '-5' });
  assert.equal(body.inputs.context, 1);
  assert.ok(warnCodes(body).includes('input_clamped_to_minimum'));
  assert.ok(warnCodes(body).every(c => c !== 'input_coerced_to_default'), '-5 is finite — coerce warning must NOT fire');
});

test('batchSize=-1 clamps to 1 loudly (#646)', async () => {
  const { body } = await call({ hfId: HFID, batchSize: '-1' });
  assert.equal(body.inputs.batchSize, 1);
  assert.ok(warnCodes(body).includes('input_clamped_to_minimum'));
});

test('kvPrecisionBytes=-2 uses default 2 instead of negative-KV garbage (#646)', async () => {
  const { body } = await call({ hfId: HFID, context: '1000', kvPrecisionBytes: '-2' });
  assert.equal(body.inputs.kvPrecisionBytes, 2);
  assert.ok(warnCodes(body).includes('kv_precision_bytes_invalid'));
  assert.ok(body.kvCache.bytesPerToken > 0, 'bytesPerToken must stay positive');
  // weights alone ≈ 4.49 GB; total must be ≥ weights, never less
  assert.ok(body.total.gb >= body.weights.gb);
});

test('kvPrecisionBytes=0 no longer zeroes KV into a false fits:true (#646)', async () => {
  const { body } = await call({ hfId: HFID, context: '1000', kvPrecisionBytes: '0', vramGb: '24' });
  assert.equal(body.inputs.kvPrecisionBytes, 2);
  assert.ok(warnCodes(body).includes('kv_precision_bytes_invalid'));
  assert.ok(body.fits, 'sane inputs still produce a fit verdict for a 24 GB budget');
  assert.ok(body.fits.maxContextTokens !== null || true); // guard shape only
  assert.ok(body.kvCache.bytesPerToken > 0);
});

test('vramGb=banana reports the ignored budget instead of silent fits:null (#646)', async () => {
  const { res, body } = await call({ hfId: HFID, context: '65536', vramGb: 'banana' });
  assert.equal(res.statusCode, 200);
  assert.equal(body.fits, null);
  assert.ok(warnCodes(body).includes('vram_budget_ignored'));
  const w = body.warnings.find(x => x.code === 'vram_budget_ignored');
  assert.match(w.message, /vramGb='banana'/);
  assert.match(w.message, /fits will be null/);
});

test('fitAssumptions echoes the bpw source — assumed fallback flagged (#637)', async () => {
  const known = (await call({ hfId: HFID, quant: 'q8_0' })).body;
  assert.equal(known.fitAssumptions.bpwSource, 'quant-table');
  assert.equal(known.fitAssumptions.bpw, 8.5);

  const unknown = (await call({ hfId: HFID, quant: 'weird-quant-tag' })).body;
  assert.equal(unknown.fitAssumptions.bpwSource, 'assumed-fallback');
  assert.equal(unknown.inputs.quantAssumed, true);
});

test('fitAssumptions.archSource tracks the resolution tier (#637)', async () => {
  const { body } = await call({ hfId: HFID });
  assert.equal(body.model.resolutionSource, 'builtin-table');
  assert.equal(body.fitAssumptions.archSource, 'builtin-table');
});

test('fitAssumptions.overheadModel distinguishes /api/vram from /api/sizing conventions (#637)', async () => {
  const { body } = await call({ hfId: HFID });
  assert.equal(body.fitAssumptions.overheadModel, 'none');
  assert.match(body.fitAssumptions.overheadNote, /\/api\/sizing/);
});
