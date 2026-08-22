// Pure VRAM-fit math shared by the /api/best fitCheck filter.
//
// Everything here is an ESTIMATE: the localmaxxing dataset gives us rig
// memory (vramGb / unifiedMemoryGb) and model size in params, but not the
// per-model architecture (numLayers / kvHeads / headDim). We derive a
// heuristic architecture from parameter count and an effective
// bits-per-weight from the quantization tag. Callers should surface that
// these numbers are estimates, not measured values.

import { kvCache } from './_math.js';

/** Fraction of unified memory usable by the model (OS/GPU reserves the rest). */
export const UNIFIED_USABLE_FRACTION = 0.75;
/** Extra headroom for activations, compute buffers, CUDA context. */
export const OVERHEAD_FRACTION = 0.1;

/**
 * Effective bits-per-weight guessed from a quantization tag.
 * GGUF quants don't store exactly k bits/weight (k-quants mix block types),
 * so these are community-accepted effective rates, not exact values.
 */
export function quantBitsPerWeight(quantization) {
  if (!quantization) return null; // unknown → caller decides fallback
  const q = String(quantization).toLowerCase();

  // MLX-style tags first: "4bit", "6bit", "8bit", "4bit-dwq" ...
  const mlx = q.match(/(\d+)\s*bit/);
  if (mlx) {
    const n = Number(mlx[1]);
    // MLX x-bit quants average slightly above n bpw
    return n >= 8 ? 8.5 : n + 0.5;
  }
  if (/bf16|f16|fp16|half/.test(q)) return 16;
  if (/fp8|f8\b|e4m3/.test(q)) return 8;

  // GGUF-style: leading digit after 'q' — q2_k_xl → 2.x, i1/iq variants → iq bucket
  const gguf = q.match(/i?q(\d)(?:_(\w))?/) || q.match(/iq(\d)/);
  if (gguf) {
    const base = Number(gguf[1] ?? gguf[0].slice(-1));
    if (base >= 2 && base <= 8) return base + 0.5;
  }
  return null; // unrecognized → caller decides fallback
}

export const DEFAULT_FALLBACK_BITS = 4.5; // ≈ q4_k_m, the most common community quant

/**
 * Heuristic transformer architecture from parameter count. Rough buckets
 * calibrated on Llama/Mistral/Qwen dense models:
 *   ~7–9B → 32 layers · ~13–20B → 48 · ~30–35B → 64 · 65B+ → 80
 */
export function guessArchitecture(paramsB) {
  if (!Number.isFinite(paramsB) || paramsB <= 0) return { numLayers: 80, kvHeads: 8, headDim: 128 };
  let numLayers = 80;
  if (paramsB <= 10) numLayers = 32;
  else if (paramsB <= 22) numLayers = 48;
  else if (paramsB <= 45) numLayers = 64;
  return { numLayers, kvHeads: 8, headDim: 128 };
}

/** Total memory available to the model on a run's hardware, in GB. */
export function availableMemoryGb(run) {
  const hwClass = String(run.hwClass || '').toLowerCase();
  if (hwClass === 'unified') {
    const m = Number(run.unifiedMemoryGb);
    return Number.isFinite(m) ? m * UNIFIED_USABLE_FRACTION : null;
  }
  if (hwClass === 'cpu_only' || hwClass === '') return null; // no assessable accelerator
  const vram = Number(run.vramGb);
  const gpus = Number(run.gpuCount) || 1;
  return Number.isFinite(vram) ? vram * gpus : null;
}

/**
 * Estimate whether a run's rig can hold the model at the given context.
 * Returns null when fit cannot be assessed (missing params/memory).
 */
export function fitsInMemory({
  paramsB,
  quantization,
  hwClass,
  vramGb,
  gpuCount = 1,
  unifiedMemoryGb,
  contextLength = 32768,
  precisionBytes = 2,
  batchSize = 1,
  fallbackBitsPerWeight = DEFAULT_FALLBACK_BITS
} = {}) {
  const available = availableMemoryGb({ hwClass, vramGb, gpuCount, unifiedMemoryGb });
  const weightsBits = quantBitsPerWeight(quantization) ?? fallbackBitsPerWeight;
  if (available == null || !Number.isFinite(paramsB) || paramsB <= 0) return null;

  const weightsGb = (paramsB * 1e9 * weightsBits) / 8 / 1024 ** 3;
  const arch = guessArchitecture(paramsB);
  const kv = kvCache({ ...arch, contextLength, precisionBytes, batchSize });
  const totalGb = (weightsGb + kv.totalGb) * (1 + OVERHEAD_FRACTION);

  return {
    fits: totalGb <= available,
    estimatedWeightsGb: round(weightsGb),
    estimatedKvCacheGb: kv.totalGb,
    estimatedTotalGb: round(totalGb),
    availableVramGb: round(available),
    assumedBitsPerWeight: weightsBits,
    quantBitsKnown: quantBitsPerWeight(quantization) != null,
    assumedArchitecture: arch,
    headroomGb: round(available - totalGb)
  };
}

function round(x) {
  if (!Number.isFinite(x)) return null;
  return Math.round(x * 1000) / 1000;
}
