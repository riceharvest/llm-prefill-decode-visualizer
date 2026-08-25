// #560: /api/diff carries optional SLO budget evaluation (sloTtftMs /
// sloTpotMs / sloWalltimeSec) so agents get the same ✓/✗ verdicts the UI
// badges show, without reimplementing the margin math.
//
// Run: node --test api/_diff_slo.test.js

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

// Mock the upstream leaderboard BEFORE imports so nothing hits the network.
function row(id, rig, prefill, decode) {
  return {
    id, batchSize: 1,
    tokSPrefill: prefill, tokSOut: decode,
    model: { hfId: 'meta-llama/Llama-3.1-8B-Instruct', displayName: 'Llama 3.1 8B', params: 8 },
    hardwareGroupKey: rig, hardwareGroupLabel: rig.toUpperCase(),
    hardware: { hwClass: 'discrete_gpu', gpuName: `GPU ${rig}`, gpuCount: 1, vramGb: 24 },
    engine: { engineName: 'llama.cpp', quantization: 'q4_k_m' }
  };
}
const ROWS = [row('a1', 'riga', 4000, 100), row('a2', 'rigb', 2000, 50)];

let realFetch;
beforeEach(() => {
  realFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ rows: ROWS }) });
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

const { evaluateDiffSlo } = await import('./_diff.js');
const { invalidateCache } = await import('./_localmaxxing.js');
const diffHandler = (await import('./_handlers/diff.js')).default;

beforeEach(() => {
  invalidateCache();
});

// ---------- pure evaluator ----------

test('evaluateDiffSlo returns per-side checks with the UI margin convention', () => {
  const runA = { prefillTokPerSec: 4000, decodeTokPerSec: 100 }; // ttft 512ms, tpot 10ms, wall ~5.632s
  const runB = { prefillTokPerSec: 2000, decodeTokPerSec: 50 };  // ttft 1024ms, tpot 20ms, wall ~11.264s
  const slo = evaluateDiffSlo(runA, runB, { ttftMs: 600, tpotMs: 50, walltimeSec: 10 });

  assert.equal(slo.budgets.ttftMs, 600);
  assert.equal(slo.passA, true);
  assert.equal(slo.passB, false);
  assert.equal(slo.a.ttft.pass, true);
  assert.equal(slo.b.ttft.pass, false);
  // marginPct = (budget − actual) ÷ budget × 100
  assert.equal(slo.a.ttft.marginPct > 0, true);
  assert.equal(slo.b.ttft.marginPct < 0, true);
  assert.ok(typeof slo.a.walltime.value === 'number');
});

test('evaluateDiffSlo disables missing budgets and null-passes empty evaluations', () => {
  const run = { prefillTokPerSec: 4000, decodeTokPerSec: 100 };
  const onlyTtft = evaluateDiffSlo(run, run, { ttftMs: 600 });
  assert.equal(onlyTtft.budgets.tpotMs, null);
  assert.equal(onlyTtft.a.tpot, null);
  assert.equal(onlyTtft.a.walltime, null);
  assert.equal(onlyTtft.passA, true);

  const none = evaluateDiffSlo(run, run, {});
  assert.equal(none.passA, null);
  assert.equal(none.passB, null);

  // Invalid budget spellings are treated as disabled by the pure layer.
  const junk = evaluateDiffSlo(run, run, { ttftMs: '-5', tpotMs: 'abc' });
  assert.equal(junk.budgets.ttftMs, null);
  assert.equal(junk.budgets.tpotMs, null);
});

// ---------- handler wiring ----------

function mockRes() {
  const headers = new Map();
  let statusCode = 200;
  let endedBody = null;
  return {
    get statusCode() { return statusCode; },
    set statusCode(v) { statusCode = v; },
    setHeader(k, v) { headers.set(k.toLowerCase(), v); },
    getHeader(k) { return headers.get(String(k).toLowerCase()); },
    end(body) { endedBody = body ?? ''; },
    get parsed() { try { return JSON.parse(endedBody); } catch { return null; } }
  };
}

test('GET /api/diff?slo…= attaches a slo block; absent budgets → no slo key', async () => {
  const withSlo = mockRes();
  await diffHandler({ method: 'GET', query: { runA: 'a1', runB: 'a2', sloTtftMs: '600', sloWalltimeSec: '10' } }, withSlo);
  assert.equal(withSlo.statusCode, 200);
  assert.equal(withSlo.parsed.diff.metrics.decode.winner, 'A');
  assert.ok(withSlo.parsed.slo, 'slo block must be present when budgets are passed');
  assert.equal(withSlo.parsed.slo.passA, true);
  assert.equal(withSlo.parsed.slo.passB, false);
  assert.equal(withSlo.parsed.slo.budgets.ttftMs, 600);
  assert.equal(withSlo.parsed.slo.a.tpot, null, 'tpot budget not given → check disabled');

  const withoutSlo = mockRes();
  await diffHandler({ method: 'GET', query: { runA: 'a1', runB: 'a2' } }, withoutSlo);
  assert.equal(withoutSlo.statusCode, 200);
  assert.equal(withoutSlo.parsed.slo, undefined, 'no budgets → response unchanged');
});

test('present-but-invalid SLO budgets fail loudly with 400', async () => {
  const res = mockRes();
  await diffHandler({ method: 'GET', query: { runA: 'a1', runB: 'a2', sloTpotMs: 'fast' } }, res);
  assert.equal(res.statusCode, 400);
  assert.match(res.parsed.error, /invalid SLO budget sloTpotMs/);

  const res2 = mockRes();
  await diffHandler({ method: 'GET', query: { runA: 'a1', runB: 'a2', sloTtftMs: '-3' } }, res2);
  assert.equal(res2.statusCode, 400);
});
