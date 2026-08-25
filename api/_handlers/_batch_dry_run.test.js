// #562 — per-item dry_run inside POST /api/compute batch must be honored:
// llms.txt documents that dry-run "also applies per-item inside a batch"
// (validate + echo, never execute). Previously the item-level flag was
// silently ignored and the math executed anyway.
//
// Run: node --test api/_handlers/_batch_dry_run.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeBody } from '../_handlers/compute.js';

test('#562 per-item dry_run:true validates without executing the math', () => {
  const { status, body } = computeBody({
    batch: [
      { model: 'singleTurn', promptTokens: 10, dry_run: true },
      { model: 'singleTurn', promptTokens: 20 }
    ]
  });
  assert.equal(status, 200);
  assert.equal(body.okCount, 2);

  const dry = body.results[0].result;
  assert.equal(dry.dry_run, true, 'item with dry_run:true must be a dry-run echo');
  assert.ok(dry.note, 'dry-run echo carries the explanatory note');
  assert.deepEqual(dry.inputs.promptTokens, 10);
  assert.equal(dry.totalWalltimeSeconds, undefined, 'dry-run item must not carry executed metrics');
  assert.equal(dry.ttftSeconds, undefined, 'dry-run item must not carry executed metrics');

  const executed = body.results[1].result;
  assert.equal(executed.dry_run, undefined, 'sibling without the flag still executes');
  assert.equal(typeof executed.totalWalltimeSeconds, 'number');
});

test('#562 camelCase per-item dryRun alias is honored too', () => {
  const { body } = computeBody({
    batch: [{ model: 'kvCache', architecture: 'llama70b', contextLength: 131072, dryRun: true }]
  });
  assert.equal(body.okCount, 1);
  assert.equal(body.results[0].result.dry_run, true);
});

test('#562 batch-level dry_run still applies to every item (unchanged)', () => {
  const { body } = computeBody({
    dry_run: true,
    batch: [
      { model: 'singleTurn', promptTokens: 10 },
      { model: 'singleTurn', promptTokens: 20 }
    ]
  });
  assert.equal(body.okCount, 2);
  assert.ok(body.results.every(r => r.result.dry_run === true));
});
