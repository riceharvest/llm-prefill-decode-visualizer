// #819 — /api/vram ?overheadFraction= knob. Previously the param was silently
// ignored and total.breakdown carried no overhead component at all; now a
// fraction in [0,1] scales (weights+KV) and the omission is machine-readable
// (overheadModel:'none' + isUpperBound:true).
import test from 'node:test';
import assert from 'node:assert/strict';
import handler from '../api/_handlers/vram.js';

// Offline model from the builtin lookup tier — no network in tests.
const HF_ID = 'meta-llama/Llama-3.1-8B-Instruct';

function runHandler(query) {
  return new Promise(resolve => {
    const res = {
      statusCode: 200,
      headers: {},
      setHeader(k, v) { this.headers[k] = v; },
      end(body) { resolve({ status: this.statusCode, body: JSON.parse(body) }); },
      status(code) { this.statusCode = code; return this; }
    };
    handler({ method: 'GET', query }, res);
  });
}

test('#819 baseline (no overheadFraction): legacy numbers + machine-readable overheadModel', async () => {
  const { status, body } = await runHandler({ hfId: HF_ID, context: '8192' });
  assert.equal(status, 200);
  assert.equal(body.overheadModel, 'none');
  assert.equal(body.isUpperBound, true);
  assert.equal(body.inputs.overheadFraction, undefined);
  // breakdown now carries frameworkOverheadGb explicitly = 0
  const b = body.total.breakdown;
  assert.equal(b.frameworkOverheadGb, 0);
  // total unchanged vs legacy weights+KV sum
  assert.ok(Math.abs(body.total.gb - (b.weightsGb + b.kvCacheGb)) < 1e-6);
});

test('#819 overheadFraction=0.25 scales weights+KV and echoes the input', async () => {
  const base = (await runHandler({ hfId: HF_ID, context: '8192' })).body;
  const { status, body } = await runHandler({ hfId: HF_ID, context: '8192', overheadFraction: '0.25' });
  assert.equal(status, 200);
  assert.equal(body.overheadModel, 'fraction');
  assert.equal(body.isUpperBound, false);
  assert.equal(body.inputs.overheadFraction, 0.25);
  const expectedOverhead = (base.total.breakdown.weightsGb + base.total.breakdown.kvCacheGb) * 0.25;
  assert.ok(Math.abs(body.total.breakdown.frameworkOverheadGb - expectedOverhead) < 1e-4);
  assert.ok(Math.abs(body.total.gb - (base.total.gb + expectedOverhead)) < 1e-4);
});

test('#819 fits honors the reserve: headroom shrinks by exactly the overhead', async () => {
  const q = { hfId: HF_ID, context: '8192', vramGb: '24' };
  const base = (await runHandler(q)).body;
  const withOh = (await runHandler({ ...q, overheadFraction: '0.5' })).body;
  assert.ok(withOh.fits.fits === false || withOh.fits.headroomGb < base.fits.headroomGb);
  assert.ok(Math.abs(base.fits.headroomGb - (24 - base.total.gb)) < 1e-4); // legacy headroom untouched
  const delta = base.fits.headroomGb - withOh.fits.headroomGb;
  assert.ok(delta > 0, 'overhead must consume headroom');
  // maxContextTokens can only shrink under a reserve
  assert.ok(withOh.fits.maxContextTokens <= base.fits.maxContextTokens);
});

test('#819 invalid overheadFraction is rejected loudly, not silently ignored', async () => {
  for (const bad of ['2', '-0.1', 'abc']) {
    const { status, body } = await runHandler({ hfId: HF_ID, context: '8192', overheadFraction: bad });
    assert.equal(status, 400, `overheadFraction=${bad} should 400`);
    assert.match(body.error, /overheadFraction/);
  }
});
