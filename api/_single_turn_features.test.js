// Tests for the single-turn engine-feature API surface (#472) and the
// server-side SLO evaluation (#480).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  resolveSingleTurnFeatures,
  simulateSingleTurnFeatures,
  evaluateSlo,
  ITL_SEED
} from './_single_turn_features.js';
import { singleTurn } from './_math.js';

const BASE = { promptTokens: 4096, outputTokens: 512, prefillSpeed: 3800, decodeSpeed: 105 };

// ---------- #472: opt-in feature parsing ----------

test('no feature params → null (plain singleTurn path, response unchanged)', () => {
  assert.equal(resolveSingleTurnFeatures({}), null);
  assert.equal(resolveSingleTurnFeatures({ model: 'singleTurn', promptTokens: 4096 }), null);
});

test('ctx=1 resolves context scaling with default and explicit C½', () => {
  const f = resolveSingleTurnFeatures({ ctx: '1' });
  assert.equal(f.contextScaling.enabled, true);
  assert.equal(f.contextScaling.halfSpeedContext, 32768);

  const f2 = resolveSingleTurnFeatures({ ctx: 'true', ctxHalf: '8192' });
  assert.equal(f2.contextScaling.halfSpeedContext, 8192);
  // C½ below the UI floor of 1024 is clamped
  const f3 = resolveSingleTurnFeatures({ ctx: '1', ctxHalf: '-5' });
  assert.equal(f3.contextScaling.halfSpeedContext, 1024);
});

test('img=1 resolves image tokens via the same estimator the UI uses', () => {
  const f = resolveSingleTurnFeatures({ img: '1' });
  assert.equal(f.images.count, 1);
  assert.ok(f.images.tokensPerImage > 0);
  assert.equal(f.images.totalImageTokens, f.images.tokensPerImage * 1);

  const f4k = resolveSingleTurnFeatures({ img: '1', imgN: '3', imgRes: '4k' });
  assert.equal(f4k.images.resolution, '4k');
  assert.equal(f4k.images.totalImageTokens, f4k.images.tokensPerImage * 3);
});

test('imgRes unknown preset falls back to 1080p; imgN clamped to 1..8', () => {
  const f = resolveSingleTurnFeatures({ img: '1', imgRes: '8k', imgN: '50' });
  assert.equal(f.images.resolution, '1080p');
  assert.equal(f.images.count, 8);
});

test('jit=1 resolves jitter with clamped cv% and the shared seed', () => {
  const f = resolveSingleTurnFeatures({ jit: '1' });
  assert.equal(f.jitter.cvPct, 25);
  assert.equal(f.jitter.seed, ITL_SEED);

  const f2 = resolveSingleTurnFeatures({ jit: 'true', jitPct: '99' });
  assert.equal(f2.jitter.cvPct, 60); // UI clamp
});

// ---------- #472: feature math ----------

test('image tokens raise TTFT exactly like the UI (tokens join prefill)', () => {
  const features = resolveSingleTurnFeatures({ img: '1', imgN: '2' });
  const out = simulateSingleTurnFeatures(BASE, features);
  const plain = singleTurn(BASE);
  const expectedTtft = (BASE.promptTokens + features.images.totalImageTokens) / BASE.prefillSpeed;
  assert.equal(out.ttftSeconds, Math.round(expectedTtft * 1e6) / 1e6);
  assert.ok(out.ttftSeconds > plain.ttftSeconds);
  assert.equal(out.images.totalImageTokens, features.images.totalImageTokens);
});

test('context scaling slows decode (walltime above the flat-speed baseline)', () => {
  const features = resolveSingleTurnFeatures({ ctx: '1', ctxHalf: '8192' });
  const out = simulateSingleTurnFeatures(BASE, features);
  const plain = singleTurn(BASE);
  assert.ok(out.decodeSeconds > plain.decodeSeconds);
  // Tighter C½ slows decode further
  const tighter = simulateSingleTurnFeatures(BASE, resolveSingleTurnFeatures({ ctx: '1', ctxHalf: '2048' }));
  assert.ok(tighter.decodeSeconds > out.decodeSeconds);
  // tpotMs is reported at the average cache depth → larger than 1000/decodeSpeed
  assert.ok(out.tpotMs > 1000 / BASE.decodeSpeed);
});

test('jitter is mean-preserving and deterministic for a fixed seed', () => {
  const features = resolveSingleTurnFeatures({ jit: '1', jitPct: '30' });
  const a = simulateSingleTurnFeatures(BASE, features);
  const b = simulateSingleTurnFeatures(BASE, resolveSingleTurnFeatures({ jit: '1', jitPct: '30' }));
  assert.deepEqual(a.itl, b.itl); // seeded ⇒ stable across calls/share links

  // Mean ≈ TPOT within sampling noise (lognormal shift-corrected draws)
  const plainTpotMs = 1000 / BASE.decodeSpeed;
  assert.ok(Math.abs(a.itl.meanMs - plainTpotMs) / plainTpotMs < 0.15);
  // Tail grows with variance: p95 well above the mean
  assert.ok(a.itl.p95Ms > a.itl.meanMs);
  assert.equal(a.itl.count, BASE.outputTokens);
});

test('feature outputs stay internally consistent (shares sum to ~100)', () => {
  const features = resolveSingleTurnFeatures({ ctx: '1', img: '1', jit: '1', imgN: '2', ctxHalf: '16384', jitPct: '40' });
  const out = simulateSingleTurnFeatures(BASE, features);
  assert.ok(Math.abs(out.prefillSharePct + out.decodeSharePct - 100) < 0.01);
  assert.ok(Math.abs(out.totalWalltimeSeconds - (out.ttftSeconds + out.decodeSeconds)) < 1e-6);
});

// ---------- #480: SLO evaluation ----------

test('evaluateSlo returns null when no budget is given', () => {
  assert.equal(evaluateSlo({}), null);
  assert.equal(evaluateSlo({ maxTtftSeconds: undefined, maxTpotMs: undefined }), null);
});

test('evaluateSlo passes when both metrics fit their budgets', () => {
  const slo = evaluateSlo({
    maxTtftSeconds: 2,
    maxTpotMs: 20,
    ttftSeconds: 1.08,
    tpotMs: 9.52
  });
  assert.equal(slo.budgets.maxTtftSeconds, 2);
  assert.equal(slo.budgets.maxTpotMs, 20);
  assert.equal(slo.checks ?? slo.ttft.pass, slo.ttft.pass); // shape sanity
  assert.equal(slo.ttft.pass, true);
  assert.equal(slo.tpot.pass, true);
  assert.equal(slo.verdict, 'pass');
});

test('evaluateSlo fails on any exceeded budget', () => {
  const slo = evaluateSlo({ maxTpotMs: 5, ttftSeconds: 1, tpotMs: 9.52 });
  assert.equal(slo.tpot.pass, false);
  assert.equal(slo.verdict, 'fail');
});

test('evaluateSlo ignores zero/negative/non-numeric budgets (disabled check)', () => {
  const slo = evaluateSlo({ maxTtftSeconds: '0', maxTpotMs: 20, ttftSeconds: 100, tpotMs: 9.52 });
  assert.equal(slo.budgets.maxTtftSeconds, undefined);
  assert.equal(slo.ttft, undefined);
  // Only the TPOT check ran
  assert.equal(slo.tpot.pass, true);
});
