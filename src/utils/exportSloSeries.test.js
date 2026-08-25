// Export envelope additions: SLO verdict block (#425) + per-token series (#426).
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildSingleTurnJson,
  buildAgenticJson,
  buildSloExport,
  buildSeriesExport,
  MAX_SERIES_TOKENS
} from './exportJson.js';
import { buildSingleTurnMarkdown, buildAgenticMarkdown } from './exportMarkdown.js';
import { drawItlSamples } from './itl.js';

const BASE = {
  promptTokens: 2048,
  outputTokens: 512,
  prefillSpeed: 3800,
  decodeSpeed: 105,
  specEnabled: false,
  draftTokens: 4,
  acceptance: 0.7,
  effectiveDecodeSpeed: 105,
  deepLink: 'https://example.test/?prompt=2048'
};

const BUDGETS = { ttftMs: 500, tpotMs: 50, walltimeSec: 10 };

test('#425: no active budgets → export shape unchanged (no slo key)', () => {
  const payload = buildSingleTurnJson({ ...BASE });
  assert.equal(payload.slo, undefined);
  assert.deepEqual(Object.keys(payload), ['schemaVersion', 'generator', 'exportType', 'generatedAt', 'deepLink', 'inputs', 'metrics']);
});

test('#425: single-turn export carries budgets + pass/fail verdicts in ms', () => {
  const payload = buildSingleTurnJson({ ...BASE, sloBudgets: BUDGETS });
  // TTFT = 2048/3800 ≈ 539 ms > 500 → fail; TPOT ≈ 9.5 ms ≤ 50 → pass.
  assert.ok(payload.slo);
  assert.equal(payload.slo.budgets.ttftMs, 500);
  assert.equal(payload.slo.budgets.walltimeMs, 10000);
  const ttft = payload.slo.results.find(r => r.metric === 'ttft');
  assert.equal(ttft.pass, false);
  assert.equal(ttft.budgetMs, 500);
  const tpot = payload.slo.results.find(r => r.metric === 'tpot');
  assert.equal(tpot.pass, true);
  for (const r of payload.slo.results) {
    assert.equal(typeof r.valueMs, 'number');
    assert.equal(r.unit ?? 'ms', 'ms');
    assert.equal(typeof r.marginPct, 'number');
  }
});

test('#425: agentic export adds failingTurns/worstTurn matching evaluateAgenticSlo', () => {
  const payload = buildAgenticJson({
    numTurns: 4,
    basePromptTokens: 1500,
    toolOutputTokensPerTurn: 800,
    decodeTokensPerTurn: 250,
    enablePrefixCaching: true,
    prefillSpeed: 3800,
    decodeSpeed: 105,
    deepLink: '',
    generatedAt: '2026-08-25T00:00:00.000Z',
    sloBudgets: { ttftMs: 1, tpotMs: null, walltimeSec: null } // impossibly tight TTFT
  });
  assert.ok(payload.slo);
  assert.deepEqual(payload.slo.failingTurns, [1, 2, 3, 4]);
  assert.equal(payload.slo.worstTurn, 1);
});

test('#426: default export unchanged; ?series=1 adds deterministic capped timeline', () => {
  const base = buildSingleTurnJson({ ...BASE });
  assert.equal(base.series, undefined);

  const schedule = Array.from({ length: 512 }, (_, i) => (i + 1) * 9.5);
  const withSeries = buildSingleTurnJson({
    ...BASE,
    includeSeries: true,
    prefillEndMs: 538.947,
    itlScheduleMs: schedule
  });
  assert.equal(withSeries.series.tokenCount, 512);
  assert.equal(withSeries.series.tokens.length, 512);
  assert.equal(withSeries.series.tokens[0].i, 0);
  assert.equal(withSeries.series.tokens[0].itlMs, null);
  assert.equal(withSeries.series.tokens[1].itlMs, 9.5);
  // Deterministic: same inputs → identical series bytes.
  const again = buildSingleTurnJson({ ...BASE, includeSeries: true, prefillEndMs: 538.947, itlScheduleMs: schedule });
  assert.equal(JSON.stringify(again.series), JSON.stringify(withSeries.series));
});

test('#426: series truncates at MAX_SERIES_TOKENS and tolerates missing schedule', () => {
  const huge = buildSingleTurnJson({
    ...BASE,
    includeSeries: true,
    itlScheduleMs: Array.from({ length: MAX_SERIES_TOKENS + 500 }, (_, i) => i)
  });
  assert.equal(huge.series.tokens.length, MAX_SERIES_TOKENS);
  assert.equal(huge.series.tokenCount, MAX_SERIES_TOKENS + 500);
  assert.equal(buildSingleTurnJson({ ...BASE, includeSeries: true }).series, undefined);
  assert.equal(buildSeriesExport(0, []), undefined);
});

test('jittered ITL series flows through buildSeriesExport deterministically', () => {
  const samples = drawItlSamples({ baseMs: 9.5, cv: 0.25, count: 64, seed: 7 });
  let acc = 0;
  const schedule = samples.map(s => (acc += s));
  const a = buildSeriesExport(539, schedule);
  const b = buildSeriesExport(539, schedule);
  assert.equal(JSON.stringify(a), JSON.stringify(b));
  assert.equal(a.tokens.length, 64);
});

test('#425: markdown exports gain an SLO budgets table only when budgets are active', () => {
  const mdPlain = buildSingleTurnMarkdown(BASE);
  assert.ok(!mdPlain.includes('## SLO budgets'));
  const mdSlo = buildSingleTurnMarkdown({ ...BASE, sloBudgets: BUDGETS });
  assert.ok(mdSlo.includes('## SLO budgets'));
  assert.match(mdSlo, /\| TTFT \| \d+ ms \| 500 ms \| ✗ fail \|/);
  assert.match(mdSlo, /\| TPOT \| \d+ ms \| 50 ms \| ✓ pass \|/);

  const agenticMd = buildAgenticMarkdown({
    numTurns: 4,
    basePromptTokens: 1500,
    toolOutputTokensPerTurn: 800,
    decodeTokensPerTurn: 250,
    enablePrefixCaching: true,
    prefillSpeed: 3800,
    decodeSpeed: 105,
    deepLink: ''
  });
  assert.ok(!agenticMd.includes('## SLO budgets'));
});
