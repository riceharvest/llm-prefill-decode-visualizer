// #720 — decay-curve sample helper: the curve's values must exist outside the
// SVG geometry so they can back the sr-only data table.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildDecayCurveSamples, CURVE_SAMPLES } from './ctxDecayCurve.js';

test('samples span [0, maxGen] inclusive with the documented count', () => {
  const samples = buildDecayCurveSamples({
    maxGen: 512, scaleEnabled: true, baseSpeed: 100, prefillTokens: 2048, ctxHalf: 8192
  });
  assert.equal(samples.length, CURVE_SAMPLES + 1);
  assert.equal(samples[0].gen, 0);
  assert.equal(samples[samples.length - 1].gen, 512);
});

test('with scaling engaged the curve decays monotonically from the prefilled-context speed', () => {
  const samples = buildDecayCurveSamples({
    maxGen: 4096, scaleEnabled: true, baseSpeed: 100, prefillTokens: 2048, ctxHalf: 8192
  });
  // gen=0 is the instantaneous speed at the already-prefilled context
  // (= curveStartSpeed in SingleTurnVisualizer), not the raw base speed.
  assert.ok(Math.abs(samples[0].tokps - 80) < 1e-9);
  for (let i = 1; i < samples.length; i++) {
    assert.ok(samples[i].tokps <= samples[i - 1].tokps + 1e-9, `non-monotonic at i=${i}`);
    assert.ok(samples[i].tokps > 0);
  }
  assert.ok(samples[samples.length - 1].tokps < samples[0].tokps, 'deep context must be slower than the start');
});

test('with scaling disabled every sample equals the flat base speed', () => {
  const samples = buildDecayCurveSamples({
    maxGen: 512, scaleEnabled: false, baseSpeed: 77, prefillTokens: 2048, ctxHalf: 8192
  });
  assert.ok(samples.every(p => p.tokps === 77));
});
