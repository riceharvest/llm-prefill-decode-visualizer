// Issue #442 (+#441's export half) — shortlist export builders: deterministic
// JSON/Markdown mirrors of the ranked shortlist so agents/AT can consume the
// recommendation surface without scraping styled divs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildShortlistJson, buildShortlistMarkdown, SHORTLIST_EXPORT_VERSION } from './shortlistExport.js';

const ROWS = [
  {
    rig: 'RTX 4090 24GB', modelFamily: 'llama', exampleModel: 'llama-3-8b',
    engine: 'llama.cpp', quantization: 'Q4_K_M', hwClass: 'DISCRETE_GPU',
    medianDecodeTokPerSec: 140.25, medianPrefillTokPerSec: 4200.5, bestDecodeTokPerSec: 150.1,
    runsInGroup: 4, source: 'https://example.com/run/1'
  },
  {
    rig: 'AMD Ryzen 7 9800X3D', modelFamily: 'stories-llama2-50k', engine: 'llama.cpp',
    quantization: 'F32', medianDecodeTokPerSec: 36716, medianPrefillTokPerSec: 471382,
    runsInGroup: 1
  }
];

const META = { filters: { minRunsInGroup: 2 }, matchedRuns: 42, excludedSingleRunGroups: 7, generatedAt: '2026-08-25T00:00:00.000Z' };

test('JSON export is deterministic and carries rank/sample provenance', () => {
  const a = buildShortlistJson({ rows: ROWS, ...META });
  const b = buildShortlistJson({ rows: ROWS, ...META });
  assert.equal(JSON.stringify(a), JSON.stringify(b)); // byte-stable
  assert.equal(a.schemaVersion, SHORTLIST_EXPORT_VERSION);
  assert.equal(a.exportType, 'hardware-shortlist');
  assert.equal(a.excludedSingleRunGroups, 7);
  assert.equal(a.results[0].rank, 1);
  assert.equal(a.results[0].singleRunGroup, false);
  assert.equal(a.results[1].singleRunGroup, true);
  assert.equal(a.results[0].medianDecodeTokPerSec, 140.25);
});

test('Markdown export renders a real table with an n=1 caveat marker (#441)', () => {
  const md = buildShortlistMarkdown({ rows: ROWS, ...META });
  const lines = md.split('\n');
  assert.match(lines[0], /# Find HW — ranked hardware shortlist/);
  assert.ok(md.includes('| # | Rig | Model family |'));
  const dataRows = lines.filter(l => l.startsWith('| ') && !l.includes('|---') && !l.includes('| # |'));
  assert.equal(dataRows.length, 2);
  assert.match(dataRows[0], /^\| 1 \| RTX 4090 24GB \| llama \|/);
  assert.match(dataRows[1], /stories-llama2-50k ⚠ n=1/);
  assert.match(md, /Excluded 7 single-run groups \(min sample size 2\)\./);
  // Pipe characters in values are escaped so the table can't break.
  const tricky = buildShortlistMarkdown({ rows: [{ ...ROWS[0], modelFamily: 'a|b' }], filters: {}, generatedAt: META.generatedAt });
  assert.ok(tricky.includes('a\\|b'));
});
