import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { calculateAgenticTimeline, waterfallGeometry, waterfallSegmentLabels, WATERFALL_LABEL_MIN_PERCENT } from './agenticMath.js';

test('cached turns prefill only newly appended tool output', () => {
  const turns = calculateAgenticTimeline({
    numTurns: 2,
    basePromptTokens: 100,
    toolOutputTokensPerTurn: 50,
    decodeTokensPerTurn: 100,
    prefillSpeed: 100,
    decodeSpeed: 50,
    enablePrefixCaching: true
  });

  assert.deepEqual(
    turns.map((turn) => ({
      newTokensPrefilled: turn.newTokensPrefilled,
      prefillTime: turn.prefillTime,
      turnWalltime: turn.turnWalltime,
      cumulativeWalltime: turn.cumulativeWalltime
    })),
    [
      { newTokensPrefilled: 100, prefillTime: 1, turnWalltime: 3, cumulativeWalltime: 3 },
      { newTokensPrefilled: 50, prefillTime: 0.5, turnWalltime: 2.5, cumulativeWalltime: 5.5 }
    ]
  );
});

test('waterfall geometry positions each turn after the previous turn', () => {
  const geometry = waterfallGeometry([
    { prefillTime: 1, turnWalltime: 3, cumulativeWalltime: 3 },
    { prefillTime: 0.5, turnWalltime: 2.5, cumulativeWalltime: 5.5 }
  ]);

  assert.equal(geometry[0].leftPercent, 0);
  assert.ok(Math.abs(geometry[0].widthPercent - (300 / 5.5)) < 1e-12);
  assert.ok(Math.abs(geometry[0].prefillPercent - (100 / 3)) < 1e-12);
  assert.ok(Math.abs(geometry[1].leftPercent - (300 / 5.5)) < 1e-12);
  assert.ok(Math.abs(geometry[1].widthPercent - (250 / 5.5)) < 1e-12);
  assert.equal(geometry[1].prefillPercent, 20);
});

test('waterfall geometry exposes absolute seconds so the chart is self-describing (#591)', () => {
  const geometry = waterfallGeometry([
    { prefillTime: 1, decodeTime: 2, turnWalltime: 3, cumulativeWalltime: 3 },
    { prefillTime: 0.5, decodeTime: 2, turnWalltime: 2.5, cumulativeWalltime: 5.5 }
  ]);

  assert.equal(geometry[0].startSeconds, 0);
  assert.equal(geometry[0].durationSeconds, 3);
  assert.equal(geometry[0].prefillSeconds, 1);
  assert.equal(geometry[0].decodeSeconds, 2);

  assert.ok(Math.abs(geometry[1].startSeconds - 3) < 1e-12);
  assert.equal(geometry[1].durationSeconds, 2.5);
  assert.equal(geometry[1].prefillSeconds, 0.5);
  assert.equal(geometry[1].decodeSeconds, 2);

  // start + duration must reconstruct the loop total — that's the property a
  // scraper needs to convert percent bars to absolute time.
  const total = geometry.reduce((sum, g) => sum + g.durationSeconds, 0);
  assert.ok(Math.abs(total - 5.5) < 1e-12);
});

test('live progress bars do not restart CSS width transitions every animation frame', async () => {
  const source = await readFile(new URL('../components/AgenticVisualizer.jsx', import.meta.url), 'utf8');

  assert.doesNotMatch(source, /transition:\s*'width 0\.1s linear'/);
});

// ---- Issue #495: suppressed waterfall segment labels must stay visible ----

test('#495: labels fit inline when both segments are wide enough', () => {
  const l = waterfallSegmentLabels(50);
  assert.equal(l.prefillInline, true);
  assert.equal(l.decodeInline, true);
  assert.equal(l.needsTextFallback, false);
  assert.deepEqual(l.hiddenSegments, []);
});

test('#495: narrow prefill segment (default cached turn ~14.2%) hides its inline label but keeps the value as text fallback', () => {
  // Default RTX 4090 turn 1 from the issue: prefill 0.395s of a 2.776s turn.
  const l = waterfallSegmentLabels(14.2);
  assert.equal(l.prefillInline, false);
  assert.equal(l.decodeInline, true);
  assert.deepEqual(l.hiddenSegments, ['prefill']);
  assert.equal(l.needsTextFallback, true);
});

test('#495: long-history caching-off config can instead suppress decode', () => {
  const l = waterfallSegmentLabels(90);
  assert.equal(l.prefillInline, true);
  assert.equal(l.decodeInline, false);
  assert.deepEqual(l.hiddenSegments, ['decode']);
});

test('#495: non-numeric ratio is treated as 0 rather than NaN', () => {
  const l = waterfallSegmentLabels(undefined);
  assert.equal(l.prefillInline, false);
  assert.equal(l.decodeInline, true);
  assert.ok(Number.isFinite(WATERFALL_LABEL_MIN_PERCENT));
});

test('#495: AgenticVisualizer renders segment values via waterfallSegmentLabels with a text fallback (no tooltip-only suppression)', async () => {
  const source = await readFile(new URL('../components/AgenticVisualizer.jsx', import.meta.url), 'utf8');

  // The old bare threshold checks are gone…
  assert.doesNotMatch(source, /prefillRatio > 15 &&/);
  assert.doesNotMatch(source, /\(100 - prefillRatio\) > 15 &&/);
  // …replaced by the shared helper + a visible text fallback in the row.
  assert.match(source, /waterfallSegmentLabels\(prefillRatio\)/);
  assert.match(source, /labels\.needsTextFallback/);
});

test('waterfall rows carry per-row absolute-time data attributes + an in-chart scale (#591)', async () => {
  const source = await readFile(new URL('../components/AgenticVisualizer.jsx', import.meta.url), 'utf8');

  for (const attr of ['data-turn=', 'data-start-seconds=', 'data-duration-seconds=', 'data-prefill-seconds=', 'data-decode-seconds=']) {
    assert.ok(source.includes(attr), `missing ${attr} on waterfall rows`);
  }
  assert.ok(source.includes('data-total-walltime-seconds='), 'missing total-scale marker inside the chart');
});
