import test from 'node:test';
import assert from 'node:assert/strict';

// Issue #403: the A/B replay must produce a machine-readable artifact with
// raw values instead of display-only prose. Builders are pure.

import { buildAbMarkdown, buildAbJson } from './exportAb.js';

const ARGS = {
  presetA: { id: 'groq', name: 'Groq LLaMA-3.3 70B', prefillSpeed: 18000.4, decodeSpeed: 1200 },
  presetB: { id: 'rtx4090_exl2', name: 'RTX 4090 24GB (EXL2)', prefillSpeed: 3800, decodeSpeed: 105 },
  promptTokens: 2048,
  outputTokens: 512,
  ttftA: 0.1138,
  ttftB: 0.5389,
  decodeTimeA: 0.4267,
  decodeTimeB: 4.8762,
  totalA: 0.5405,
  totalB: 5.4151,
  deepLink: 'https://example.test/?tab=ab&abA=groq'
};

test('A/B markdown renders the per-lane table and verdict lines', () => {
  const md = buildAbMarkdown(ARGS);
  assert.match(md, /# A\/B replay comparison/);
  assert.match(md, /\| Hardware \| Groq LLaMA-3\.3 70B \| RTX 4090 24GB \(EXL2\) \|/);
  assert.match(md, /\| Total walltime \| 0\.54s \| 5\.42s \|/);
  assert.match(md, /Overall: 10\.02x faster/);
  assert.match(md, /First to finish: Groq LLaMA-3\.3 70B finishes first/);
  assert.match(md, /Reproduce: /);
});

test('A/B markdown is byte-identical for identical inputs', () => {
  assert.equal(buildAbMarkdown(ARGS), buildAbMarkdown(ARGS));
});

test('A/B JSON carries raw per-lane values + comparison verdicts', () => {
  const json = buildAbJson(ARGS);
  assert.equal(json.view, 'ab-replay');
  assert.equal(json.laneA.id, 'groq');
  assert.equal(json.laneA.ttftSeconds, 0.11);
  assert.equal(json.laneB.totalWalltimeSeconds, 5.42);
  assert.equal(json.comparison.overallVerdict, 'A-faster');
  assert.equal(json.comparison.ttftRatioBOverA, 4.74);
});

test('degenerate zero-speed lanes yield null metrics, not Infinity', () => {
  const json = buildAbJson({
    ...ARGS,
    ttftA: Infinity,
    decodeTimeA: Infinity,
    totalA: Infinity
  });
  assert.equal(json.laneA.totalWalltimeSeconds, null);
  assert.equal(json.comparison.overallSpeedup, null);
  assert.equal(json.comparison.overallVerdict, 'dead-heat');
});
