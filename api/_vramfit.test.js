import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  quantBitsPerWeight,
  guessArchitecture,
  availableMemoryGb,
  fitsInMemory,
  DEFAULT_FALLBACK_BITS,
  UNIFIED_USABLE_FRACTION
} from './_vramfit.js';

test('quantBitsPerWeight reads GGUF k-quant tags', () => {
  assert.equal(quantBitsPerWeight('Q4_K_M'), 4.5);
  assert.equal(quantBitsPerWeight('q8_0'), 8.5);
  assert.equal(quantBitsPerWeight('q2_k_xl'), 2.5);
  assert.equal(quantBitsPerWeight('IQ4_XS'), 4.5);
});

test('quantBitsPerWeight reads MLX-style and fp16 tags', () => {
  assert.equal(quantBitsPerWeight('4bit'), 4.5);
  assert.equal(quantBitsPerWeight('8bit-dwq'), 8.5);
  assert.equal(quantBitsPerWeight('fp16'), 16);
  assert.equal(quantBitsPerWeight('bf16'), 16);
  assert.equal(quantBitsPerWeight('nvfp4'), null); // unrecognized → caller fallback
});

test('guessArchitecture buckets layers by param count', () => {
  assert.equal(guessArchitecture(8).numLayers, 32);
  assert.equal(guessArchitecture(14).numLayers, 48);
  assert.equal(guessArchitecture(32).numLayers, 64);
  assert.equal(guessArchitecture(70).numLayers, 80);
  assert.equal(guessArchitecture(null).numLayers, 80); // safe default
});

test('availableMemoryGb: discrete VRAM × gpu count, unified × usable fraction, cpu_only → null', () => {
  assert.equal(availableMemoryGb({ hwClass: 'discrete_gpu', vramGb: 24, gpuCount: 2 }), 48);
  assert.equal(availableMemoryGb({ hwClass: 'discrete_gpu', vramGb: 24, gpuCount: undefined }), 24);
  assert.equal(availableMemoryGb({ hwClass: 'unified', unifiedMemoryGb: 128 }), 128 * UNIFIED_USABLE_FRACTION);
  assert.equal(availableMemoryGb({ hwClass: 'cpu_only' }), null);
  assert.equal(availableMemoryGb({ hwClass: 'discrete_gpu' }), null); // no vramGb recorded
});

test('fitsInMemory: 8B q4 model + 32k context fits a 12 GB card', () => {
  const r = fitsInMemory({
    paramsB: 8, quantization: 'q4_k_m', hwClass: 'discrete_gpu', vramGb: 12, gpuCount: 1,
    contextLength: 32768
  });
  assert.equal(r.fits, true);
  // 8B × 4.5bpw ≈ 4.5 GB weights; 32 layers × 8 kv × 128 × 2B × 32768 = 4 GB KV
  assert.ok(r.estimatedWeightsGb > 4 && r.estimatedWeightsGb < 5, `weights ${r.estimatedWeightsGb}`);
  assert.ok(r.estimatedKvCacheGb > 3.5 && r.estimatedKvCacheGb < 4.5, `kv ${r.estimatedKvCacheGb}`);
  assert.ok(r.headroomGb > 0);
});

test('fitsInMemory: same model at 128k context overflows the 12 GB card', () => {
  const r = fitsInMemory({
    paramsB: 8, quantization: 'q4_k_m', hwClass: 'discrete_gpu', vramGb: 12, gpuCount: 1,
    contextLength: 131072
  });
  assert.equal(r.fits, false);
  assert.ok(r.headroomGb < 0);
});

test('fitsInMemory: quant choice decides fit on the edge', () => {
  // Single 48 GB card @ 8k ctx: q4 (~44 GB total) squeaks in, q8 (~85 GB) does not
  const base = { paramsB: 70, hwClass: 'discrete_gpu', vramGb: 48, gpuCount: 1, contextLength: 8192 };
  assert.equal(fitsInMemory({ ...base, quantization: 'q4_k_m' }).fits, true);
  assert.equal(fitsInMemory({ ...base, quantization: 'q8_0' }).fits, false);
});

test('fitsInMemory: unified memory rigs use the usable fraction', () => {
  const base = { paramsB: 27, quantization: '4bit', hwClass: 'unified', unifiedMemoryGb: 36, contextLength: 32768 };
  const r = fitsInMemory(base);
  assert.equal(r.availableVramGb, 27); // 36 × 0.75
  assert.equal(r.fits, true);
});

test('fitsInMemory: returns null when fit cannot be assessed', () => {
  assert.equal(fitsInMemory({ paramsB: 8, quantization: 'q4_k_m', hwClass: 'cpu_only' }), null);
  assert.equal(fitsInMemory({ paramsB: null, quantization: 'q4_k_m', hwClass: 'discrete_gpu', vramGb: 24 }), null);
});

test('fitsInMemory: unknown quant falls back to q4-ish estimate and says so', () => {
  const r = fitsInMemory({
    paramsB: 8, quantization: 'exotic_v9', hwClass: 'discrete_gpu', vramGb: 24, gpuCount: 1
  });
  assert.equal(r.assumedBitsPerWeight, DEFAULT_FALLBACK_BITS);
  assert.equal(r.quantBitsKnown, false);
});
