import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_HALF_SPEED_CONTEXT,
  HALF_SPEED_CONTEXT_PRESETS,
  tpotMultiplierAt,
  decodeSpeedAtContext,
  scaledDecodeTime,
  averageScaledSpeed,
  tokensGeneratedAt
} from './contextScaling.js';

test('TPOT multiplier is linear in cache depth and equals 2 at C½', () => {
  assert.equal(tpotMultiplierAt(0), 1);
  assert.ok(Math.abs(tpotMultiplierAt(32768, 32768) - 2) < 1e-12);
  assert.ok(Math.abs(tpotMultiplierAt(16384, 65536) - 1.25) < 1e-12);
  // Negative / junk cache depths clamp to an empty cache.
  assert.equal(tpotMultiplierAt(-5, 1000), 1);
});

test('instantaneous speed halves at C½ and never goes negative', () => {
  assert.ok(Math.abs(decodeSpeedAtContext(100, 0) - 100) < 1e-12);
  assert.ok(Math.abs(decodeSpeedAtContext(100, DEFAULT_HALF_SPEED_CONTEXT) - 50) < 1e-12);
  assert.equal(decodeSpeedAtContext(0, 5000), 0);
  assert.equal(decodeSpeedAtContext(-10, 5000), 0);
});

test('scaledDecodeTime matches a brute-force token-by-token sum', () => {
  const base = 42;
  const P = 8192;
  const n = 512;
  const H = 16384;
  const tpot0 = 1 / base;
  let brute = 0;
  for (let i = 0; i < n; i++) brute += tpot0 * (1 + (P + i) / H);
  assert.ok(Math.abs(scaledDecodeTime(base, P, n, H) - brute) < 1e-9);
  assert.equal(scaledDecodeTime(base, P, 0, H), 0);
  assert.equal(scaledDecodeTime(0, P, n, H), Infinity);
});

test('scaledDecodeTime reduces to the constant-speed result as C½ → ∞', () => {
  const t = scaledDecodeTime(100, 4096, 256, 1e12);
  assert.ok(Math.abs(t - 256 / 100) < 1e-6);
});

test('averageScaledSpeed sits between the first and last instantaneous speeds', () => {
  const base = 60;
  const P = 16384;
  const n = 2048;
  const H = 32768;
  const first = decodeSpeedAtContext(base, P, H);
  const last = decodeSpeedAtContext(base, P + n, H);
  const avg = averageScaledSpeed(base, P, n, H);
  assert.ok(avg < first && avg > last);
});

test('tokensGeneratedAt inverts scaledDecodeTime', () => {
  const base = 35;
  const P = 4096;
  const H = 8192;
  for (const elapsed of [0.01, 0.5, 2.5, 30]) {
    const n = tokensGeneratedAt(base, P, elapsed, H);
    const back = scaledDecodeTime(base, P, n, H);
    assert.ok(Math.abs(back - elapsed) < 1e-6 * Math.max(1, elapsed));
  }
  assert.equal(tokensGeneratedAt(base, P, 0, H), 0);
  // Huge C½ → plain constant-speed progress.
  assert.ok(Math.abs(tokensGeneratedAt(100, 0, 1, 1e12) - 100) < 1e-6);
  assert.equal(tokensGeneratedAt(0, 100, 5, H), 0);
});

test('preset list is well-formed and contains the default', () => {
  assert.ok(HALF_SPEED_CONTEXT_PRESETS.includes(DEFAULT_HALF_SPEED_CONTEXT));
  for (let i = 1; i < HALF_SPEED_CONTEXT_PRESETS.length; i++) {
    assert.ok(HALF_SPEED_CONTEXT_PRESETS[i] > HALF_SPEED_CONTEXT_PRESETS[i - 1]);
  }
});
