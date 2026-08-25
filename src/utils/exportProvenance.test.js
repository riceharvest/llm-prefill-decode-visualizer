// #602 — export builders embed the provenance block only when one is passed,
// so synthetic-preset exports stay byte-identical while lmx: exports carry
// measurement provenance.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSingleTurnJson, serializeJson } from './exportJson.js';
import { buildSingleTurnMarkdown } from './exportMarkdown.js';

const BASE = {
  promptTokens: 2048,
  outputTokens: 512,
  prefillSpeed: 10000,
  decodeSpeed: 3.4782,
  specEnabled: false,
  draftTokens: 4,
  acceptance: 0.7,
  effectiveDecodeSpeed: 3.4782,
  deepLink: 'https://x/?prefill=10000',
  generatedAt: '2026-08-24T00:00:00.000Z'
};

const PROVENANCE = {
  presetId: 'lmx:abc123',
  runId: 'abc123',
  modelId: 'Qwen/Qwen3.6-27B',
  quantization: 'q4_k_m',
  engine: 'llama.cpp',
  engineVersion: 'b6000',
  measuredAt: '2026-08-20T00:00:00.000Z',
  ageDays: 4,
  staleness: 'fresh',
  sourceUrl: 'https://localmaxxing.com/en/runs/abc123',
  kind: 'community-measured'
};

test('#602: JSON export embeds the provenance block when present', () => {
  const out = buildSingleTurnJson({ ...BASE, provenance: PROVENANCE });
  assert.deepEqual(out.provenance, PROVENANCE);
});

test('#602: JSON export without provenance is unchanged (byte-stable contract)', () => {
  const out = buildSingleTurnJson(BASE);
  assert.equal('provenance' in out, false);
  // Round-trip through the serializer to prove byte-stability.
  const bytes = serializeJson(out);
  assert.equal(bytes, serializeJson(buildSingleTurnJson(BASE)));
  assert.equal(bytes.includes('provenance'), false);
});

test('#602: Markdown export renders a Measured-provenance section for lmx runs', () => {
  const md = buildSingleTurnMarkdown({ ...BASE, provenance: PROVENANCE });
  assert.ok(md.includes('### Measured provenance'));
  assert.ok(md.includes(PROVENANCE.runId));
  assert.ok(md.includes('community-measured') || md.includes('Community-measured'));
  assert.ok(md.includes(PROVENANCE.sourceUrl));
});

test('#602: Markdown export has no provenance section for synthetic presets', () => {
  const md = buildSingleTurnMarkdown(BASE);
  assert.equal(md.includes('Measured provenance'), false);
});
