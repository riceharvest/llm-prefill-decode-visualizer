import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  EXPORT_JSON_VERSION,
  GENERATOR_ID,
  roundTo,
  buildSingleTurnJson,
  buildAgenticJson,
  serializeJson
} from './exportJson.js';
import { calculateAgenticTimeline } from './agenticMath.js';

const FIXED_AT = '2026-08-23T12:00:00.000Z';

test('roundTo rounds to fixed decimals and passes non-finite through', () => {
  assert.equal(roundTo(1.23456), 1.2346);
  assert.equal(roundTo(1.00005, 2), 1);
  assert.equal(roundTo(Infinity), Infinity);
  assert.ok(Number.isNaN(roundTo(NaN)));
});

// ---------------------------------------------------------------------------
// Single-turn chat
// ---------------------------------------------------------------------------

const singleTurnInput = {
  promptTokens: 4000,
  outputTokens: 800,
  prefillSpeed: 20000,
  decodeSpeed: 120,
  specEnabled: false,
  draftTokens: 0,
  acceptance: 0,
  effectiveDecodeSpeed: 120,
  deepLink: 'https://example.com/?tab=single',
  generatedAt: FIXED_AT
};

test('single-turn export carries versioned envelope and stable field names', () => {
  const out = buildSingleTurnJson(singleTurnInput);

  assert.equal(out.schemaVersion, EXPORT_JSON_VERSION);
  assert.equal(out.generator, GENERATOR_ID);
  assert.equal(out.exportType, 'single-turn-chat');
  assert.equal(out.generatedAt, FIXED_AT);
  assert.equal(out.deepLink, singleTurnInput.deepLink);

  // Stable input field names.
  assert.deepEqual(Object.keys(out.inputs).sort(), [
    'decodeSpeedTokPerSec',
    'outputTokens',
    'prefillSpeedTokPerSec',
    'promptTokens',
    'speculativeDecoding'
  ]);
  // Stable metric field names.
  assert.deepEqual(Object.keys(out.metrics).sort(), [
    'decodeSharePct',
    'decodeTimeSeconds',
    'effectiveDecodeSpeedTokPerSec',
    'prefillSharePct',
    'throughputTokPerSec',
    'totalWalltimeSeconds',
    'tpotMs',
    'ttftSeconds'
  ]);
});

test('single-turn export metrics match the markdown-export math', () => {
  const out = buildSingleTurnJson(singleTurnInput);
  const m = out.metrics;

  const ttft = 4000 / 20000;               // 0.2s
  const decodeTime = 800 / 120;
  const total = ttft + decodeTime;

  assert.equal(m.ttftSeconds, roundTo(ttft));
  assert.equal(m.decodeTimeSeconds, roundTo(decodeTime));
  assert.equal(m.totalWalltimeSeconds, roundTo(total));
  assert.equal(m.tpotMs, roundTo(1000 / 120, 4));
  assert.equal(m.throughputTokPerSec, roundTo(4800 / total, 2));
  // Walltime split sums to ~100%.
  assert.ok(Math.abs(m.prefillSharePct + m.decodeSharePct - 100) < 0.01);
});

test('single-turn export reports speculative decoding config when enabled', () => {
  const off = buildSingleTurnJson(singleTurnInput);
  assert.equal(off.inputs.speculativeDecoding.enabled, false);
  assert.equal(off.inputs.speculativeDecoding.draftTokens, 0);

  const on = buildSingleTurnJson({ ...singleTurnInput, specEnabled: true, draftTokens: 4, acceptance: 0.75 });
  assert.equal(on.inputs.speculativeDecoding.enabled, true);
  assert.equal(on.inputs.speculativeDecoding.draftTokens, 4);
  assert.equal(on.inputs.speculativeDecoding.acceptanceRate, 0.75);
});

test('single-turn export survives a JSON.stringify/parse round-trip', () => {
  const out = buildSingleTurnJson(singleTurnInput);
  const back = JSON.parse(serializeJson(out));
  assert.deepEqual(back, out);
});

test('serializeJson is deterministic for identical inputs', () => {
  const a = serializeJson(buildSingleTurnJson(singleTurnInput));
  const b = serializeJson(buildSingleTurnJson({ ...singleTurnInput }));
  assert.equal(a, b);
  assert.ok(a.endsWith('\n'));
});

// ---------------------------------------------------------------------------
// Agentic tool-loop
// ---------------------------------------------------------------------------

const agenticInput = {
  numTurns: 5,
  basePromptTokens: 3000,
  toolOutputTokensPerTurn: 1200,
  decodeTokensPerTurn: 300,
  enablePrefixCaching: true,
  prefillSpeed: 15000,
  decodeSpeed: 110,
  deepLink: 'https://example.com/?tab=agentic',
  generatedAt: FIXED_AT
};

test('agentic export carries versioned envelope, inputs, turns and summary', () => {
  const out = buildAgenticJson(agenticInput);

  assert.equal(out.schemaVersion, EXPORT_JSON_VERSION);
  assert.equal(out.generator, GENERATOR_ID);
  assert.equal(out.exportType, 'agentic-tool-loop');
  assert.equal(out.generatedAt, FIXED_AT);
  assert.equal(out.deepLink, agenticInput.deepLink);

  assert.equal(out.inputs.numTurns, 5);
  assert.equal(out.inputs.prefixCachingEnabled, true);
  assert.equal(out.turns.length, 5);
  assert.ok(Array.isArray(out.turns));

  const expected = Object.keys(buildAgenticJson(agenticInput)).sort();
  assert.deepEqual(expected, ['deepLink', 'exportType', 'generatedAt', 'generator', 'generatorId', 'inputs', 'schemaVersion', 'summary', 'turns']);
});

test('agentic per-turn rows match the timeline engine with stable names', () => {
  const out = buildAgenticJson(agenticInput);
  const timeline = calculateAgenticTimeline(agenticInput);

  assert.equal(out.turns.length, timeline.length);
  for (let i = 0; i < timeline.length; i++) {
    const row = out.turns[i];
    const t = timeline[i];
    assert.deepEqual(Object.keys(row).sort(), [
      'cumulativeWalltimeSeconds',
      'decodeTimeSeconds',
      'decodeTokens',
      'kvCacheReused',
      'newTokensPrefilled',
      'prefillTimeSeconds',
      'totalPromptTokens',
      'turn',
      'turnWalltimeSeconds'
    ].sort());
    assert.equal(row.turn, t.turn);
    assert.equal(row.totalPromptTokens, t.totalPromptTokens);
    assert.equal(row.newTokensPrefilled, t.newTokensPrefilled);
    assert.equal(row.kvCacheReused, t.isCached);
    assert.equal(row.turnWalltimeSeconds, roundTo(t.turnWalltime));
  }
  // Prefix caching kicks in from turn 2 onward.
  assert.equal(out.turns[0].kvCacheReused, false);
  assert.ok(out.turns.slice(1).every(r => r.kvCacheReused === true));
});

test('agentic summary aggregates the turn data', () => {
  const out = buildAgenticJson(agenticInput);
  const s = out.summary;

  const wallSum = out.turns.reduce((acc, t) => acc + t.turnWalltimeSeconds, 0);
  assert.ok(Math.abs(s.totalWalltimeSeconds - wallSum) < 0.001); // fp summation-order tolerant
  const last = out.turns[out.turns.length - 1];
  assert.equal(s.finalContextTokens, last.totalPromptTokens + last.decodeTokens);
  const tokSum = out.turns.reduce((acc, t) => acc + t.newTokensPrefilled + t.decodeTokens, 0);
  assert.equal(s.totalTokensProcessed, tokSum);
  // Caching must save time vs full re-prefill baseline.
  assert.ok(s.walltimeWithoutCachingSeconds > s.totalWalltimeSeconds);
  assert.ok(s.cachingTimeSavedSeconds > 0);
  assert.ok(s.cachingSavingsPct > 0 && s.cachingSavingsPct < 100);
});

test('agentic export with caching disabled reports zero caching savings', () => {
  const out = buildAgenticJson({ ...agenticInput, enablePrefixCaching: false });
  assert.equal(out.summary.walltimeWithoutCachingSeconds, out.summary.totalWalltimeSeconds);
  assert.equal(out.summary.cachingTimeSavedSeconds, 0);
  assert.equal(out.summary.cachingSavingsPct, 0);
  assert.ok(out.turns.every(r => r.kvCacheReused === false));
});

test('agentic export survives a JSON.stringify/parse round-trip', () => {
  const out = buildAgenticJson(agenticInput);
  const back = JSON.parse(JSON.stringify(out));
  assert.deepEqual(back, out);
});
