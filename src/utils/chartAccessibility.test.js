import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildKvMatrixSummary,
  needsStackedBarLegend,
  STACKED_BAR_LABEL_THRESHOLD
} from './chartAccessibility.js';

test('append variant reports written-row count matching the discrete rendering (#922)', () => {
  // 37 of 48 cells lit: appendedRows = floor(0.77 * 14) = 10 of 14.
  const summary = buildKvMatrixSummary({
    title: 'Decode cache',
    variant: 'append',
    fillFrac: 0.77,
    appendedRows: 10,
    totalRows: 14,
    cachedFracOfFill: 0
  });
  assert.match(summary, /^Decode cache: 10 of 14 cache rows written(; newest row still appending)?$/);
  assert.ok(!summary.includes('%'), 'append variant must not use a fill percentage that disagrees with row flips');
});

test('parallel variant keeps the fill-percentage phrasing', () => {
  const summary = buildKvMatrixSummary({
    title: 'Prefill cache',
    variant: 'parallel',
    fillFrac: 0.4286,
    totalRows: 14
  });
  assert.equal(summary, 'Prefill cache: 43% of 14 cache rows filled');
});

test('newest-row-appending marker only appears mid-animation (#922)', () => {
  const mid = buildKvMatrixSummary({
    title: 'T', variant: 'append', fillFrac: 0.5, appendedRows: 7, totalRows: 14
  });
  assert.match(mid, /newest row still appending/);

  const done = buildKvMatrixSummary({
    title: 'T', variant: 'append', fillFrac: 1, appendedRows: 14, totalRows: 14
  });
  assert.ok(!done.includes('appending'));

  const empty = buildKvMatrixSummary({
    title: 'T', variant: 'append', fillFrac: 0, appendedRows: 0, totalRows: 14
  });
  assert.ok(!empty.includes('appending'));
});

test('prefix-cache-hit share is included when cached tokens exist (#922)', () => {
  const withCache = buildKvMatrixSummary({
    title: 'T', variant: 'parallel', fillFrac: 0.8, totalRows: 14, cachedFracOfFill: 0.625
  });
  assert.match(withCache, /63% of written tokens are prefix-cache hits/);

  const noCache = buildKvMatrixSummary({
    title: 'T', variant: 'parallel', fillFrac: 0.8, totalRows: 14, cachedFracOfFill: 0
  });
  assert.ok(!noCache.includes('prefix-cache'));
});

test('summary clamps out-of-range fractions defensively', () => {
  const summary = buildKvMatrixSummary({
    title: 'T', variant: 'parallel', fillFrac: 5, totalRows: 14, cachedFracOfFill: -2
  });
  assert.equal(summary, 'T: 100% of 14 cache rows filled');
});

test('legend needed when either stacked-bar phase is at/below label threshold (#923)', () => {
  assert.equal(needsStackedBarLegend(92, 8), true);
  assert.equal(needsStackedBarLegend(7.9, 92.1), true);
  assert.equal(needsStackedBarLegend(50, 50), false);
  assert.equal(needsStackedBarLegend(91, 9), false);
  assert.equal(STACKED_BAR_LABEL_THRESHOLD, 8);
});
