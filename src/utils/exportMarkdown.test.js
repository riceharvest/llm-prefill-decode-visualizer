import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildSingleTurnMarkdown,
  buildAgenticMarkdown
} from './exportMarkdown.js';

test('single-turn export substitutes formula values deterministically', () => {
  const md = buildSingleTurnMarkdown({
    promptTokens: 2048,
    outputTokens: 512,
    prefillSpeed: 3800,
    decodeSpeed: 105,
    specEnabled: false,
    draftTokens: 4,
    acceptance: 0.7,
    effectiveDecodeSpeed: 105,
    deepLink: 'https://example.test/?tab=single&prompt=2048'
  });

  assert.match(md, /TTFT   = prompt ÷ prefill        = 2048 ÷ 3800 = 0\.5389s/);
  assert.match(md, /Decode = output ÷ decode        = 512 ÷ 105 = 4\.8762s/);
  assert.match(md, /\| TTFT \(time to first token\) \| 538\.9 ms \|/);
  assert.match(md, /\| Total chat walltime \| 5\.42s \|/);
  assert.match(md, /https:\/\/example\.test\/\?tab=single&prompt=2048/);
  // Vanilla run must not claim speculative gains
  assert.doesNotMatch(md, /Speculative decoding\s*\|\s*ON/);

  // Same inputs → byte-identical markdown (deterministic export)
  const again = buildSingleTurnMarkdown({
    promptTokens: 2048,
    outputTokens: 512,
    prefillSpeed: 3800,
    decodeSpeed: 105,
    specEnabled: false,
    draftTokens: 4,
    acceptance: 0.7,
    effectiveDecodeSpeed: 105,
    deepLink: 'https://example.test/?tab=single&prompt=2048'
  });
  assert.equal(md, again);
});

test('single-turn export includes speculative decoding formulas when enabled', () => {
  const md = buildSingleTurnMarkdown({
    promptTokens: 1024,
    outputTokens: 256,
    prefillSpeed: 2000,
    decodeSpeed: 60,
    specEnabled: true,
    draftTokens: 4,
    acceptance: 0.7,
    effectiveDecodeSpeed: Math.round((60 / (1 + 4 * 0.2)) * (1 + 4 * 0.7)),
    deepLink: 'https://example.test/?tab=single&spec=1'
  });

  assert.match(md, /Speculative decoding \| ON \(k = 4, α = 0\.7\)/);
  assert.match(md, /tokens\/step = 1 \+ k·α = 1 \+ 4·0\.7 = 3\.80/);
});

test('single-turn export applies engine flags to inputs, sections and metrics (#698)', () => {
  const md = buildSingleTurnMarkdown({
    promptTokens: 2048,
    outputTokens: 512,
    prefillSpeed: 30000,
    decodeSpeed: 150,
    specEnabled: false,
    draftTokens: 0,
    acceptance: 0,
    effectiveDecodeSpeed: 150,
    ctxScaleEnabled: true,
    ctxHalf: 32768,
    imagesEnabled: true,
    imageCount: 2,
    imageResId: '1080p',
    jitterEnabled: true,
    jitterPct: 25,
    deepLink: 'https://example.test/?tab=single&img=1&ctx=1&jit=1'
  });

  // Input rows expose every active toggle — a reader can detect the features
  // from the payload alone.
  assert.match(md, /\| Attached images \| ON \(2 × 1080p · photo, 4,400 vision tok\) \|/);
  assert.match(md, /\| Context scaling \| ON \(C½ = 32,768 tok\) \|/);
  assert.match(md, /\| ITL jitter \| ON \(±25%\) \|/);
  // Per-feature walkthrough sections with feature-aware math.
  assert.match(md, /prefill tokens = prompt \+ vision = 2,048 \+ 4,400 = 6,448 tok/);
  assert.match(md, /TTFT\s+= 6,448 ÷ 30000 = 0\.2149s/);
  assert.match(md, /### Context scaling/);
  assert.match(md, /C½ = 32,768 tok\./);
  assert.match(md, /### ITL jitter/);
  // Final metrics reflect the flag-aware run (flag-blind TTFT would be 0.0683s).
  assert.match(md, /\| TTFT \(time to first token\) \| 214\.9 ms \|/);
  assert.match(md, /matching the on-page run for this exact configuration/);

  // Deterministic: same inputs → byte-identical output.
  const again = buildSingleTurnMarkdown({
    promptTokens: 2048,
    outputTokens: 512,
    prefillSpeed: 30000,
    decodeSpeed: 150,
    specEnabled: false,
    draftTokens: 0,
    acceptance: 0,
    effectiveDecodeSpeed: 150,
    ctxScaleEnabled: true,
    ctxHalf: 32768,
    imagesEnabled: true,
    imageCount: 2,
    imageResId: '1080p',
    jitterEnabled: true,
    jitterPct: 25,
    deepLink: 'https://example.test/?tab=single&img=1&ctx=1&jit=1'
  });
  assert.equal(md, again);
});

test('agentic export lists every turn in the waterfall table', () => {
  const md = buildAgenticMarkdown({
    numTurns: 3,
    basePromptTokens: 1500,
    toolOutputTokensPerTurn: 800,
    decodeTokensPerTurn: 250,
    enablePrefixCaching: true,
    prefillSpeed: 3800,
    decodeSpeed: 105,
    deepLink: 'https://example.test/?tab=agentic&turns=3'
  });

  for (const turn of ['T1', 'T2', 'T3']) {
    assert.ok(md.includes(`| ${turn} |`), `missing waterfall row ${turn}`);
  }
  assert.ok(!md.includes('| T4 |'));

  // Turn 1 is a full ingest; cached turns only prefill the tool output
  assert.match(md, /\| T1 \| full ingest \| 1,500 \| 1,500 \|/);
  assert.match(md, /\| T2 \| cached ⚡ \| 2,550 \| 800 \|/);
  assert.match(md, /prefill_time\(T2\) = 800 ÷ 3800 = 0\.2105s/);
  assert.match(md, /Caching savings \|/);
});

test('agentic export without caching reports no caching savings', () => {
  const md = buildAgenticMarkdown({
    numTurns: 2,
    basePromptTokens: 1000,
    toolOutputTokensPerTurn: 500,
    decodeTokensPerTurn: 100,
    enablePrefixCaching: false,
    prefillSpeed: 1000,
    decodeSpeed: 50,
    deepLink: 'https://example.test/?tab=agentic&cache=0'
  });

  assert.match(md, /Prefix caching \| OFF \(full re-prefill\)/);
  assert.match(md, /Caching savings \| — \(caching off\)/);
  assert.ok(!md.includes('cached ⚡'));
});
