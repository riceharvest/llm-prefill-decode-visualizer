// Agentic-loop contract tests (#486 #492 #493):
//   #486 — the rich per-turn response shape is documented in /api/spec
//           (AgenticTurn schema + ComputeResult agentic fields) and llms.txt.
//   #492 — optional SLO budgets (?sloTtftSec/?sloTpotMs/?sloTurnWalltimeSec/
//           ?sloWalltimeSec) produce per-turn + whole-loop pass/marginPct
//           verdicts using the same margin convention as the UI badges.
//   #493 — optional ?contextWindowTokens= produces firstContextOverflowTurn
//           (naming mirrors /api/vram) plus a context_window_overflow warning.
//
// Run: node --test api/_agentic_contract.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import computeHandler from './_handlers/compute.js';
import specHandler from './_handlers/spec.js';
import { agentic } from './_math.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function callCompute(query = {}) {
  const res = {
    statusCode: 200,
    headers: {},
    body: undefined,
    setHeader(k, v) { this.headers[k] = v; },
    getHeader(k) { return this.headers[k]; },
    status(code) { this.statusCode = code; return this; },
    end(payload) { if (payload !== undefined) this.body = payload; }
  };
  computeHandler({ method: 'GET', query }, res);
  assert.ok(res.body, 'handler should write a JSON body');
  return { status: res.statusCode, json: JSON.parse(res.body) };
}

function callSpec() {
  const res = {
    statusCode: 200,
    headers: {},
    body: undefined,
    setHeader(k, v) { this.headers[k] = v; },
    getHeader(k) { return this.headers[k]; },
    status(code) { this.statusCode = code; return this; },
    end(payload) { if (payload !== undefined) this.body = payload; }
  };
  specHandler({ method: 'GET', query: {} }, res);
  return JSON.parse(res.body);
}

// ---- #486: response shape is real and documented ---------------------------

test('#486 agentic response carries the documented turns[] fields on the wire', () => {
  const { json } = callCompute({ model: 'agentic', numTurns: 3 });
  assert.equal(json.turns.length, 3);
  for (const t of json.turns) {
    for (const key of ['turn', 'totalPromptTokens', 'newTokensPrefilled', 'isCached',
      'prefillSeconds', 'decodeSeconds', 'turnWalltimeSeconds', 'cumulativeWalltimeSeconds']) {
      assert.ok(key in t, `wire turn object missing documented field ${key}`);
    }
  }
  assert.ok('finalContextTokens' in json);
  assert.ok('walltimeWithoutCachingSeconds' in json);
  assert.ok('cachingSavesSeconds' in json);
  assert.ok('cachingSavesPct' in json);
});

test('#486 /api/spec declares AgenticTurn + the agentic extras on ComputeResult', () => {
  const spec = callSpec();
  const turnSchema = spec.components.schemas.AgenticTurn;
  assert.ok(turnSchema, 'spec missing components.schemas.AgenticTurn');
  const wire = agentic({ numTurns: 2 });
  // Drift guard: every wire field of a turn is declared by the schema.
  for (const key of Object.keys(wire.turns[0])) {
    assert.ok(key in turnSchema.properties, `AgenticTurn schema missing wire field ${key}`);
    assert.ok(turnSchema.required.includes(key), `AgenticTurn required[] missing ${key}`);
  }
  const resultProps = spec.components.schemas.ComputeResult.properties;
  for (const key of ['turns', 'finalContextTokens', 'walltimeWithoutCachingSeconds',
    'cachingSavesSeconds', 'cachingSavesPct']) {
    assert.ok(key in resultProps, `ComputeResult schema missing agentic field ${key}`);
  }
  assert.equal(resultProps.turns.items.$ref, '#/components/schemas/AgenticTurn');
  // The new warning code is part of the documented enum.
  assert.ok(resultProps.warnings.items.properties.code.enum.includes('context_window_overflow'));
});

test('#486 llms.txt documents the agentic response shape and overflow field', () => {
  const llms = readFileSync(join(root, 'public', 'llms.txt'), 'utf8');
  for (const needle of ['turnWalltimeSeconds', 'finalContextTokens', 'firstContextOverflowTurn', 'sloWalltimeSec']) {
    assert.ok(llms.includes(needle), `llms.txt does not mention ${needle}`);
  }
});

// ---- #492: SLO budgets ------------------------------------------------------

test('#492 slo budgets produce per-turn verdicts matching the UI margin convention', () => {
  const { json } = callCompute({
    model: 'agentic', numTurns: 4,
    sloTtftSec: 1, sloTpotMs: 20, sloTurnWalltimeSec: 10, sloWalltimeSec: 1000
  });
  assert.ok(json.slo, 'expected a slo block when budgets are passed');
  assert.deepEqual(json.slo.budgets, { ttftMs: 1000, tpotMs: 20, walltimeSec: 10, walltimeLoopSec: 1000 });
  assert.equal(json.slo.turns.length, 4);

  // Turn 1 TTFT = basePromptTokens/prefillSpeed seconds → compare vs 1 s budget.
  const first = json.slo.turns[0];
  assert.equal(first.turn, 1);
  const expectedTtftValue = json.turns[0].prefillSeconds * 1000;
  assert.equal(first.ttft.value, expectedTtftValue);
  assert.equal(first.ttft.budget, 1000);
  assert.equal(first.ttft.pass, expectedTtftValue <= 1000);
  assert.ok(Math.abs(
    first.ttft.marginPct - (1000 - expectedTtftValue) / 1000 * 100
  ) < 1e-9, 'marginPct must equal (budget − value) ÷ budget × 100');

  // TPOT budget 20 ms vs decode 250 tokens at 105 tok/s ≈ 9.52 ms/token → passes.
  assert.equal(first.tpot.pass, true);
  // Generous budgets: nothing fails anywhere, loop verdict present and passing.
  assert.deepEqual(json.slo.failingTurns, []);
  assert.equal(json.slo.loop.budget, 1000);
  assert.equal(json.slo.loop.pass, json.totalWalltimeSeconds <= 1000);
});

test('#492 failing budgets are reported with negative margins and failingTurns', () => {
  const { json } = callCompute({
    model: 'agentic', numTurns: 4,
    sloTtftSec: 0.001, sloTurnWalltimeSec: 0.001, sloWalltimeSec: 0.001
  });
  assert.ok(json.slo.failingTurns.length > 0, 'impossible budgets must fail turns');
  for (const tn of json.slo.failingTurns) {
    const t = json.slo.turns.find(x => x.turn === tn);
    const checks = [t.ttft, t.walltime].filter(Boolean);
    assert.ok(checks.some(c => !c.pass), `turn ${tn} listed as failing but all its checks pass`);
    assert.ok(checks.some(c => c.marginPct < 0), 'a failed check must carry a negative marginPct');
  }
  assert.equal(json.slo.loop.pass, false);
  assert.ok(json.slo.loop.marginPct < 0);
});

test('#492 no budgets → no slo block; disabled checks evaluate to null', () => {
  const plain = callCompute({ model: 'agentic', numTurns: 2 }).json;
  assert.ok(!('slo' in plain), 'slo block must be absent when no budget is passed');

  const partial = callCompute({ model: 'agentic', numTurns: 2, sloTpotMs: 50 }).json;
  assert.ok(partial.slo);
  assert.equal(partial.slo.turns[0].ttft, null, 'unset ttft budget must disable that check');
  assert.notEqual(partial.slo.turns[0].tpot, null);
  assert.equal(partial.slo.loop, undefined, 'loop verdict only when ?sloWalltimeSec is passed');

  // Garbage budget values disable rather than break (#711-adjacent fail-open is
  // intentional here: budgets are optional hints, not validation targets).
  const junk = callCompute({ model: 'agentic', numTurns: 2, sloWalltimeSec: 'abc', sloTpotMs: '-3' }).json;
  assert.ok(!('slo' in junk));
});

// ---- #493: context-window overflow projection ------------------------------

test('#493 firstContextOverflowTurn names the exact overflowing turn + warning', () => {
  // Context after turn N = 1500 + (N−1)*1050 + 250 decoded. Turn 3 = 3850 > 3000;
  // after turn 6 the loop ends at 1500 + 5*1050 + 250 = 7000.
  const { json } = callCompute({
    model: 'agentic', numTurns: 6, contextWindowTokens: 3000
  });
  assert.equal(json.contextWindowTokens, 3000);
  assert.equal(json.finalContextTokens, 7000);
  assert.equal(json.firstContextOverflowTurn, 3);
  const w = json.warnings.find(x => x.code === 'context_window_overflow');
  assert.ok(w, 'overflow must emit a context_window_overflow warning');
  assert.match(w.message, /turn 3/);
});

test('#493 fitting loop reports null overflow turn and no warning', () => {
  const { json } = callCompute({
    model: 'agentic', numTurns: 6, contextWindowTokens: 100000
  });
  assert.equal(json.firstContextOverflowTurn, null);
  assert.ok(!json.warnings.some(w => w.code === 'context_window_overflow'));
});

test('#493 absent/garbage contextWindowTokens keeps the response unchanged', () => {
  const { json } = callCompute({ model: 'agentic', numTurns: 6 });
  assert.ok(!('firstContextOverflowTurn' in json));
  assert.ok(!('contextWindowTokens' in json));

  const junk = callCompute({ model: 'agentic', numTurns: 6, contextWindowTokens: 'abc' }).json;
  assert.ok(!('firstContextOverflowTurn' in junk), 'non-numeric window must be ignored, not NaN-compared');
});

// ---- calc-id stability -------------------------------------------------------

test('optional extras do not disturb existing calc ids; using them mints distinct ids', () => {
  const bare = callCompute({ model: 'agentic', numTurns: 6 }).json.id;
  const explicitDefaults = callCompute({
    model: 'agentic', numTurns: 6, basePromptTokens: 1500, toolOutputTokensPerTurn: 800,
    decodeTokensPerTurn: 250, prefillSpeed: 3800, decodeSpeed: 105, enablePrefixCaching: ''
  }).json.id;
  assert.equal(bare, explicitDefaults);

  const withSlo = callCompute({ model: 'agentic', numTurns: 6, sloWalltimeSec: 30 }).json;
  assert.notEqual(withSlo.id, bare, 'different resolved inputs must mint a different calc id');
  assert.deepEqual(withSlo.inputs.sloWalltimeSec, 30, 'budget inputs are echoed back');
});

test('dry_run echoes the new inputs without executing math', () => {
  const { json } = callCompute({
    model: 'agentic', numTurns: 3, dry_run: 'true',
    contextWindowTokens: 8192, sloTtftSec: 2
  });
  assert.equal(json.dry_run, true);
  assert.equal(json.inputs.contextWindowTokens, 8192);
  assert.equal(json.inputs.sloTtftSec, 2);
  assert.ok(!('turns' in json), 'dry run must not execute the simulation');
});
