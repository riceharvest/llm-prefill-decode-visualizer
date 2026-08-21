import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cost } from './_math.js';

function approx(actual, expected, tol = 0.01) {
  assert.ok(
    actual !== null && Math.abs(actual - expected) <= tol,
    `expected ~${expected}, got ${actual}`
  );
}

test('cost: known rig — $2000 GPU, 450W, $0.15/kWh over 36 months', () => {
  const r = cost({
    hardwarePriceUsd: 2000,
    electricityRatePerKwh: 0.15,
    powerDrawWatts: 450,
    amortizationMonths: 36,
    promptTokens: 2048,
    outputTokens: 512,
    prefillSpeed: 3800,
    decodeSpeed: 105
  });

  // Scenario shape: ttft = 2048/3800 ≈ 0.53895s, decode = 512/105 ≈ 4.87619s
  const total = 2048 / 3800 + 512 / 105;
  const throughput = 2560 / total;

  approx(r.effectiveThroughputTokPerSec, throughput, 0.001);
  approx(r.hardwareCostUsdPerHour, 2000 / (36 * 730), 0.00001);
  approx(r.electricityCostUsdPerHour, 0.45 * 0.15, 0.00001);
  approx(r.totalCostUsdPerHour, 2000 / (36 * 730) + 0.0675, 0.00001);
  approx(r.requestsPerHour, 3600 / total, 0.01);
  // ($/hour ÷ tok/s) × 1e6 = $/1M tokens
  approx(r.costUsdPerMillionTokens, ((2000 / (36 * 730) + 0.0675) / throughput) * 1e6, 0.1);
});

test('cost: defaults produce a sane all-in number without any inputs', () => {
  const r = cost();
  assert.equal(r.inputs.amortizationMonths, 36);
  // No price, no power → only the caller-supplied speeds matter; with zero
  // power draw and zero price the token cost must be exactly $0.
  assert.equal(r.costUsdPerMillionTokens, 0);
  assert.equal(r.totalCostUsdPerHour, 0);
});

test('cost: electricity-only rigs rank purely on tok-per-joule economics', () => {
  const cheapSlow = cost({ electricityRatePerKwh: 0.15, powerDrawWatts: 60, prefillSpeed: 500, decodeSpeed: 20 });
  const priceyFast = cost({ electricityRatePerKwh: 0.15, powerDrawWatts: 600, prefillSpeed: 8000, decodeSpeed: 150 });
  assert.ok(cheapSlow.costUsdPerMillionTokens > 0);
  assert.ok(priceyFast.costUsdPerMillionTokens > 0);
  assert.notEqual(cheapSlow.costUsdPerMillionTokens, priceyFast.costUsdPerMillionTokens);
});

test('cost: amortization spreads price — longer horizon, lower $/1M tokens', () => {
  const short = cost({ hardwarePriceUsd: 3000, amortizationMonths: 12 });
  const long = cost({ hardwarePriceUsd: 3000, amortizationMonths: 60 });
  assert.ok(short.costUsdPerMillionTokens > long.costUsdPerMillionTokens);
});

test('cost: amortizationMonths=0 means free hardware, no divide-by-zero', () => {
  const r = cost({ hardwarePriceUsd: 9999, amortizationMonths: 0, powerDrawWatts: 100, electricityRatePerKwh: 0.2 });
  assert.equal(r.hardwareCostUsdPerHour, 0);
  approx(r.electricityCostUsdPerHour, 0.02, 0.0001);
  assert.ok(r.costUsdPerMillionTokens > 0);
});

test('cost: degenerate speeds yield null instead of Infinity/NaN', () => {
  const noDecode = cost({ decodeSpeed: 0 });
  assert.equal(noDecode.effectiveThroughputTokPerSec, 0);
  assert.equal(noDecode.costUsdPerMillionTokens, null);
  assert.equal(noDecode.requestsPerHour, 0);
  assert.equal(noDecode.costUsdPerThousandRequests, null);
});
