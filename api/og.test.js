import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseOgParams, cacheKeyFor, estimateLatencies, formatSpeed,
  buildBars, buildChartElement
} from './handlers/og.js';

function sp(entries) {
  return new URLSearchParams(entries);
}

test('parseOgParams resolves known preset ids to their names and defaults', () => {
  const cfg = parseOgParams(sp({ preset: 'dual_rtx3090' }));
  assert.equal(cfg.preset.id, 'dual_rtx3090');
  assert.equal(cfg.prefill, 4600);
  assert.equal(cfg.decode, 78);
  assert.ok(cfg.scenarioLabel.length > 0);
  assert.ok(cfg.promptTokens > 0);
});

test('parseOgParams falls back like the URL loader for unknown preset ids', () => {
  const cfg = parseOgParams(sp({ preset: 'not-a-real-gpu' }));
  assert.equal(cfg.preset.id, 'rtx4090_exl2');
});

test('parseOgParams honors explicit speed params and clamps garbage', () => {
  const cfg = parseOgParams(sp({ prefill: '12345', decode: '-7', scenario: 'rag' }));
  assert.equal(cfg.prefill, 12345);
  // Invalid decode falls back to the selected preset's default
  assert.equal(cfg.decode, cfg.preset.decodeSpeed);
  // RAG scenario swaps the workload shape used for TTFT
  assert.equal(cfg.promptTokens, 4096);
});

test('cacheKeyFor is stable and param-order independent', () => {
  const cfg = parseOgParams(sp({ preset: 'h100', prefill: '9500', decode: '130' }));
  const sameViaDefaults = parseOgParams(sp({ preset: 'h100', decode: '130', prefill: '9500' }));
  assert.equal(cacheKeyFor(cfg), cacheKeyFor(sameViaDefaults));
  const other = parseOgParams(sp({ preset: 'h100', decode: '131' }));
  assert.notEqual(cacheKeyFor(cfg), cacheKeyFor(other));
});

test('estimateLatencies matches TTFT=prompt/prefill and TPOT=1000/decode', () => {
  const { ttftMs, tpotMs } = estimateLatencies(2048, 128, 2048);
  assert.equal(ttftMs, 1000);   // 2048 tok / 2048 tok/s = 1s prefill
  assert.equal(tpotMs, 7.81);   // 1000ms / 128 tok/s
});

test('formatSpeed groups thousands', () => {
  assert.equal(formatSpeed(18000), '18,000');
  assert.equal(formatSpeed(105), '105');
});

test('buildBars sorts by value, scales pct, and highlights only the shared preset', () => {
  const bars = buildBars('rpi5', 8);
  assert.equal(bars[0].id, 'groq');           // fastest decode first
  assert.ok(bars.length <= 6);                // chart fits the card height
  assert.ok(bars.some(b => b.id === 'rpi5')); // shared preset always visible
  assert.ok(bars.every(b => b.pct >= 4 && b.pct <= 100));
  assert.deepEqual(bars.filter(b => b.highlight).map(b => b.id), ['rpi5']);
});

test('buildBars substitutes the custom row with the shared decode speed', () => {
  const bars = buildBars('custom', 42);
  assert.equal(bars.find(b => b.id === 'custom').value, 42);
  assert.equal(bars.find(b => b.id === 'custom').highlight, true);
});

test('buildChartElement embeds hardware name, speeds, latencies and bars', () => {
  const cfg = parseOgParams(sp({ preset: 'rtx3090_llamacpp', prompt: '1024' }));
  const el = buildChartElement(cfg);
  const json = JSON.stringify(el);
  assert.equal(el.type, 'div');
  assert.match(json, /RTX 3090/);
  assert.match(json, /2,400 tok\/s/);   // prefill headline
  assert.match(json, /65 tok\/s/);      // decode headline
  assert.match(json, /TPOT/);
  // One highlighted bar per card
  assert.equal(JSON.stringify(el).match(/#38bdf8/g).length, 1);
});
