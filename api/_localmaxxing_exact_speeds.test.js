// #593 — /api/localmaxxing rounds measured speeds to integer tok/s while the
// wizard applies the raw floats, so API-reconstructed configs diverge up to
// ~14% from the page for slow runs. slim() now also carries 4-decimal exact
// fields alongside the legacy rounded ones (additive; legacy values unchanged).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { slim } from './_localmaxxing.js';

const RAW = {
  id: 'cmri89ntu01b9mj01jxgxxy2o',
  createdAt: '2026-08-20T00:00:00.000Z',
  tokSPrefill: 10.2885223174,
  tokSOut: 3.4781550127,
  promptTokens: 2048,
  outputTokens: 512,
  contextLength: 32768,
  model: { hfId: 'Qwen/Qwen3.6-27B', displayName: 'Qwen3.6 27B', params: 27 },
  hardwareGroupKey: 'cpu-only', hardwareGroupLabel: 'CPU only',
  hardware: { hwClass: 'cpu_only', gpuName: null, gpuCount: 1 },
  engine: { engineName: 'llama.cpp', engineVersion: 'b6000', quantization: 'q4_k_m' }
};

test('#593: slim exposes 4-decimal exact speeds alongside legacy rounded ones', () => {
  const s = slim(RAW);
  assert.equal(s.prefillTokPerSecExact, 10.2885);
  assert.equal(s.decodeTokPerSecExact, 3.4782);
  // Legacy integer-rounded fields unchanged for back-compat.
  assert.equal(s.prefillTokPerSec, 10);
  assert.equal(s.decodeTokPerSec, 3);
});

test('#593: exact fields reproduce the share-link floats the wizard applies', () => {
  // The page URL encodes ?prefill=10.288522…&decode=3.478155…; an agent
  // rebuilding the config from the API must land within rounding-to-4dp of
  // those numbers, not 40% away on the decode side.
  const s = slim(RAW);
  assert.ok(Math.abs(s.prefillTokPerSecExact - RAW.tokSPrefill) < 1e-4);
  assert.ok(Math.abs(s.decodeTokPerSecExact - RAW.tokSOut) < 1e-4);
  const legacyError = Math.abs(s.decodeTokPerSec - RAW.tokSOut) / RAW.tokSOut;
  assert.ok(legacyError > 0.1, 'legacy rounding should be materially wrong here');
});

test('#593: non-finite upstream speeds yield null exact fields, not NaN', () => {
  const s = slim({ ...RAW, tokSPrefill: undefined, tokSOut: NaN });
  assert.equal(s.prefillTokPerSecExact, null);
  assert.equal(s.decodeTokPerSecExact, null);
});
