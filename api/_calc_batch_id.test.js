import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeBatchId, computeCalcId, isValidCalcId } from './_calc_id.js';
import { computeBody } from './_handlers/compute.js';

// #942: the batch ENVELOPE id hashed the raw transport body. normalizeParams
// String()-coerced the items array to "[object Object]" per entry, so any two
// equal-length batches collided on one calc_ id (live: singleTurn+kvCache vs
// agentic+cost both minted calc_ecdd2705fbbf), and the GET ?batch=<string>
// spelling minted a different id than the POST {batch:[...]} array for the
// same logical batch.

const A = [{ model: 'singleTurn', promptTokens: 4096 }, { model: 'kvCache', architecture: 'llama70b', contextLength: 131072 }];
const B = [{ model: 'agentic', numTurns: 10 }, { model: 'cost', price: 2 }];

test('equal-length batches with different content get different envelope ids (#942)', () => {
  const idA = computeBatchId(A);
  const idB = computeBatchId(B);
  assert.notEqual(idA, idB);
  assert.ok(isValidCalcId(idA));
  assert.ok(isValidCalcId(idB));
});

test('GET string and POST array spellings of the same batch share one id (#942)', () => {
  const viaArray = computeBody({ batch: A }).body.id;
  const viaString = computeBody({ batch: JSON.stringify(A) }).body.id;
  assert.equal(viaArray, viaString);
});

test('envelope id is invariant to key order / numeric spellings per item', () => {
  const reordered = [{ promptTokens: '4096', model: 'singleTurn' }, { contextLength: '131072', architecture: 'llama70b', model: 'kvCache' }];
  assert.equal(computeBatchId(A), computeBatchId(reordered));
});

test('item order matters (batches are positional)', () => {
  const flipped = [A[1], A[0]];
  assert.notEqual(computeBatchId(A), computeBatchId(flipped));
});

test('per-item ids are unchanged by the envelope fix (#68 regression guard)', () => {
  const out = computeBody({ batch: [{ model: 'singleTurn', promptTokens: 4096, outputTokens: 512, prefillSpeed: 3800, decodeSpeed: 105 }] });
  const standalone = computeCalcId('compute', { model: 'singleTurn', ...{ promptTokens: 4096, outputTokens: 512, prefillSpeed: 3800, decodeSpeed: 105 } });
  assert.equal(out.body.results[0].result.id, standalone);
  // Envelope id differs from a bare item id (it covers all items).
  assert.notEqual(out.body.id, out.body.results[0].result.id);
});
