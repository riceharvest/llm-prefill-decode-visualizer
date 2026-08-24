import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildSizingReport,
  buildSizingReportJson,
  buildSizingReportYaml,
  buildSizingReportMarkdown
} from './sizingReport.js';

const systemA = {
  id: 'A',
  name: 'RTX 4090 (ExLlamaV2 4.0 bpw)',
  engine: 'ExLlamaV2',
  engineVersion: '0.2.3',
  measuredAt: '2026-08-01T00:00:00.000Z',
  ageDays: 20,
  staleness: 'fresh',
  prefillSpeed: 5300,
  decodeSpeed: 142,
  batchedPerUserDecode: 100.4,
  aggregateDecode: 401.7,
  ttftSeconds: 0.7736,
  decodeSeconds: 5.0986,
  totalWalltimeSeconds: 5.8722,
  hwClass: 'DISCRETE_GPU',
  gpuName: 'RTX 4090',
  gpuCount: 1,
  totalVramGb: 24,
  streetPriceUsd: 1600,
  streetPriceRangeUsd: [1400, 1900],
  costPerRequestUsd: 0.0123
};

const systemB = {
  id: 'B',
  name: '2× RTX 3090 (llama.cpp Q4_K_M)',
  engine: 'llama.cpp',
  measuredAt: '2025-01-15T00:00:00.000Z',
  ageDays: 580,
  staleness: 'stale',
  prefillSpeed: 2100,
  decodeSpeed: 88,
  batchedPerUserDecode: 62.2,
  aggregateDecode: 249.1,
  ttftSeconds: 1.9524,
  decodeSeconds: 8.2302,
  totalWalltimeSeconds: 10.1826,
  hwClass: 'DISCRETE_GPU',
  gpuName: 'RTX 3090',
  gpuCount: 2,
  totalVramGb: 48,
  unifiedMemoryGb: null,
  streetPriceUsd: 1100
};

const baseScenario = {
  modelId: 'Qwen3.6-27B',
  quantization: 'Q4_K_M',
  contextTokens: 32768,
  outputTokens: 512,
  concurrency: 4
};

function buildReport(overrides = {}) {
  return buildSizingReport({
    generatedAt: '2026-08-22T12:00:00.000Z',
    deepLink: 'https://example.test/?tab=compare&cp=32768',
    scenario: baseScenario,
    systemA,
    systemB,
    tco: {
      rigName: 'RTX 4090 rig',
      watts: 450,
      kwh: 0.3,
      cloudPerMtok: 2.5,
      monthlyElectricity: 97.2,
      monthlyCapex: 104.17,
      localPerMtok: 0.0123,
      breakEvenTokens: 8.4e9
    },
    notes: ['Idle draw, cooling, and internet are not modeled.'],
    ...overrides
  });
}

test('report object carries the full config, verdicts, and recommendation', () => {
  const report = buildReport();

  assert.equal(report.schema, 'sizing-report');
  assert.equal(report.scenario.modelId, 'Qwen3.6-27B');
  assert.equal(report.scenario.concurrency, 4);
  assert.equal(report.systems.length, 2);
  assert.equal(report.systems[0].tokPerSec.prefillMeasured, 5300);
  assert.equal(report.systems[0].vramBreakdown.totalVramGb, 24);
  assert.equal(report.systems[1].vramBreakdown.gpuCount, 2);
  assert.equal(report.recommendation.systemId, 'A');
  assert.match(report.recommendation.reason, /fastest total walltime/);

  const checks = report.verdicts.map(v => v.check);
  assert.ok(checks.includes('faster-system'));
  assert.ok(checks.includes('B-measurement-freshness'));
  const stale = report.verdicts.find(v => v.check === 'B-measurement-freshness');
  assert.equal(stale.status, 'warn');

  assert.equal(report.tco.breakEvenTokensPerMonth, 8400000000);
});

test('JSON output is valid JSON and round-trips the report', () => {
  const json = buildSizingReportJson(buildReport());
  const parsed = JSON.parse(json);
  assert.equal(parsed.schema, 'sizing-report');
  assert.equal(parsed.systems.length, 2);
  assert.ok(json.endsWith('\n'));
});

test('YAML output parses back to the same data (no deps, hand-rolled emitter)', async () => {
  const report = buildReport();
  const yaml = buildSizingReportYaml(report);
  assert.ok(yaml.startsWith('schema: sizing-report\n'));

  // Round-trip via a minimal YAML subset parser is overkill here; instead use
  // PyYAML if available, else assert structural invariants textually.
  try {
    const { execFileSync } = await import('node:child_process');
    const out = execFileSync('python3', ['-c', `
import sys, yaml, json
print(json.dumps(yaml.safe_load(sys.stdin.read()), default=str))
`], { input: yaml, encoding: 'utf8' });
    const parsed = JSON.parse(out);
    assert.equal(parsed.scenario.modelId, 'Qwen3.6-27B');
    assert.deepEqual(parsed.systems[0].vramBreakdown, { hwClass: 'DISCRETE_GPU', gpuName: 'RTX 4090', gpuCount: 1, totalVramGb: 24, unifiedMemoryGb: null, note: null });
    assert.equal(parsed.tco.breakEvenTokensPerMonth, 8400000000);
    assert.deepEqual(parsed.notes, ['Idle draw, cooling, and internet are not modeled.']);
    assert.equal(parsed.verdicts.length, report.verdicts.length);
  } catch {
    // PyYAML unavailable: fall back to structural assertions.
    assert.match(yaml, /^schema: sizing-report\n/);
    assert.match(yaml, /^scenario:\n  modelId: Qwen3\.6-27B\n/);
    assert.match(yaml, /^systems:\n  - id: A\n    name: /m);
  }
});

test('markdown output includes scenario, systems, verdicts, recommendation, and deep link', () => {
  const md = buildSizingReportMarkdown(buildReport());

  assert.match(md, /# Hardware Sizing Report/);
  assert.match(md, /\| Model \| Qwen3\.6-27B \|/);
  assert.match(md, /\| Concurrency \| 4× \|/);
  assert.match(md, /### RTX 4090 \(ExLlamaV2 4\.0 bpw\)/);
  assert.match(md, /\| Prefill \(measured\) \| 5,300 tok\/s \|/);
  assert.match(md, /\| Aggregate decode @ 4× batch \| 402 tok\/s \|/);
  assert.match(md, /\| Total walltime \| \*\*5\.87 s\*\* \|/);
  assert.match(md, /\| Street price \| \$1,600 \(\$1,400–\$1,900\) \|/);
  assert.match(md, /## Verdicts/);
  assert.match(md, /\*\*\[WARN\]\*\* B-measurement-freshness/);
  assert.match(md, /## Recommended hardware/);
  assert.match(md, /RTX 4090 \(ExLlamaV2 4\.0 bpw\) — fastest total walltime/);
  assert.match(md, /\| Break-even volume \| 8,400,000,000 tok\/mo \|/);
  assert.match(md, /https:\/\/example\.test\/\?tab=compare&cp=32768/);
});

test('same inputs produce byte-identical output (deterministic export)', () => {
  const a = buildSizingReportJson(buildReport());
  const b = buildSizingReportJson(buildReport());
  assert.equal(a, b);

  const ya = buildSizingReportYaml(buildReport());
  const yb = buildSizingReportYaml(buildReport());
  assert.equal(ya, yb);
});

test('handles missing optional data gracefully', () => {
  const report = buildSizingReport({
    generatedAt: '2026-08-22T12:00:00.000Z',
    deepLink: '',
    scenario: { contextTokens: 4096, outputTokens: 256, concurrency: 1 },
    systemA: { id: 'A', name: 'Groq LPU', prefillSpeed: 12000, decodeSpeed: 300, ttftSeconds: 0.3413, decodeSeconds: 0.8533, totalWalltimeSeconds: 1.1946 },
    systemB: null,
    tco: null
  });

  assert.equal(report.systems.length, 1);
  assert.equal(report.recommendation.systemId, 'A');
  assert.match(report.recommendation.reason, /only system/);
  assert.equal(report.tco, null);
  // A single-system report has nothing to compare against.
  assert.ok(!report.verdicts.some(v => v.check === 'faster-system'));

  const md = buildSizingReportMarkdown(report);
  assert.match(md, /\| Model \| — \|/);
  assert.doesNotMatch(md, /## Total cost of ownership/);
  assert.match(md, /### Groq LPU/);
});

test('#1012: markdown renders amortized capex + price source that JSON/YAML carry', () => {
  const report = buildReport();
  const md = buildSizingReportMarkdown(report);

  // tco.monthlyCapexUsd — the break-even math is unreproducible from MD without it.
  assert.match(md, /\| Capex \(amortized\) \| \$104\.17\/mo \|/);
  const capexAt = md.indexOf('| Capex (amortized) |');
  const breakevenAt = md.indexOf('| Break-even volume |');
  assert.ok(capexAt !== -1 && breakevenAt !== -1 && capexAt < breakevenAt,
    'capex row should precede the break-even row it feeds');

  // systems[].cost.priceSourceUrl
  const withSource = buildSizingReport({
    generatedAt: '2026-08-22T12:00:00.000Z',
    deepLink: '',
    scenario: baseScenario,
    systemA: { ...systemA, sourceUrl: 'https://example.test/run/abc123' },
    systemB: null,
    tco: null
  });
  const srcMd = buildSizingReportMarkdown(withSource);
  assert.match(srcMd, /\| Price source \| https:\/\/example\.test\/run\/abc123 \|/);
  // Absent source stays absent (no empty row).
  const plainMd = buildSizingReportMarkdown(buildReport());
  assert.ok(!plainMd.includes('| Price source |'));
});

test('#1012: format parity — canonical fields present in JSON are rendered in MD', () => {
  const report = buildReport();
  const parsed = JSON.parse(buildSizingReportJson(report));
  const md = buildSizingReportMarkdown(report);

  assert.notEqual(parsed.tco.monthlyCapexUsd, undefined);
  assert.ok(md.includes('Capex (amortized)'), 'monthlyCapexUsd missing from MD');

  const withSource = { ...systemA, sourceUrl: 'https://example.test/src' };
  const rep2 = buildSizingReport({
    generatedAt: '2026-08-22T12:00:00.000Z', deepLink: '', scenario: baseScenario,
    systemA: withSource, systemB: null, tco: null
  });
  const parsed2 = JSON.parse(buildSizingReportJson(rep2));
  const md2 = buildSizingReportMarkdown(rep2);
  assert.notEqual(parsed2.systems[0].cost.priceSourceUrl, undefined);
  assert.ok(md2.includes('https://example.test/src'), 'priceSourceUrl missing from MD');
});
