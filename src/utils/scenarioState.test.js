// Scenario preset ↔ URL param bridge (#475): ?scenario=<id> restores the
// preset at mount, explicit prompt/output params win, and share links keep
// the scenario identity.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { SCENARIO_PRESETS } from './presets.js';
import { findScenario, initialTokensFromUrl, resolveActiveScenario } from './scenarioState.js';

// Minimal stand-in for urlState.readParam bound to a query string.
function readersOf(search) {
  const p = new URLSearchParams(search);
  return {
    readParam: name => p.get(name),
    readParamNum: (name, fallback) => {
      const v = p.get(name);
      if (v === null || v === '') return fallback;
      const n = Number(v);
      return Number.isFinite(n) ? n : fallback;
    }
  };
}

test('findScenario matches known ids and rejects unknown/empty ones', () => {
  assert.equal(findScenario(SCENARIO_PRESETS, 'rag').id, 'rag');
  assert.equal(findScenario(SCENARIO_PRESETS, 'nope'), null);
  assert.equal(findScenario(SCENARIO_PRESETS, ''), null);
  assert.equal(findScenario(SCENARIO_PRESETS, undefined), null);
});

test('?scenario=<id> alone restores that preset\'s token counts (#475)', () => {
  const { promptTokens, outputTokens, scenario } = initialTokensFromUrl({
    ...readersOf('?tab=single&scenario=longdoc'),
    scenarios: SCENARIO_PRESETS
  });
  assert.equal(scenario.id, 'longdoc');
  assert.equal(promptTokens, 32768);
  assert.equal(outputTokens, 256);
});

test('explicit prompt/output params override ?scenario= counts', () => {
  const r = initialTokensFromUrl({
    ...readersOf('?scenario=rag&prompt=999&output=77'),
    scenarios: SCENARIO_PRESETS
  });
  assert.equal(r.promptTokens, 999);
  assert.equal(r.outputTokens, 77);
});

test('unknown ?scenario= falls back to plain defaults (silent-ignore preserved)', () => {
  const r = initialTokensFromUrl({
    ...readersOf('?scenario=bogus'),
    scenarios: SCENARIO_PRESETS
  });
  assert.equal(r.scenario, null);
  assert.equal(r.promptTokens, 2048);
  assert.equal(r.outputTokens, 512);
});

test('resolveActiveScenario prefers the URL id over token-count inference (#475)', () => {
  // Counts drifted away from the preset, but the URL still names it.
  const a = resolveActiveScenario({
    scenarios: SCENARIO_PRESETS,
    urlScenarioId: 'codegen',
    promptTokens: 1234,
    outputTokens: 42
  });
  assert.equal(a.id, 'codegen');

  // No URL id → legacy reverse-inference still works.
  const b = resolveActiveScenario({
    scenarios: SCENARIO_PRESETS,
    urlScenarioId: null,
    promptTokens: 1024,
    outputTokens: 2048
  });
  assert.equal(b.id, 'reasoning');

  // Neither → null (custom config).
  const c = resolveActiveScenario({ scenarios: SCENARIO_PRESETS, urlScenarioId: null, promptTokens: 7, outputTokens: 7 });
  assert.equal(c, null);
});
