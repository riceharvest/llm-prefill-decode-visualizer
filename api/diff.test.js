import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { diffMetric, derivedTimes, computeRunDiff, REF_PROMPT_TOKENS, REF_OUTPUT_TOKENS } from './_diff.js';
import handler from './diff.js';
import { invalidateCache } from './_localmaxxing.js';

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
  assert.equal(t.tpotSeconds, round4(1 / 512));
  assert.equal(t.walltimeSeconds, round4(1 + REF_OUTPUT_TOKENS / 512));
  // constants actually used
  assert.equal(REF_PROMPT_TOKENS, 2048);
  assert.equal(REF_OUTPUT_TOKENS, 512);
});

const round4 = x => Math.round(x * 10 ** 4) / 10 ** 4;

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
  assert.match(missA.json.error, /run 999 not found/);

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
