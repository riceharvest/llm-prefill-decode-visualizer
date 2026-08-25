// Partial batch failure recovery (#964).
//
// Covers the four recovery blockers from issue #964:
//   1. failed items echo their input + a stable per-item id
//   2. subset retries correlate via per-item ids and an optional caller
//      supplied batchId that pins the top-level id (no reindex-into-new-id)
//   3. /api/calc/<batch-success-id> resolves instead of dead-ending
//   4. ApiError.extras (available[]) survive onto failed item entries
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeCalcId } from './_calc_id.js';
import { computeBody } from './_handlers/compute.js';
import calcHandler from './_handlers/calc_id.js';

function mockRes() {
  return {
    statusCode: 0,
    headers: {},
    body: null,
    setHeader(k, v) { this.headers[k] = v; },
    status(c) { this.statusCode = c; return this; },
    end(b) { this.body = b ? JSON.parse(b) : null; }
  };
}

async function callCalc(pathId, query = {}) {
  const res = mockRes();
  await calcHandler({ method: 'GET', query: { ...query, id: pathId } }, res);
  return { status: res.statusCode, body: res.body };
}

const MIXED_BATCH = [
  { model: 'singleTurn', promptTokens: 4096, outputTokens: 512 },
  { model: 'bogus' },
  'not-an-object',
  { model: 'kvCache', architecture: 'llama70b', contextLength: 65536 },
  { model: 'singleTurn', promptTokens: 8192 }
];

test('failed items echo their input and carry a stable per-item id', () => {
  const { body } = computeBody({ batch: MIXED_BATCH });
  assert.equal(body.errorCount, 2);

  const badModel = body.results[1];
  assert.equal(badModel.ok, false);
  assert.equal(badModel.code, 'INVALID_PARAMS');
  assert.deepEqual(badModel.inputs, { model: 'bogus' });
  // Same hash a standalone call with these params would mint.
  assert.equal(badModel.id, computeCalcId('compute', { model: 'bogus' }));

  const nonObject = body.results[2];
  assert.equal(nonObject.ok, false);
  assert.equal(nonObject.input, 'not-an-object');
});

test('per-item ids are stable across subset retries even though indexes renumber', () => {
  const full = computeBody({ batch: MIXED_BATCH }).body;
  const retry = computeBody({ batch: [{ model: 'bogus' }, 'not-an-object'] }).body;

  assert.equal(retry.results[0].index, 0); // renumbered from 1…
  assert.equal(retry.results[0].id, full.results[1].id); // …but the id correlates
  assert.deepEqual(retry.results[0].inputs, { model: 'bogus' }); // echoed again
  assert.equal(retry.results[1].input, 'not-an-object');
  assert.notEqual(retry.id, full.id); // payload differs -> different batch id
});

test('a caller-supplied batchId pins the top-level id across subset retries', () => {
  const attempt1 = computeBody({ batch: MIXED_BATCH, batchId: 'run-42' }).body;
  const attempt2 = computeBody({ batch: [{ model: 'bogus' }, 'not-an-object'], batchId: 'run-42' }).body;

  assert.equal(attempt1.batchId, 'run-42');
  assert.equal(attempt2.batchId, 'run-42');
  assert.equal(attempt2.id, attempt1.id); // SAME id despite a different payload
  assert.match(attempt1.id, /^calc_[0-9a-f]{12}$/);

  // Different batchId -> different pinned id.
  const other = computeBody({ batch: MIXED_BATCH, batchId: 'run-43' }).body;
  assert.notEqual(other.id, attempt1.id);

  // Pinned id is a pure function of the batchId string.
  assert.equal(attempt1.id, computeCalcId('compute', { batchId: 'run-42' }));

  // Without batchId the id stays a content hash of the full request.
  const unpinned = computeBody({ batch: MIXED_BATCH }).body;
  assert.equal(unpinned.id, computeCalcId('compute', { batch: MIXED_BATCH }));
  assert.equal('batchId' in unpinned, false);
});

test('ApiError extras (available[]) survive onto failed item entries', () => {
  const { body } = computeBody({ batch: [{ model: 'bogus' }] });
  const entry = body.results[0];
  assert.equal(entry.ok, false);
  assert.deepEqual(entry.available, ['singleTurn', 'speculative', 'batched', 'agentic', 'kvCache', 'flagged', 'cost']);
  // Matches what the single-call problem+json exposes.
  let thrown;
  try {
    computeBody({ model: 'bogus' });
  } catch (err) {
    thrown = err;
  }
  assert.deepEqual(entry.available, thrown.extras.available);
});

test('batch ids are derived from array content, not String() coercion', () => {
  const a = computeBody({ batch: [{ model: 'singleTurn', promptTokens: 1024 }] }).body.id;
  const b = computeBody({ batch: [{ model: 'singleTurn', promptTokens: 2048 }] }).body.id;
  const c = computeBody({ batch: [{ model: 'kvCache' }, { model: 'cost' }] }).body.id;
  assert.notEqual(a, b); // different content, same length -> different ids
  assert.notEqual(a, c);
});

test('/api/calc/<batch-id>?batchId=<batchId> resolves and verifies', async () => {
  const minted = computeBody({ batch: MIXED_BATCH, batchId: 'run-42' }).body;
  const ok = await callCalc(minted.id, { batchId: 'run-42' });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.verified, true);
  assert.equal(ok.body.batchId, 'run-42');

  const mismatch = await callCalc(minted.id, { batchId: 'some-other-run' });
  assert.equal(mismatch.status, 400);
  assert.equal(mismatch.body.error, 'Calc id does not match the given parameters');
  assert.match(mismatch.body.expected, /^calc_[0-9a-f]{12}$/);
});

test('/api/calc/<batch-id> replays a full batch payload end-to-end', async () => {
  const minted = computeBody({ batch: MIXED_BATCH, batchId: 'run-99' }).body;
  const replay = await callCalc(minted.id, {
    batchId: 'run-99',
    batch: JSON.stringify(MIXED_BATCH)
  });
  assert.equal(replay.status, 200);
  assert.equal(replay.body.verified, true);
  assert.equal(replay.body.id, minted.id);
  assert.equal(replay.body.count, MIXED_BATCH.length);
  assert.equal(replay.body.errorCount, 2);
});
