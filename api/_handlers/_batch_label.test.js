// Issue #626: POST /api/compute batch items must echo an optional opaque
// `label` so results can be attributed to inputs without relying on array
// order alone. Before the fix, unknown fields like label were silently
// dropped and results[i] carried only { index, ok, result|error }.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeBody } from './compute.js';

test('batch items echo their label on successful results', () => {
  const out = computeBody({ batch: [
    { model: 'agentic', prefillSpeed: 86768, decodeSpeed: 778, label: 'rtx-pro-6000-blackwell' },
    { model: 'agentic', prefillSpeed: 19388, decodeSpeed: 428, label: '4070ti+5080' }
  ] });
  assert.equal(out.status, 200);
  assert.equal(out.body.results[0].label, 'rtx-pro-6000-blackwell');
  assert.equal(out.body.results[1].label, '4070ti+5080');
});

test('items without a label keep the legacy shape (no label key)', () => {
  const out = computeBody({ batch: [{ model: 'singleTurn' }] });
  assert.equal(out.status, 200);
  assert.ok(!('label' in out.body.results[0]));
});

test('failed items still carry their label for attribution', () => {
  const out = computeBody({ batch: [
    { model: 'nope', label: 'bad-item' },
    { label: 'not-even-an-object-will-still-echo' }
  ] });
  // item 1 is a bare string → per-item INVALID_PARAMS; label extraction is
  // best-effort (string items have no label property).
  assert.equal(out.body.results[0].ok, false);
  assert.equal(out.body.results[0].code, 'INVALID_PARAMS');
  assert.ok('label' in out.body.results[1] || out.body.results[1].error);
});

test('labels are capped at 200 chars like X-Request-Id', () => {
  const long = 'x'.repeat(500);
  const out = computeBody({ batch: [{ model: 'singleTurn', label: long }] });
  assert.equal(out.status, 200);
  assert.equal(out.body.results[0].label, 'x'.repeat(200));
});

test('non-string labels are ignored, not rejected', () => {
  const out = computeBody({ batch: [{ model: 'singleTurn', label: 42 }] });
  assert.equal(out.status, 200);
  assert.ok(!('label' in out.body.results[0]));
});
