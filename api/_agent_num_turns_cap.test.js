// Issue #749: the agentic numTurns cap must match the UI slider (1–200),
// never truncate silently, and the calc id must distinguish a clamped
// request from an in-range one so distinct intents can't collide.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeBody } from '../api/_handlers/compute.js';

test('numTurns up to 200 executes in full, matching the UI slider max', () => {
  const r = computeBody({ model: 'agentic', numTurns: 200 });
  assert.equal(r.status, 200);
  assert.equal(r.body.inputs.numTurns, 200);
  assert.equal(r.body.turns.length, 200);
  assert.equal('numTurnsRequested' in r.body.inputs, false);
  assert.deepEqual(
    r.body.warnings.filter(w => w.code === 'num_turns_clamped'),
    []
  );
});

test('numTurns above the cap clamps with an explicit warning + requested echo', () => {
  const r = computeBody({ model: 'agentic', numTurns: 250 });
  assert.equal(r.status, 200);
  assert.equal(r.body.inputs.numTurns, 200);
  assert.equal(r.body.inputs.numTurnsRequested, 250);
  const clamped = r.body.warnings.filter(w => w.code === 'num_turns_clamped');
  assert.equal(clamped.length, 1);
  assert.match(clamped[0].message, /250/);
  assert.match(clamped[0].message, /200/);
});

test('a clamped request gets a different calc id than the same effective turns', () => {
  // Pre-#749 these two collided on one id (both resolved to numTurns=50).
  const overCap = computeBody({ model: 'agentic', numTurns: 250 }).body;
  const atCap = computeBody({ model: 'agentic', numTurns: 200 }).body;
  assert.notEqual(overCap.id, atCap.id);
  // In-range requests keep the stable resolved-inputs hash (no requested echo).
  const six = computeBody({ model: 'agentic', numTurns: 6 }).body;
  const implicitDefault = computeBody({ model: 'agentic' }).body;
  assert.notEqual(six.id, implicitDefault.id);
});

test('dry_run echoes both values and the same clamped id as the real call', () => {
  const dry = computeBody({ model: 'agentic', numTurns: 300, dry_run: true }).body;
  const real = computeBody({ model: 'agentic', numTurns: 300 }).body;
  assert.equal(dry.dry_run, true);
  assert.equal(dry.inputs.numTurns, 200);
  assert.equal(dry.inputs.numTurnsRequested, 300);
  assert.equal(dry.id, real.id);
});

test('batch items get the same clamp + warning treatment as single calls', () => {
  const r = computeBody({
    batch: [
      { model: 'agentic', numTurns: 500 },
      { model: 'agentic', numTurns: 4 }
    ]
  });
  assert.equal(r.status, 200);
  const [over, ok] = r.body.results;
  assert.equal(over.ok, true);
  assert.equal(over.result.inputs.numTurns, 200);
  assert.equal(over.result.inputs.numTurnsRequested, 500);
  assert.ok(over.result.warnings.some(w => w.code === 'num_turns_clamped'));
  assert.equal(ok.result.inputs.numTurnsRequested, undefined);
  // Distinct intents mint distinct ids inside the batch too.
  assert.notEqual(over.result.id, ok.result.id);
});
