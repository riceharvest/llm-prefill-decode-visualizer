// #742 — implicit workload defaults surfaced on /api/compute: batched
// defaults promptTokens=4096 while singleTurn/flagged/cost default 2048.
// When promptTokens is omitted the response must say so via assumedDefaults,
// so cross-model comparisons aren't apples-to-oranges silently.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeBody, PROMPT_TOKEN_DEFAULTS, withAssumedDefaults } from './_handlers/compute.js';

test('batched call without promptTokens reports the 4096 default (#742)', () => {
  const { status, body } = computeBody({ model: 'batched', batchSize: 16 });
  assert.equal(status, 200);
  assert.equal(body.assumedDefaults.promptTokens, 4096);
});

test('singleTurn call without promptTokens reports the 2048 default', () => {
  const { status, body } = computeBody({ model: 'singleTurn' });
  assert.equal(status, 200);
  assert.equal(body.assumedDefaults.promptTokens, 2048);
});

test('explicit promptTokens omits assumedDefaults (no noise)', () => {
  const { body } = computeBody({ model: 'batched', batchSize: 16, promptTokens: 1024 });
  assert.equal(body.assumedDefaults, undefined);
  const st = computeBody({ model: 'singleTurn', promptTokens: '4096' });
  assert.equal(st.body.assumedDefaults, undefined);
});

test('empty-string promptTokens counts as omitted (query-param shape)', () => {
  const { body } = computeBody({ model: 'batched', promptTokens: '' });
  assert.equal(body.assumedDefaults.promptTokens, 4096);
});

test('dry_run echoes carry the same annotation', () => {
  const { body } = computeBody({ model: 'batched', dry_run: 'true' });
  assert.equal(body.dry_run, true);
  assert.equal(body.assumedDefaults.promptTokens, 4096);
  assert.equal(body.inputs.promptTokens, 4096);
});

test('models without a promptTokens workload are untouched', () => {
  const { body } = computeBody({ model: 'kvCache', contextLength: 8192 });
  assert.equal(body.assumedDefaults, undefined);
});

test('dry_run id matches the real call for the same omitted-prompt params', () => {
  const dry = computeBody({ model: 'batched', batchSize: 4, dry_run: 'true' });
  const real = computeBody({ model: 'batched', batchSize: 4 });
  assert.equal(dry.body.id, real.body.id);
});

test('withAssumedDefaults is inert on non-200 or missing bodies', () => {
  const out = { status: 400, body: { code: 'X' } };
  assert.equal(withAssumedDefaults({ model: 'batched' }, out), out);
});
