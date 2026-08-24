// Regression tests for the /api/best?by=cost power-input resolution (#1111)
// and the /api/compute?model=cost zero-default warnings (#736).
//
// #1111: only ?powerWatts= was read (compute documents ?powerDrawWatts=) and
// the per-hwClass DEFAULT_POWER_WATTS fallbacks were dead code because the
// wire's hwClass casing doesn't match the table's lower-case keys — every rig
// silently priced at a flat 150 W.
//
// #736: model=cost defaulted hardwarePriceUsd=0 and powerDrawWatts=0 with no
// warnings field at all, so $0.00/1M tokens looked like a real (free) rig.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveCostPowerWatts } from './best.js';
import { computeBody } from './compute.js';

test('resolveCostPowerWatts honors both ?powerWatts and documented ?powerDrawWatts', () => {
  assert.equal(resolveCostPowerWatts({ powerDrawWatts: '450' }, 'DISCRETE_GPU'), 450);
  assert.equal(resolveCostPowerWatts({ powerWatts: '250' }, 'DISCRETE_GPU'), 250);
  // Explicit beats fallback regardless of spelling.
  assert.equal(resolveCostPowerWatts({ powerDrawWatts: '10', powerWatts: '999' }, 'unified'), 10);
});

test('resolveCostPowerWatts falls back per hwClass case-insensitively (#1111)', () => {
  // Wire hwClass casing has drifted upper-case; the table keys are lower-case.
  assert.equal(resolveCostPowerWatts({}, 'DISCRETE_GPU'), 300);
  assert.equal(resolveCostPowerWatts({}, 'discrete_gpu'), 300);
  assert.equal(resolveCostPowerWatts({}, 'UNIFIED'), 60);
  assert.equal(resolveCostPowerWatts({}, 'CPU_ONLY'), 120);
});

test('resolveCostPowerWatts falls back to flat 150 for unknown hwClass', () => {
  assert.equal(resolveCostPowerWatts({}, undefined), 150);
  assert.equal(resolveCostPowerWatts({}, ''), 150);
  assert.equal(resolveCostPowerWatts({}, 'gpu_thing'), 150);
});

test('model=cost emits cost_inputs_default_to_zero when money inputs are unset (#736)', () => {
  const { body } = computeBody({ model: 'cost' });
  assert.ok(Array.isArray(body.warnings), 'cost responses must carry a warnings array');
  const w = body.warnings.find(x => x.code === 'cost_inputs_default_to_zero');
  assert.ok(w, 'expected a zero-default warning');
  assert.match(w.message, /hardwarePriceUsd=0/);
  assert.match(w.message, /powerDrawWatts=0/);
  assert.equal(body.inputs.hardwarePriceUsd, 0);
  assert.equal(body.inputs.powerDrawWatts, 0);
});

test('model=cost warns only about the inputs actually missing (#736)', () => {
  const { body } = computeBody({ model: 'cost', hardwarePriceUsd: 2000 });
  assert.equal(body.warnings.length, 1);
  assert.doesNotMatch(body.warnings[0].message, /hardwarePriceUsd=0/);
  assert.match(body.warnings[0].message, /powerDrawWatts=0/);

  const full = computeBody({ model: 'cost', price: 2000, powerDrawWatts: 450 }).body;
  assert.deepEqual(full.warnings, []);
  assert.equal(full.costUsdPerMillionTokens > 0, true, 'fully-specified call prices above zero');
});

test('dry_run model=cost carries the same zero-default warning (#736)', () => {
  const { body } = computeBody({ model: 'cost', dry_run: 'true' });
  assert.equal(body.dry_run, true);
  assert.ok(body.warnings.some(x => x.code === 'cost_inputs_default_to_zero'));
});
