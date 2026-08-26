import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildBestQuery, hasActiveConstraints } from './shortlistQuery.js';

test('#771 pushes workload constraints server-side onto /api/best', () => {
  const q = buildBestQuery({ model: 'qwen', minDecode: '40', maxVram: '8', quant: 'Q4_K_M' });
  assert.equal(q.get('by'), 'decode');
  assert.equal(q.get('limit'), '50');
  assert.equal(q.get('model'), 'qwen');
  assert.equal(q.get('minDecode'), '40');
  assert.equal(q.get('maxVramGb'), '8');
  assert.equal(q.get('quant'), 'Q4_K_M');
});

test('#771 empty constraints produce the bare baseline query', () => {
  const q = buildBestQuery({});
  assert.equal(q.toString(), 'by=decode&limit=50');
  // Zero/garbage values must not leak as filters either.
  const junk = buildBestQuery({ minDecode: '0', maxVram: '-3' });
  assert.equal(junk.toString(), 'by=decode&limit=50');
});

test('#771 hasActiveConstraints tracks whether any filter is live', () => {
  assert.equal(hasActiveConstraints({}), false);
  assert.equal(hasActiveConstraints({ maxVram: '8' }), true);
  assert.equal(hasActiveConstraints({ quant: 'FP8' }), true);
});
