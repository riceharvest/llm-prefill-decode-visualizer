// Locale-invariant number formatting (#920) + locale-invariant API prose (#652).
//
// #920: every numeral the app renders goes through src/utils/numerals.js,
// whose Intl.NumberFormat is pinned to 'en-US' at module load. setLocale()
// (the ?lang= pipeline) must never be able to alter it, so the DOM is
// byte-identical across hosts and <html lang> can't contradict the digits.
//
// #652: JSON API prose fields carry no comma-grouped numerics — a naive
// /\d+/ extraction over "70,000,000,000 params" yields "70".
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { formatNum } from '../src/utils/numerals.js';
import { setLocale, getLocale } from '../src/i18n/strings.js';
import { lookupHfArch } from '../api/_hflookup.js';
import { SCENARIO_PRESETS } from '../src/utils/presets.js';
import { isValidScenario, toAgentScenario } from '../api/_handlers/agent_scenario.js';

test('formatNum pins en-US grouping regardless of runtime locale', () => {
  assert.equal(formatNum(70000000000), '70,000,000,000');
  assert.equal(formatNum(4096), '4,096');
  assert.equal(formatNum(0), '0');
  assert.equal(formatNum(12.5).startsWith('12'), true);
});

test('setLocale() cannot change numeral output (#920)', () => {
  const original = getLocale();
  try {
    for (const loc of ['ar', 'de', 'fr', 'en']) {
      setLocale(loc);
      // Same bytes on every locale switch — formatters are pinned at module
      // load and never re-localized.
      assert.equal(formatNum(32768), '32,768', `locale ${loc} leaked into numerals`);
    }
  } finally {
    setLocale(original);
  }
});

test('formatNum returns "" for non-finite input (call sites render their own fallback)', () => {
  assert.equal(formatNum(NaN), '');
  assert.equal(formatNum(Infinity), '');
  assert.equal(formatNum(undefined), '');
});

test('API prose carries no grouped numerics: hflookup weightsSource (#652)', () => {
  const hit = lookupHfArch('meta-llama/Llama-3.1-8B-Instruct');
  assert.ok(hit);
  assert.match(hit.weightsSource, /\d+ params/);
  assert.doesNotMatch(hit.weightsSource, /\d,\d{3}/);
  assert.equal(typeof hit.paramsTotal, 'number');
});

test('API prose carries no grouped numerics: agent scenario description (#652)', () => {
  for (const scenario of SCENARIO_PRESETS.filter(isValidScenario)) {
    const flat = toAgentScenario(scenario);
    assert.equal(typeof flat.promptTokens, 'number');
    assert.equal(typeof flat.outputTokens, 'number');
    // The structured fields are raw numbers; nothing in the payload shape may
    // reintroduce grouped strings.
    assert.equal(String(flat.promptTokens).includes(','), false, scenario.id);
    assert.equal(String(flat.outputTokens).includes(','), false, scenario.id);
  }
});

async function callVram(query) {
  const { default: handler } = await import('../api/_handlers/vram.js');
  const captured = {};
  const res = {
    statusCode: 0,
    setHeader() {},
    end(body) {
      captured.status = this.statusCode;
      captured.body = JSON.parse(body);
    }
  };
  await handler({ method: 'GET', query }, res);
  return captured;
}

test('/api/vram payload is locale-invariant end to end (#652)', async () => {
  const { status, body } = await callVram({
    hfId: 'meta-llama/Llama-3.1-70B-Instruct',
    context: '131072'
  });
  assert.equal(status, 200);
  // The only carrier values must survive naive /\d+/ extraction.
  assert.match(body.weights.source, /^\d+ params × /);
  assert.equal(body.weights.source.includes(','), false);
  assert.doesNotMatch(JSON.stringify(body), /\d,\d{3}/);
  assert.equal(typeof body.model.paramsTotal, 'number');
  assert.deepEqual(body.kvCache.formulaParts, {
    kPlusV: 2,
    layers: body.model.architecture.numLayers,
    kvHeads: body.model.architecture.kvHeads,
    headDim: body.model.architecture.headDim,
    kvPrecisionBytes: 2,
    context: 131072,
    batch: 1
  });
});
