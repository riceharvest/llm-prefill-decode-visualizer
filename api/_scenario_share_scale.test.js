// #741 — /api/agent/scenario.json share-scale consistency: prefillSharePct is
// on the API-wide 0–100 scale (parity with prefillSharePct/decodeSharePct/
// cachingSavesPct/utilizationPct), alongside the legacy 0..1 fraction.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toAgentScenario } from './_handlers/agent_scenario.js';

test('prefillSharePct is 0–100 and consistent with the legacy fraction (#741)', () => {
  const s = toAgentScenario({ id: 'x', label: 'X', promptTokens: 16384, outputTokens: 4096 });
  assert.equal(s.prefillShare, 0.8); // legacy 0..1 unchanged
  assert.equal(s.prefillSharePct, 80); // API-wide percent scale
  assert.ok(Math.abs(s.prefillShare * 100 - s.prefillSharePct) < 0.01);
});

test('prefillSharePct rounds to two decimals', () => {
  const s = toAgentScenario({ id: 'y', label: 'Y', promptTokens: 1500, outputTokens: 250 * 6 });
  const expected = Math.round((1500 / 3000) * 10000) / 100;
  assert.equal(s.prefillSharePct, expected);
});

test('degenerate one-sided workloads hit the scale endpoints', () => {
  assert.equal(toAgentScenario({ id: 'a', label: 'A', promptTokens: 100, outputTokens: 1 }).prefillSharePct > 99, true);
});
