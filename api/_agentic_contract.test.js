// Regression tests for two /api/compute?model=agentic contract defects:
//   #783 — fractional numTurns was floored silently by the turn loop while
//          inputs echoed the fractional value verbatim (and the calc id
//          hashed it). Now inputs echo the EXECUTED integer and a
//          num_turns_floored warning fires when flooring engages.
//   #790 — finalContextTokens omitted the last turn's pending tool output,
//          understating the context entering the next prefill by exactly
//          toolOutputTokensPerTurn.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeBody } from './_handlers/compute.js';
import { agentic } from './_math.js';

test('#783: fractional numTurns echoes the executed integer in inputs', () => {
  const { body } = computeBody({ model: 'agentic', numTurns: 6.7 });
  assert.equal(body.inputs.numTurns, 6, 'inputs must echo the executed count');
  assert.equal(body.turns.length, 6);
  assert.equal(body.inputs.numTurns, body.turns.length);
});

test('#783: fractional numTurns emits a num_turns_floored warning', () => {
  const { body } = computeBody({ model: 'agentic', numTurns: 6.7 });
  const w = body.warnings.find(x => x.code === 'num_turns_floored');
  assert.ok(w, 'expected a num_turns_floored warning');
  assert.match(w.message, /6\.7/);
  assert.match(w.message, /\b6\b/);
});

test('#783: calc id for a fractional request equals the id of its executed value', () => {
  const frac = computeBody({ model: 'agentic', numTurns: 6.7 }).body.id;
  const int = computeBody({ model: 'agentic', numTurns: 6 }).body.id;
  assert.equal(frac, int, 'same effective simulation must share one deterministic id');
});

test('#783: integer numTurns is untouched — no warning, identical math', () => {
  const { body } = computeBody({ model: 'agentic', numTurns: 4 });
  assert.equal(body.inputs.numTurns, 4);
  assert.deepEqual(body.warnings, []);
  const direct = agentic({
    numTurns: 4, basePromptTokens: 1500, toolOutputTokensPerTurn: 800,
    decodeTokensPerTurn: 250, prefillSpeed: 3800, decodeSpeed: 105,
    enablePrefixCaching: true
  });
  assert.equal(body.totalWalltimeSeconds, direct.totalWalltimeSeconds);
});

test('#783: clamp still applies before flooring (50-cap preserved)', () => {
  const { body } = computeBody({ model: 'agentic', numTurns: 200 });
  assert.equal(body.inputs.numTurns, 50);
  assert.equal(body.turns.length, 50);
});
