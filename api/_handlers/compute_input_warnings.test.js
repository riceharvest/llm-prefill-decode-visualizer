// Issue #385 — /api/compute silently ignored present-but-invalid numeric
// params (negative, 0 handled elsewhere; non-numeric values here) and echoed
// default-substituted inputs with warnings:[]. The handler now records every
// substitution and surfaces it as a machine-readable warning on the real
// response AND the dry_run echo. Valid calls stay byte-identical.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeBody } from './compute.js';

const CODE = 'input_not_numeric_default_used';

test('non-numeric promptTokens emits a machine-readable substitution warning', () => {
  const { status, body } = computeBody({ model: 'singleTurn', promptTokens: 'abc' });
  assert.equal(status, 200);
  const w = body.warnings.find(x => x.code === CODE);
  assert.ok(w, 'expected an input_not_numeric_default_used warning');
  assert.equal(w.param, 'promptTokens');
  assert.equal(w.requested, 'abc');
  assert.equal(w.used, 2048);
  assert.match(w.message, /promptTokens=abc/);
  // The math still ran on the substituted default — but now it says so.
  assert.equal(body.inputs.promptTokens, 2048);
});

test('multiple invalid params produce one warning each, defaults preserved', () => {
  const { body } = computeBody({
    model: 'batched',
    promptTokens: 'oops',
    decodeSpeed: '',
    batchSize: '16'
  });
  const warns = body.warnings.filter(w => w.code === CODE);
  // '' (empty string) counts as "param not provided" by trackNum, so only
  // promptTokens should warn.
  assert.deepEqual(warns.map(w => w.param), ['promptTokens']);
  assert.equal(body.inputs.batchSize, 16);
});

test('valid numeric strings never warn and responses keep their shape', () => {
  const { body } = computeBody({
    model: 'singleTurn',
    promptTokens: '4096',
    outputTokens: '512',
    prefillSpeed: '3800',
    decodeSpeed: '105'
  });
  assert.equal(body.warnings.filter(w => w.code === CODE).length, 0);
  assert.equal(body.inputs.promptTokens, 4096);
  // Physics warnings still flow through untouched.
  assert.ok(Array.isArray(body.warnings));
});

test('dry_run echo carries the same substitution warnings as the real call', () => {
  const dry = computeBody({ model: 'agentic', numTurns: 'four', dry_run: true });
  assert.equal(dry.status, 200);
  assert.equal(dry.body.dry_run, true);
  const w = dry.body.warnings?.find?.(x => x.code === CODE);
  assert.ok(w, 'dry_run echo should carry the substitution warning');
  assert.equal(w.param, 'numTurns');
  assert.equal(w.used, 4);
});

test('cost mode flags a non-numeric price instead of silently computing $0', () => {
  const { body } = computeBody({ model: 'cost', hardwarePriceUsd: 'lots' });
  const w = body.warnings.find(x => x.code === CODE);
  assert.ok(w);
  assert.equal(w.param, 'hardwarePriceUsd');
  assert.equal(w.used, 0);
});

test('batch items get their own per-item substitution warnings', () => {
  const { body } = computeBody({
    batch: [
      { model: 'singleTurn', promptTokens: 'xyz' },
      { model: 'singleTurn', promptTokens: 1024 }
    ]
  });
  assert.equal(body.results[0].ok, true);
  assert.ok(body.results[0].result.warnings.some(w => w.code === CODE && w.param === 'promptTokens'));
  assert.equal(body.results[1].result.warnings.filter(w => w.code === CODE).length, 0);
});

test('capability list documents the new warning code', () => {
  const { body } = computeBody({});
  assert.ok(body.sanity.codes.includes(CODE));
  assert.match(body.sanity.description, /input_not_numeric_default_used/);
});
