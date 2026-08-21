import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FRESH_DAYS,
  AGING_DAYS,
  ageInDays,
  stalenessTier,
  parseMaxAgeParam,
  filterByMaxAge,
  decorateRun,
  groupFreshness,
  majorReleaseWarnings
} from './_freshness.js';

// Fixed "now" so tier math is deterministic.
const NOW = new Date('2026-08-21T12:00:00.000Z');
const daysAgo = n => new Date(NOW.getTime() - n * 86400000).toISOString();

test('staleness tiers: fresh <90d, aging <1y, stale ≥1y', () => {
  assert.equal(FRESH_DAYS, 90);
  assert.equal(AGING_DAYS, 365);
  assert.equal(stalenessTier(ageInDays(daysAgo(0), NOW)), 'fresh');
  assert.equal(stalenessTier(ageInDays(daysAgo(89), NOW)), 'fresh');
  assert.equal(stalenessTier(ageInDays(daysAgo(90), NOW)), 'aging');
  assert.equal(stalenessTier(ageInDays(daysAgo(364), NOW)), 'aging');
  assert.equal(stalenessTier(ageInDays(daysAgo(365), NOW)), 'stale');
  assert.equal(stalenessTier(null), 'unknown');
  assert.equal(stalenessTier('not-a-number'), 'unknown');
});

test('ageInDays returns null for missing or unparseable dates', () => {
  assert.equal(ageInDays(undefined, NOW), null);
  assert.equal(ageInDays('', NOW), null);
  assert.equal(ageInDays('garbage', NOW), null);
  assert.equal(ageInDays(daysAgo(10), NOW), 10);
});

test('parseMaxAgeParam accepts positive numbers only', () => {
  assert.equal(parseMaxAgeParam('30'), 30);
  assert.equal(parseMaxAgeParam('90'), 90);
  assert.equal(parseMaxAgeParam(7), 7);
  assert.equal(parseMaxAgeParam('0'), null);
  assert.equal(parseMaxAgeParam('-5'), null);
  assert.equal(parseMaxAgeParam('abc'), null);
  assert.equal(parseMaxAgeParam(undefined), null);
});

test('filterByMaxAge keeps recent runs and drops old or undated ones', () => {
  const runs = [
    { id: 'a', createdAt: daysAgo(10) },
    { id: 'b', createdAt: daysAgo(100) },
    { id: 'c', createdAt: daysAgo(400) },
    { id: 'd' } // undated: unverifiable freshness must not pass
  ];
  const filtered = filterByMaxAge(runs, 90, NOW);
  assert.deepEqual(filtered.map(r => r.id), ['a']);
  // No max_age → unchanged
  assert.equal(filterByMaxAge(runs, null, NOW).length, 4);
});

test('decorateRun stamps ageDays and staleness per run', () => {
  const decorated = decorateRun({ id: 'x', createdAt: daysAgo(200) }, NOW);
  assert.equal(decorated.ageDays, 200);
  assert.equal(decorated.staleness, 'aging');
  assert.equal(decorateRun({ id: 'y' }, NOW).staleness, 'unknown');
});

test('groupFreshness reports window, newest age, engine versions', () => {
  const runs = [
    { createdAt: daysAgo(30), engineVersion: 'b5000' },
    { createdAt: daysAgo(300), engineVersion: 'b4200' },
    { createdAt: daysAgo(30), engineVersion: 'b5000' }, // duplicate version
    { createdAt: daysAgo(50), engineVersion: null }
  ];
  const f = groupFreshness(runs, NOW);
  assert.equal(f.newestRunAt, daysAgo(30));
  assert.equal(f.oldestRunAt, daysAgo(300));
  assert.equal(f.newestAgeDays, 30);
  assert.equal(f.staleness, 'fresh');
  assert.deepEqual(f.engineVersions, ['b5000', 'b4200']);
  // Empty group → all unknown
  const empty = groupFreshness([], NOW);
  assert.equal(empty.staleness, 'unknown');
  assert.equal(empty.newestRunAt, null);
});

test('majorReleaseWarnings flags groups whose newest run predates a boundary', () => {
  const releases = [{ engine: 'vLLM', version: 'V1', date: '2026-01-01', note: 'rewrite' }];
  const oldRuns = [{ engine: 'vLLM', createdAt: '2025-06-01T00:00:00.000Z' }];
  const warnings = majorReleaseWarnings(oldRuns, NOW, releases);
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0].engine, 'vLLM');
  assert.equal(warnings[0].releaseVersion, 'V1');
  assert.match(warnings[0].message, /predates vLLM V1/);

  // Runs after the boundary → no warning
  const freshRuns = [{ engine: 'vLLM', createdAt: '2026-03-01T00:00:00.000Z' }];
  assert.deepEqual(majorReleaseWarnings(freshRuns, NOW, releases), []);

  // Other engines are untouched by the boundary entry
  assert.deepEqual(majorReleaseWarnings([{ engine: 'llama.cpp', createdAt: '2024-01-01T00:00:00.000Z' }], NOW, releases), []);
});

test('aggregate-level freshness flows through groupFreshness warnings', () => {
  const runs = [{ engine: 'vLLM', createdAt: '2024-12-01T00:00:00.000Z', engineVersion: '0.6.1' }];
  const f = groupFreshness(runs, NOW);
  assert.equal(f.staleness, 'stale');
  assert.equal(f.majorReleaseWarnings.length, 1); // default MAJOR_ENGINE_RELEASES includes vLLM V1
});
