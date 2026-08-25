import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  GROUP_BY_VALUES,
  enumParamWarning,
  positiveNumberParamWarning,
  indexModeIgnoredParamsWarning
} from './_param_validation.js';

test('GROUP_BY_VALUES matches the documented cohort keys', () => {
  assert.deepEqual(GROUP_BY_VALUES.sort(), ['hardware', 'hardwareModel', 'model', 'quant']);
});

test('enumParamWarning: absent/empty param → null', () => {
  assert.equal(enumParamWarning('groupBy', undefined, GROUP_BY_VALUES, 'hardwareModel'), null);
  assert.equal(enumParamWarning('groupBy', '', GROUP_BY_VALUES, 'hardwareModel'), null);
});

test('enumParamWarning: valid canonical value → null', () => {
  for (const v of GROUP_BY_VALUES) {
    assert.equal(enumParamWarning('groupBy', v, GROUP_BY_VALUES, v), null);
  }
});

test('enumParamWarning: typo value → warning naming requested + applied (#443)', () => {
  const w = enumParamWarning('groupBy', 'notAField', GROUP_BY_VALUES, 'hardwareModel');
  assert.ok(w);
  assert.equal(w.code, 'param_value_ignored');
  assert.equal(w.param, 'groupBy');
  assert.equal(w.requested, 'notAField');
  assert.equal(w.used, 'hardwareModel');
  assert.match(w.message, /Valid values:/);
});

test('positiveNumberParamWarning: absent or valid positive number → null', () => {
  assert.equal(positiveNumberParamWarning('max_age', undefined, null), null);
  assert.equal(positiveNumberParamWarning('max_age', '', null), null);
  assert.equal(positiveNumberParamWarning('max_age', '90', 90), null);
});

test('positiveNumberParamWarning: garbage and non-positive values warn (#443)', () => {
  for (const bad of ['abc', '-5', '0']) {
    const w = positiveNumberParamWarning('max_age', bad, null);
    assert.ok(w, `expected warning for ${bad}`);
    assert.equal(w.code, 'param_value_ignored');
    assert.equal(w.param, 'max_age');
    assert.equal(w.requested, bad);
    assert.match(w.message, /not a positive number/);
  }
});

test('indexModeIgnoredParamsWarning: no inert params → null', () => {
  assert.equal(indexModeIgnoredParamsWarning({}), null);
  assert.equal(indexModeIgnoredParamsWarning({ limit: '' }), null);
});

test('indexModeIgnoredParamsWarning: inert limit/cursor flagged with the repro case (#443)', () => {
  const w = indexModeIgnoredParamsWarning({ limit: '-5' });
  assert.ok(w);
  assert.equal(w.code, 'param_ignored_in_index_mode');
  assert.equal(w.param, 'limit');
  assert.equal(w.requested, 'limit=-5');
  assert.match(w.message, /mode "index"/);

  const both = indexModeIgnoredParamsWarning({ limit: '2', cursor: 'abc' });
  assert.equal(both.param, 'limit,cursor');
});
