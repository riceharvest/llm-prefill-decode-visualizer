import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PRICES_AS_OF,
  matchGpu,
  matchUnified,
  retailerLinks,
  estimateStreetPrice,
  estimateFromLabel
} from './streetPricing.js';

test('matchGpu finds common cards case-insensitively', () => {
  assert.equal(matchGpu('NVIDIA GeForce RTX 4090').estimateUsd, 1900);
  assert.equal(matchGpu('rtx 3090').estimateUsd, 850);
  assert.equal(matchGpu('RTX 3090 Ti').estimateUsd, 950);
  assert.equal(matchGpu('A100 SXM4 80GB').vramGb, 80);
});

test('matchGpu prefers more specific rules (3090 Ti over 3090)', () => {
  const ti = matchGpu('RTX 3090 Ti');
  assert.ok(ti.estimateUsd > matchGpu('RTX 3090').estimateUsd);
});

test('matchGpu returns null for unknown or missing names', () => {
  assert.equal(matchGpu('Imagination PX308'), null);
  assert.equal(matchGpu(''), null);
  assert.equal(matchGpu(undefined), null);
});

test('matchUnified prices Apple silicon by chip', () => {
  assert.equal(matchUnified('Apple M3 Ultra', 192).label, 'Mac Studio M3 Ultra');
  assert.equal(matchUnified('', 192), null); // no chip → no guess
});

test('matchUnified covers newer chips and AMD Strix Halo', () => {
  assert.equal(matchUnified('M5 Max', 128).label, 'Mac Studio M5 Max');
  assert.equal(matchUnified('m5 pro', 64).label, 'Mac Studio M5 Pro');
  assert.equal(matchUnified('AMD Strix Halo Radeon 8060s', 128).label, 'AMD Strix Halo mini PC');
});

test('retailerLinks builds deterministic search URLs', () => {
  const l = retailerLinks('RTX 3090');
  assert.match(l.ebay, /^https:\/\/www\.ebay\.com\/sch\/i\.html\?_nkw=RTX%203090$/);
  assert.match(l.ebayUsed, /LH_ItemCondition=3000/);
  assert.match(l.craigslist, /^https:\/\/www\.craigslist\.org\/search\/sss\?query=RTX%203090$/);
});

test('estimateStreetPrice: single GPU rig', () => {
  const p = estimateStreetPrice({ gpu: 'RTX 4090', hwClass: 'discrete_gpu', gpuCount: 1 });
  assert.equal(p.estimateUsd, 1900);
  assert.equal(p.kind, 'per_gpu');
  assert.equal(p.perGpu.estimateUsd, 1900);
  assert.equal(p.gpuCount, 1);
  assert.equal(p.asOf, PRICES_AS_OF);
  assert.ok(p.links.ebay.includes('_nkw='));
});

test('estimateStreetPrice: multi-GPU rigs scale linearly and keep per-card price', () => {
  const p = estimateStreetPrice({ gpu: 'RTX 3090', hwClass: 'discrete_gpu', gpuCount: 2 });
  assert.equal(p.kind, 'per_gpu_x_count');
  assert.equal(p.estimateUsd, 1700);
  assert.equal(p.lowUsd, 1400);
  assert.equal(p.highUsd, 2000);
  assert.equal(p.perGpu.estimateUsd, 850);
  assert.equal(p.gpuCount, 2);
});

test('estimateStreetPrice: unified memory is a whole-machine price, never scaled', () => {
  const p = estimateStreetPrice({ hwClass: 'unified', chip: 'M3 Ultra', unifiedMemoryGb: 192, gpuCount: 1 });
  assert.equal(p.kind, 'complete_system');
  assert.equal(p.estimateUsd, 7500);
  assert.equal(p.perGpu, undefined);
  assert.ok(p.links.ebay.includes('Mac%20Studio'));
});

test('estimateStreetPrice returns null instead of inventing numbers', () => {
  assert.equal(estimateStreetPrice({ hwClass: 'cpu_only', cpu: 'Ryzen 9' }), null);
  assert.equal(estimateStreetPrice({ hwClass: 'discrete_gpu', gpu: 'Matrox G200' }), null);
  assert.equal(estimateStreetPrice(), null);
});

test('estimateFromLabel prices preset display names, including dual-GPU rigs', () => {
  const dual = estimateFromLabel('Dual RTX 3090 48GB (TP2 ExLlamaV2 70B)');
  assert.equal(dual.kind, 'per_gpu_x_count');
  assert.equal(dual.estimateUsd, 1700);

  const single = estimateFromLabel('RTX 4090 24GB (ExLlamaV2 EXL2)');
  assert.equal(single.kind, 'per_gpu');
  assert.equal(single.estimateUsd, 1900);

  const mac = estimateFromLabel('Apple Mac Studio M3/M2 Ultra (192GB)');
  assert.equal(mac.kind, 'complete_system');
  assert.equal(mac.estimateUsd, 7500);
});

test('estimateFromLabel returns null for unpriceable labels', () => {
  assert.equal(estimateFromLabel('Groq LLaMA-3.3 70B (LPU Cluster)'), null);
  assert.equal(estimateFromLabel('Raspberry Pi 5 (llama.cpp 4-bit)'), null);
  assert.equal(estimateFromLabel('Custom Hardware Profile'), null);
  assert.equal(estimateFromLabel(''), null);
});
