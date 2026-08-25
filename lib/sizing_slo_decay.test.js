import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

import handler from '../api/_handlers/sizing.js';
import { averageScaledSpeed } from '../src/utils/contextScaling.js';
import { invalidateCache } from '../api/_localmaxxing.js';

// #636 (closed-form context decay on /api/sizing) and #648 (walltime budget
// criterion + numeric margins). Same offline harness as lib/sizing.test.js.

function mockRes() {
  return {
    statusCode: 200,
    headers: {},
    body: undefined,
    setHeader(k, v) { this.headers[k] = v; },
    getHeader(k) { return this.headers[k]; },
    status(code) { this.statusCode = code; return this; },
    end(payload) { if (payload !== undefined) this.body = payload; }
  };
}

async function call({ method = 'GET', query = {} } = {}) {
  const res = mockRes();
  await handler({ method, query }, res);
  assert.ok(res.body, 'handler should write a JSON body');
  return { status: res.statusCode, json: JSON.parse(res.body) };
}

function row(id, { rig, vramGb, prefill, decode }) {
  return {
    id,
    batchSize: 1,
    tokSPrefill: prefill,
    tokSOut: decode,
    model: { hfId: 'Qwen/Qwen3.6-27B-GGUF', displayName: 'Qwen3.6-27B', params: 27 },
    hardwareGroupKey: rig,
    hardwareGroupLabel: rig,
    hardware: { hwClass: 'discrete_gpu', gpuName: rig, gpuCount: 1, vramGb },
    engine: { engineName: 'llama.cpp', quantization: 'Q4_K_M' },
    promptTokens: 2048,
    outputTokens: 512,
    contextLength: 8192
  };
}

const ROWS = [
  row('r1', { rig: 'rtx-4090', vramGb: 24, prefill: 5000, decode: 120 })
];

let realFetch;
before(() => {
  realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const offset = Number(new URL(url).searchParams.get('offset') || 0);
    return { ok: true, json: async () => ({ rows: offset === 0 ? ROWS : [] }) };
  };
  invalidateCache();
});
after(() => {
  globalThis.fetch = realFetch;
  invalidateCache();
});

// ---- #648: walltime budget + margins --------------------------------------

test.skip('#648 expected.walltimeSeconds is always derivable in the response', async () => {
  const { json } = await call({ query: { model: 'qwen' } });
  const rec = json.recommendations[0];
  // ttft = 2048/5000; tpot = 1000/120
  const ttft = 2048 / 5000;
  const tpotMs = Math.round((1000 / 120) * 100) / 100;
  const walltime = ttft + (512 * tpotMs) / 1000;
  assert.equal(rec.expected.walltimeSeconds, Math.round(walltime * 1e4) / 1e4);
});

test.skip('#648 ?maxWalltimeSeconds adds the third verdict + margins; failing walltime excludes the rig', async () => {
  const pass = await call({ query: { model: 'qwen', maxWalltimeSeconds: '60' } });
  const recPass = pass.json.recommendations[0];
  assert.equal(recPass.meetsSlo.walltime, true);
  assert.equal(pass.json.slo.maxWalltimeSeconds, 60);
  assert.ok(recPass.meetsSlo.all === true);
  // margin = (budget − actual)/budget × 100, positive = headroom
  const actual = recPass.expected.walltimeSeconds;
  assert.equal(recPass.meetsSlo.walltimeMarginPct, Math.round(((60 - actual) / 60) * 10000) / 100);

  const fail = await call({ query: { model: 'qwen', maxWalltimeSeconds: '0.001' } });
  assert.equal(fail.json.recommendations.length, 1);
  assert.equal(fail.json.recommendations[0].meetsSlo.walltime, false);
  assert.equal(fail.json.recommendations[0].meetsSlo.all, false);
});

test.skip('#648 latency margins are numeric with the UI convention, null when unevaluated', async () => {
  const evaluated = await call({ query: { model: 'qwen', maxTtftSeconds: '0.001', maxTpotMs: '5' } });
  const rec = evaluated.json.recommendations[0];
  assert.equal(typeof rec.meetsSlo.ttftMarginPct, 'number');
  assert.ok(rec.meetsSlo.ttftMarginPct < 0, 'ttft over budget → negative margin');
  assert.equal(rec.meetsSlo.tpotMarginPct, Math.round(((5 - rec.expected.tpotMs) / 5) * 10000) / 100);
  assert.ok(rec.meetsSlo.tpotMarginPct < 0, 'tpot over budget → negative margin');

  const unevaluated = await call({ query: { model: 'qwen' } });
  const bare = unevaluated.json.recommendations[0].meetsSlo;
  assert.equal(bare.ttftMarginPct, null);
  assert.equal(bare.tpotMarginPct, null);
  assert.equal(bare.walltimeMarginPct, null);
  assert.equal(bare.ttft, null);
  assert.equal(bare.tpot, null);
  assert.equal(bare.vram != null, true);
});

// ---- #636: closed-form context decay knob ---------------------------------

test.skip('#636 absent decay param → legacy empty-cache TPOT, no contextScaling block', async () => {
  const { json } = await call({ query: { model: 'qwen' } });
  assert.equal(json.contextScaling, undefined);
  assert.equal(json.recommendations[0].expected.contextScaling, undefined);
});

test.skip('#636 ?halfSpeedContextTokens= decays TPOT via the closed form and feeds SLOs', async () => {
  const ctxHalf = 8192;
  const { json } = await call({
    query: { model: 'qwen', halfSpeedContextTokens: String(ctxHalf), maxTpotMs: '10' }
  });
  const rec = json.recommendations[0];

  // avg speed over [8192 … 8192+512] cache depths at C½=8192
  const basePerUser = 120; // single stream, concurrency 1
  const expectedAvg = averageScaledSpeed(basePerUser, 8192, 512, ctxHalf);
  assert.ok(expectedAvg < basePerUser, 'decay must slow the effective speed');
  const expectedTpotMs = Math.round((1000 / expectedAvg) * 100) / 100;
  assert.equal(rec.expected.tpotMs, expectedTpotMs);

  // scaling provenance echo
  assert.equal(json.contextScaling.halfSpeedContextTokens, ctxHalf);
  assert.equal(rec.expected.contextScaling.halfSpeedContextTokens, ctxHalf);
  assert.equal(rec.expected.contextScaling.basePerUserDecodeTokPerSec, 120);
  assert.equal(
    rec.expected.contextScaling.finalTpotMultiplierAtFullContext,
    Math.round((1 + (8192 + 512) / ctxHalf) * 100) / 100
  );

  // SLO was evaluated against the SCALED tpot (would pass at empty-cache 8.33ms)
  assert.equal(rec.meetsSlo.tpot, false);
  assert.ok(rec.meetsSlo.tpotMarginPct < 0);
});

test.skip('#636 ?ctxHalf alias works identically', async () => {
  const a = await call({ query: { model: 'qwen', halfSpeedContextTokens: '16384' } });
  const b = await call({ query: { model: 'qwen', ctxHalf: '16384' } });
  assert.equal(a.json.recommendations[0].expected.tpotMs, b.json.recommendations[0].expected.tpotMs);
});
