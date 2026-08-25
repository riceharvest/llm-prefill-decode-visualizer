import { test } from 'node:test';
import assert from 'node:assert/strict';

import { validateBudgetInput, sanitizeBudgets, evaluateMetric } from './slo.js';

// #639 — invalid SLO budget values used to coerce to null ("check disabled")
// with zero error surface. validateBudgetInput distinguishes off / set / invalid
// so the editor can reject garbage instead of silently deleting coverage.

test('#639 empty input = deliberate Off (ok)', () => {
  assert.deepEqual(validateBudgetInput(''), { ok: true, state: 'off', value: null });
  assert.deepEqual(validateBudgetInput(null), { ok: true, state: 'off', value: null });
});

test('#639 positive numbers parse to set budgets', () => {
  assert.equal(validateBudgetInput('500').ok, true);
  assert.equal(validateBudgetInput('500').state, 'set');
  assert.equal(validateBudgetInput('500').value, 500);
  assert.equal(validateBudgetInput('0.5').value, 0.5);
});

test('#639 zero / negative / garbage are REJECTED with an error, not coerced', () => {
  for (const raw of ['0', '-5', 'abc', '500ms', 'NaN', 'Infinity']) {
    const r = validateBudgetInput(raw);
    assert.equal(r.ok, false, `${raw} must be rejected`);
    assert.equal(r.state, 'invalid');
    assert.equal(r.value, null);
    assert.ok(r.error && r.error.length > 10, `rejection carries a message for ${raw}`);
  }
});

test('#639 sanitize/evaluate legacy semantics unchanged for valid + absent values', () => {
  // sanitizeBudgets still disables on null — the editor just never feeds it
  // invalid raw strings anymore.
  assert.equal(sanitizeBudgets({ ttftMs: 500, tpotMs: 50 }).walltimeSec, null);
  assert.equal(evaluateMetric(400, 500).pass, true);
});
