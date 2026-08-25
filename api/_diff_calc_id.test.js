// #502 — /api/diff results carry a deterministic content-hash id and a replay
// path via /api/calc/<id>?endpoint=diff&runA=…&runB=…, matching the documented
// compute/best citation pattern. Offline: getAllRuns is fed through its cache.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { diffRunsBody } from './_handlers/diff.js';
import { computeCalcId, isValidCalcId } from './_calc_id.js';
import calcHandler from './_handlers/calc_id.js';

import { invalidateCache } from './_localmaxxing.js';
import { computeRunDiff } from './_diff.js';

const RUN_A = {
  runId: 'cmsxtestaaaaaaaaaaaaaaaaaa1', hardwareKey: 'gpu|rtx4090|1', hardware: 'RTX 4090',
  modelFamily: 'llama-3', modelId: 'org/llama-3', quantization: 'Q4_K_M', engine: 'llama.cpp',
  promptTokPerSec: 3000, prefillTokPerSec: 3000, decodeTokPerSec: 100,
  contextTokens: 8192, createdAt: '2026-08-01T00:00:00Z',
  source: `https://localmaxxing.com/en/runs/cmsxtestaaaaaaaaaaaaaaaaaa1`
};
const RUN_B = {
  ...RUN_A,
  runId: 'cmsxtestbbbbbbbbbbbbbbbbbb2', hardware: 'RTX 5090',
  prefillTokPerSec: 6000, decodeTokPerSec: 200,
  source: `https://localmaxxing.com/en/runs/cmsxtestbbbbbbbbbbbbbbbbbb2`
};

// Raw upstream rows (pre-slim) that map onto RUN_A/RUN_B through getDataset().
function rawRow(run) {
  return {
    id: run.runId,
    createdAt: run.createdAt,
    model: { hfId: run.modelId, displayName: 'Llama 3', params: 8 },
    hardwareGroupKey: run.hardwareKey,
    hardwareGroupLabel: run.hardware,
    hardware: { hwClass: 'DISCRETE_GPU', gpuName: run.hardware, gpuCount: 1, vramGb: 24 },
    engine: { engineName: run.engine, quantization: run.quantization },
    tokSPrefill: run.prefillTokPerSec,
    tokSOut: run.decodeTokPerSec,
    promptTokens: 2048,
    outputTokens: 512,
    contextLength: run.contextTokens,
    batchSize: 1
  };
}

/** Point the dataset crawl at an in-memory two-run leaderboard (offline). */
async function prime(t) {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
    invalidateCache();
  });
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({ rows: [rawRow(RUN_A), rawRow(RUN_B)] }) // single short page ends pagination
  });
  invalidateCache();
}

function jsonRes() {
  const captured = {};
  return {
    res: {
      statusCode: 0,
      headers: {},
      setHeader(k, v) { this.headers[String(k).toLowerCase()] = v; },
      getHeader(k) { return this.headers[String(k).toLowerCase()]; },
      end(body) { captured.status = this.statusCode; captured.rawBody = body; }
    },
    captured
  };
}

test('diff mints a deterministic calc-style id derived only from the run pair', async t => {
  await prime(t);
  const a = await diffRunsBody({ runA: RUN_A.runId, runB: RUN_B.runId });
  const b = await diffRunsBody({ runA: RUN_A.runId, runB: RUN_B.runId });
  assert.equal(a.status, 200);
  assert.ok(isValidCalcId(a.body.id), `id '${a.body.id}' is not calc_<12hex>`);
  assert.equal(a.body.id, b.body.id);
  // Pure function of the id pair:
  assert.equal(a.body.id, computeCalcId('diff', { runA: RUN_A.runId, runB: RUN_B.runId }));
});

test('a=/b= aliases mint the SAME id as runA/runB', async t => {
  await prime(t);
  const alias = await diffRunsBody({ a: RUN_A.runId, b: RUN_B.runId });
  const plain = await diffRunsBody({ runA: RUN_A.runId, runB: RUN_B.runId });
  assert.equal(alias.body.id, plain.body.id);
});

test('response advertises its replay path (#502)', async t => {
  await prime(t);
  const r = await diffRunsBody({ runA: RUN_A.runId, runB: RUN_B.runId });
  assert.equal(
    r.body.replay,
    `/api/calc/${r.body.id}?endpoint=diff&runA=${encodeURIComponent(RUN_A.runId)}&runB=${encodeURIComponent(RUN_B.runId)}`
  );
});

test('diff payload stays deterministic modulo the new id/replay fields', async t => {
  await prime(t);
  const r1 = await diffRunsBody({ runA: RUN_A.runId, runB: RUN_B.runId });
  const r2 = await diffRunsBody({ runA: RUN_A.runId, runB: RUN_B.runId });
  const strip = b => JSON.stringify({ ...b, id: undefined, replay: undefined }, Object.keys(b).sort());
  assert.equal(strip(r1.body), strip(r2.body));
  // And the math itself is unchanged:
  assert.deepEqual(r1.body.diff, computeRunDiff(RUN_A, RUN_B));
});

test('/api/calc/<id>?endpoint=diff replays the comparison and verifies the hash', async t => {
  await prime(t);
  const minted = await diffRunsBody({ runA: RUN_A.runId, runB: RUN_B.runId });
  const { res, captured } = jsonRes();
  await calcHandler(
    { method: 'GET', query: { id: minted.body.id, endpoint: 'diff', runA: RUN_A.runId, runB: RUN_B.runId } },
    res
  );
  assert.equal(captured.status, 200);
  const body = JSON.parse(captured.rawBody);
  assert.equal(body.verified, true);
  assert.equal(body.id, minted.body.id);
  assert.deepEqual(body.diff, minted.body.diff);
});

test('/api/calc rejects endpoint=diff with altered params (loud failure)', async t => {
  await prime(t);
  const minted = await diffRunsBody({ runA: RUN_A.runId, runB: RUN_B.runId });
  const { res, captured } = jsonRes();
  await calcHandler(
    { method: 'GET', query: { id: minted.body.id, endpoint: 'diff', runA: RUN_A.runId, runB: 'wrong-run-id' } },
    res
  );
  // The altered pair can't resolve AND its hash wouldn't match the minted id —
  // either way the replay must fail loudly instead of silently substituting.
  assert.notEqual(captured.status, 200);
  const body = JSON.parse(captured.rawBody);
  assert.ok(body.error);
});

test('unknown endpoint values still list diff among available endpoints', async () => {
  const { res, captured } = jsonRes();
  await calcHandler(
    { method: 'GET', query: { id: 'calc_aaaabbbbcccc', endpoint: 'nope', model: 'singleTurn' } },
    res
  );
  assert.equal(captured.status, 400);
  const body = JSON.parse(captured.rawBody);
  assert.ok(body.available.includes('diff'));
});
