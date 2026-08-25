// /api/compute regression tests: hardware-preset bridge (#476), agentic
// TTFT metric (#473), SLO verdict block (#480), and the pin that
// enablePrefixCaching=false keeps the turns[] array (#478 — fixed on main,
// this guards against re-regression).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { computeBody, resolveHardwarePreset } from './_handlers/compute.js';
import { HARDWARE_PRESETS } from '../src/utils/presets.js';
import { singleTurn } from './_math.js';

// ---------- #476: ?preset= ----------

test('resolveHardwarePreset finds known ids and reports unknown ones', () => {
  const ok = resolveHardwarePreset({ preset: 'dual_rtx3090' });
  assert.equal(ok.speeds.prefillSpeed, 4600);
  assert.equal(ok.speeds.decodeSpeed, 78);
  assert.equal(ok.echo.id, 'dual_rtx3090');

  const bad = resolveHardwarePreset({ preset: 'rtx9999' });
  assert.deepEqual(bad.speeds, {});
  assert.equal(bad.warning.code, 'unknown_preset');
  assert.ok(bad.warning.available.includes('rtx4090_exl2'));

  // Absent/empty → no-op
  assert.deepEqual(resolveHardwarePreset({}).speeds, {});
  assert.deepEqual(resolveHardwarePreset({ preset: '' }).speeds, {});
});

test('?preset=<id> sources default speeds; explicit params still win', () => {
  const out = computeBody({ model: 'agentic', preset: 'dual_rtx3090', numTurns: 2 });
  assert.equal(out.status, 200);
  assert.equal(out.body.inputs.prefillSpeed, 4600);
  assert.equal(out.body.inputs.decodeSpeed, 78);
  assert.deepEqual(out.body.presetApplied, { id: 'dual_rtx3090', name: HARDWARE_PRESETS.find(p => p.id === 'dual_rtx3090').name });

  const overridden = computeBody({ model: 'singleTurn', preset: 'dual_rtx3090', prefillSpeed: 1000 });
  assert.equal(overridden.body.inputs.prefillSpeed, 1000);           // explicit wins
  assert.equal(overridden.body.inputs.decodeSpeed, 78);              // preset fills the rest
});

test('?preset=<unknown id> is a loud warning, not a silent drop', () => {
  const out = computeBody({ model: 'singleTurn', promptTokens: 4096, preset: 'bogus_gpu' });
  assert.equal(out.status, 200);
  const w = out.body.warnings.find(x => x.code === 'unknown_preset');
  assert.ok(w, 'expected an unknown_preset warning');
  assert.match(w.message, /bogus_gpu/);
});

test('no ?preset → response shape unchanged (no presetApplied field)', () => {
  const out = computeBody({ model: 'singleTurn', promptTokens: 4096 });
  assert.equal(out.body.presetApplied, undefined);
  assert.equal(out.body.inputs.prefillSpeed, 3800);
});

// ---------- #473: agentic ttftSeconds ----------

test('agentic response now carries ttftSeconds == turns[0].prefillSeconds', () => {
  const out = computeBody({ model: 'agentic', numTurns: 3 });
  assert.equal(out.status, 200);
  assert.equal(typeof out.body.ttftSeconds, 'number');
  assert.equal(out.body.ttftSeconds, out.body.turns[0].prefillSeconds);
  assert.equal(out.body.ttftSeconds, Math.round((1500 / 3800) * 1e6) / 1e6); // cold-cache turn-1 prefill, rounded like all API times
});

// ---------- #480: SLO block ----------

test('maxTtftSeconds/maxTpotMs produce a pass/fail slo block (singleTurn)', () => {
  const pass = computeBody({ model: 'singleTurn', maxTtftSeconds: 10, maxTpotMs: 50 });
  assert.equal(pass.body.slo.verdict, 'pass');
  assert.equal(pass.body.slo.budgets.maxTtftSeconds, 10);
  assert.equal(pass.body.slo.ttft.pass, true);

  const fail = computeBody({ model: 'singleTurn', promptTokens: 40960, maxTtftSeconds: 1 });
  assert.equal(fail.body.slo.verdict, 'fail'); // 40960/3800 ≈ 10.8 s ≫ 1 s budget
  assert.equal(fail.body.slo.ttft.pass, false);

  // No budgets requested → no slo field (additive contract)
  const none = computeBody({ model: 'singleTurn' });
  assert.equal(none.body.slo, undefined);
});

test('agentic SLO evaluates against the loop TTFT and implied TPOT', () => {
  const slo = computeBody({ model: 'agentic', numTurns: 2, maxTtftSeconds: 1, maxTpotMs: 5 }).body.slo;
  assert.equal(slo.verdict, 'fail'); // ttft 1500/3800 ≈ .39 passes, tpot 9.52 > 5 fails
  assert.equal(slo.ttft.pass, true);
  assert.equal(slo.tpot.pass, false);
});

// ---------- #478 pin: turns[] survives caching=false ----------

test('enablePrefixCaching=false still returns the full per-turn array', () => {
  const out = computeBody({ model: 'agentic', numTurns: 2, enablePrefixCaching: 'false' });
  assert.equal(out.status, 200);
  assert.ok(Array.isArray(out.body.turns));
  assert.equal(out.body.turns.length, 2);
  assert.equal(out.body.turns[1].isCached, false);
  assert.equal(out.body.cachingSavesSeconds, 0);
});

// ---------- plain math parity ----------

test('feature-free singleTurn response is byte-identical to the pure math', () => {
  const inputs = { promptTokens: 4096, outputTokens: 512, prefillSpeed: 3800, decodeSpeed: 105 };
  const out = computeBody({ model: 'singleTurn', ...inputs });
  const expected = singleTurn(inputs);
  for (const k of Object.keys(expected)) {
    assert.deepEqual(out.body[k], expected[k], `field ${k} diverged`);
  }
});
