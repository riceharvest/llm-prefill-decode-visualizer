import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { diffMetric, derivedTimes, computeRunDiff, REF_PROMPT_TOKENS, REF_OUTPUT_TOKENS } from '../api/_diff.js';
import handler, { parseConstraintSet } from '../api/_handlers/diff.js';
import { invalidateCache } from '../api/_localmaxxing.js';

// ---------- Pure diff math ----------

test('diffMetric computes delta, deltaPct and ratio for higher-is-better', () => {
  const d = diffMetric(100, 150);
  assert.equal(d.delta, 50);
  assert.equal(d.deltaPct, 0.5);
  assert.equal(d.ratio, 1.5);
  assert.equal(d.winner, 'B');
});

test('diffMetric flips winner for lower-is-better (times)', () => {
  const d = diffMetric(2, 1, { higherIsBetter: false });
  assert.equal(d.winner, 'B'); // B is faster (smaller time)
  const back = diffMetric(1, 2, { higherIsBetter: false });
  assert.equal(back.winner, 'A');
});

test('diffMetric reports a tie on equal values', () => {
  const d = diffMetric(100, 100);
  assert.equal(d.winner, 'tie');
  assert.equal(d.delta, 0);
  assert.equal(d.deltaPct, 0);
  assert.equal(d.ratio, 1);
});

test('diffMetric guards division by zero and non-numeric input', () => {
  const zero = diffMetric(0, 50);
  assert.equal(zero.ratio, null);
  assert.equal(zero.deltaPct, null);
  assert.equal(zero.winner, 'B');

  const bad = diffMetric(undefined, 50);
  assert.equal(bad.ratio, null);
  assert.equal(bad.winner, null);
});

test('derivedTimes converts speeds to reference-workload seconds', () => {
  const t = derivedTimes({ prefillTokPerSec: 2048, decodeTokPerSec: 512 });
  assert.equal(t.ttftSeconds, 1); // 2048 / 2048
  assert.equal(t.tpotSeconds, round8(1 / 512));
  assert.equal(t.walltimeSeconds, round8(1 + REF_OUTPUT_TOKENS / 512));
  // constants actually used
  assert.equal(REF_PROMPT_TOKENS, 2048);
  assert.equal(REF_OUTPUT_TOKENS, 512);
});

const round8 = x => Math.round(x * 10 ** 8) / 10 ** 8;

test('computeRunDiff produces full metric set with consistent winners', () => {
  const runA = {
    runId: 1, hardwareKey: 'rtx4090', hardware: 'RTX 4090',
    modelFamily: 'llama-3-8b', quantization: 'q4_k_m',
    prefillTokPerSec: 4000, decodeTokPerSec: 100
  };
  const runB = {
    runId: 2, hardwareKey: 'm3max', hardware: 'M3 Max',
    modelFamily: 'llama-3-8b', quantization: 'q4_k_m',
    prefillTokPerSec: 2000, decodeTokPerSec: 50
  };
  const { context, metrics, summary } = computeRunDiff(runA, runB);

  assert.equal(context.sameModelFamily, true);
  assert.equal(context.sameHardware, false);

  assert.equal(metrics.decode.winner, 'A');
  assert.equal(metrics.decode.ratio, 0.5); // B is half of A
  assert.equal(metrics.prefill.winner, 'A');
  assert.equal(metrics.prefill.delta, -2000);
  // A is twice as fast everywhere → A also wins every time metric
  assert.equal(metrics.ttft.winner, 'A');
  assert.equal(metrics.tpot.winner, 'A');
  assert.equal(metrics.walltime.winner, 'A');

  assert.match(summary, /RTX 4090 decodes 2× faster than M3 Max/);
  assert.match(summary, /RTX 4090 is 2× faster overall/);
  assert.ok(!summary.includes('different model families'));
});

test('computeRunDiff flags mismatched model families in the summary', () => {
  const base = { prefillTokPerSec: 3000, decodeTokPerSec: 80, hardwareKey: 'x', quantization: 'q4_k_m' };
  const { summary } = computeRunDiff(
    { ...base, modelFamily: 'llama-3-8b' },
    { ...base, modelFamily: 'gemma-4-12b' }
  );
  assert.match(summary, /different model families \(llama-3-8b vs gemma-4-12b\)/);
});

// ---------- #561: sub-millisecond time precision ----------

test('#561 fast runs keep numeric tpot deltaPct/ratio and a raw-value winner', () => {
  // Real-world fast pair: both TPOTs far below the old 0.1 ms rounding
  // quantum (4 decimals of a second), which quantized side A to literal 0.
  const runA = {
    runId: 1, hardwareKey: 'fast-a', hardware: 'Fast A', modelFamily: 'm',
    quantization: 'f16', prefillTokPerSec: 30000, decodeTokPerSec: 36700
  };
  const runB = {
    runId: 2, hardwareKey: 'fast-b', hardware: 'Fast B', modelFamily: 'm',
    quantization: 'f16', prefillTokPerSec: 28000, decodeTokPerSec: 16700
  };
  const { metrics } = computeRunDiff(runA, runB);

  assert.ok(metrics.tpot.a > 0, 'tpot.a must not round down to literal 0');
  assert.equal(typeof metrics.tpot.deltaPct, 'number');
  assert.equal(typeof metrics.tpot.ratio, 'number');
  assert.equal(metrics.tpot.winner, 'A'); // A decodes faster → smaller time
  assert.ok(Math.abs(metrics.tpot.ratio - runA.decodeTokPerSec / runB.decodeTokPerSec) < 1e-3);
  // Same guarantee for the other time metrics on this fast pair.
  for (const key of ['ttft', 'walltime']) {
    assert.ok(metrics[key].a > 0);
    assert.equal(typeof metrics[key].deltaPct, 'number');
    assert.equal(typeof metrics[key].ratio, 'number');
  }
});

test('#561 derivedTimes keeps 8-decimal (~10 ns) precision instead of 0.1 ms', () => {
  const t = derivedTimes({ prefillTokPerSec: 30000, decodeTokPerSec: 36700 });
  assert.equal(t.tpotSeconds, Math.round((1 / 36700) * 1e8) / 1e8);
  assert.ok(t.tpotSeconds < 0.0001); // sub-0.1 ms value survives unrounded
});

// ---------- Handler (with mocked upstream) ----------

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

async function call(query) {
  const res = mockRes();
  await handler({ method: 'GET', query }, res);
  return { status: res.statusCode, json: JSON.parse(res.body) };
}

function upstreamRow(id, overrides = {}) {
  return {
    id,
    batchSize: 1,
    engineFlags: {},
    tokSPrefill: 4000,
    tokSOut: 100,
    promptTokens: 2048,
    outputTokens: 512,
    contextLength: 8192,
    hardwareGroupKey: `rig-${id}`,
    hardwareGroupLabel: `Rig ${id}`,
    hardware: { hwClass: 'discrete_gpu', gpuName: 'GPU', gpuCount: 1, vramGb: 24 },
    engine: { engineName: 'llama.cpp', quantization: 'q4_k_m' },
    model: { hfId: 'llama-3-8b', displayName: 'Llama 3 8B', params: 8 },
    ...overrides
  };
}

beforeEach(() => {
  invalidateCache();
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({ rows: [
      upstreamRow(101),
      upstreamRow(102, { tokSOut: 200, tokSPrefill: 6000 })
    ] })
  });
});

test('handler rejects missing parameters with 400 + usage hint', async () => {
  const { status, json } = await call({});
  assert.equal(status, 400);
  assert.match(json.detail, /runA=<id>&runB=<id>/);

  const onlyOne = await call({ runA: '101' });
  assert.equal(onlyOne.status, 400);
});

test('handler rejects identical run ids with 400', async () => {
  const { status } = await call({ runA: '101', runB: '101' });
  assert.equal(status, 400);
});

test('handler returns 404 for unknown runs', async () => {
  const missA = await call({ runA: '999', runB: '101' });
  assert.equal(missA.status, 404);
  assert.match(missA.json.detail, /run 999 not found/);
  assert.equal(missA.json.code, 'NOT_FOUND');

  const missB = await call({ runA: '101', runB: '999' });
  assert.equal(missB.status, 404);
});

test('handler diffs two known runs with deltas, ratios and summary', async () => {
  const { status, json } = await call({ runA: '101', runB: '102' });
  assert.equal(status, 200);
  assert.equal(json.runA.runId, 101);
  assert.equal(json.runB.runId, 102);

  const { metrics, context, summary } = json.diff;
  assert.equal(metrics.decode.a, 100);
  assert.equal(metrics.decode.b, 200);
  assert.equal(metrics.decode.delta, 100);
  assert.equal(metrics.decode.ratio, 2);
  assert.equal(metrics.decode.winner, 'B');
  assert.equal(context.sameModelFamily, true);
  assert.match(summary, /decodes 2× faster/);
});

// ---------- What-if mode (#71): diff two decision requests ----------

test('parseConstraintSet accepts objects, JSON strings and query strings', () => {
  assert.deepEqual(parseConstraintSet({ fitCheck: 'true' }), { fitCheck: 'true' });
  assert.deepEqual(parseConstraintSet('{"contextLength":8192}'), { contextLength: 8192 });
  assert.deepEqual(parseConstraintSet('fitCheck=true&model=qwen'), { fitCheck: 'true', model: 'qwen' });
  assert.equal(parseConstraintSet(null), null);
  assert.equal(parseConstraintSet(''), null);
  assert.throws(() => parseConstraintSet('{nope'), /not valid JSON/);
});

test('whatif mode rejects missing constraint sets with 400', async () => {
  const missing = await call({ mode: 'whatif' });
  assert.equal(missing.status, 400);
  assert.match(missing.json.detail, /mode=whatif&a=<constraints>&b=<constraints>/);

  const oneSided = await call({ mode: 'whatif', a: '{"fitCheck":"true"}' });
  assert.equal(oneSided.status, 400);
});

test('whatif mode rejects malformed JSON constraint sets with 400', async () => {
  const res = await call({ mode: 'whatif', a: '{nope', b: '{}' });
  assert.equal(res.status, 400);
  assert.match(res.json.detail, /invalid constraint set|not valid JSON/);
});

test('whatif mode diffs two feasible-set queries and reports deltas', async () => {
  // A: both rigs (discrete_gpu). B: hwClass=unified → nothing survives.
  const a = 'fitCheck=true&contextLength=8192';
  const b = 'fitCheck=true&contextLength=8192&hwClass=unified';
  const { status, json } = await call({ mode: 'whatif', a, b });

  assert.equal(status, 200);
  assert.equal(json.mode, 'whatif');
  assert.equal(json.a.resultCount, 2);
  assert.equal(json.b.resultCount, 0);
  assert.deepEqual(json.delta.counts, { aOnly: 2, bOnly: 0, shared: 0 });
  assert.equal(json.delta.left.length, 2);
  assert.equal(json.delta.entered.length, 0);
  assert.ok(json.delta.left.every(o => o.hardwareKey.startsWith('rig-')));
  assert.match(json.delta.summary, /2 option\(s\) leave/);
});

test('whatif mode reports headroom deltas when both sides share options', async () => {
  const ctx = n => `fitCheck=true&contextLength=${n}`;
  const { status, json } = await call({ mode: 'whatif', a: ctx(8192), b: ctx(65536) });

  assert.equal(status, 200);
  assert.equal(json.delta.counts.shared, 2);
  assert.equal(json.delta.entered.length, 0);
  assert.equal(json.delta.left.length, 0);

  // Longer context → KV cache grows → headroom must not increase.
  for (const h of json.delta.headroom) {
    assert.equal(typeof h.headroomGbA, 'number');
    assert.equal(typeof h.headroomGbB, 'number');
    assert.equal(h.fitsA, true);
    assert.equal(h.fitsB, true);
  }
});

test('whatif mode treats identical constraint sets as zero-delta', async () => {
  const same = 'fitCheck=true&contextLength=8192';
  const { status, json } = await call({ mode: 'whatif', a: same, b: same });
  assert.equal(status, 200);
  assert.match(json.delta.summary, /no what-if deltas/);
});

test('whatif mode accepts POST with a JSON body', async () => {
  const res = mockRes();
  await handler({
    method: 'POST',
    query: {},
    body: {
      mode: 'whatif',
      a: { fitCheck: 'true', contextLength: 8192 },
      b: { fitCheck: 'true', contextLength: 8192, hwClass: 'unified' }
    }
  }, res);
  const out = JSON.parse(res.body);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(out.delta.counts, { aOnly: 2, bOnly: 0, shared: 0 });
});
