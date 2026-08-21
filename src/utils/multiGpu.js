// Multi-GPU split planning (#48).
//
// Given a model (total parameter count), the KV cache size computed by the
// KV Cache Calculator, and a GPU layout (1×/2×/4× cards, tensor vs pipeline
// parallelism, interconnect), estimate:
//   - per-GPU VRAM share (weights sharded; KV sharded or replicated
//     depending on parallelism mode and geometry)
//   - interconnect penalty on decode speed
//   - whether the config fits on the selected card
//   - whether one larger single card would beat the multi-GPU split
//
// Heuristics (documented, deliberately simple):
//   - PCIe all-reduce penalty ≈ 10% of decode tok/s for tensor parallelism.
//     Every decode step ends in two all-reduce rounds that cross the bus;
//     PCIe gen4 x16 (~64 GB/s) vs NVLink (~900 GB/s) and community-measured
//     multi-GPU vLLM/llama.cpp deltas cluster around 5-15%, so we anchor 10%.
//   - NVLink tensor-parallel penalty ≈ 3% (same all-reduce rounds, ~14× the
//     bus bandwidth, so the sync mostly hides behind compute).
//   - Pipeline parallelism penalty ≈ 2% flat regardless of bus: no per-step
//     all-reduce (only boundary hidden-state transfers), but the pipeline
//     bubble costs some throughput even at batch 1.
//   - Usable VRAM = 95% of the card (display attach / OS / allocator reserve)
//     minus ~1.5 GB per GPU for CUDA context, activations and framework
//     buffers.
//   - Tensor parallelism shards the KV cache across GPUs only when there are
//     enough KV heads to divide (kvHeads >= gpuCount); otherwise GPUs would
//     hold duplicated heads, so we conservatively model full replication.
//     Pipeline parallelism always shards KV by layer when kvLayers >= N.

/** Card catalog for the fit verdict. Discrete VRAM per card in GB. */
export const GPU_CARDS = [
  { id: 'rtx3090', name: 'RTX 3090 / 4090 · 24 GB', vramGb: 24 },
  { id: 'rtx5090', name: 'RTX 5090 · 32 GB', vramGb: 32 },
  { id: 'a6000', name: 'RTX A6000 / L40S · 48 GB', vramGb: 48 },
  { id: 'h10080', name: 'A100 / H100 · 80 GB', vramGb: 80 },
  { id: 'h200', name: 'H200 · 141 GB', vramGb: 141 }
];

export const USABLE_VRAM_FRACTION = 0.95;
export const PER_GPU_OVERHEAD_GB = 1.5;

// Decode-speed loss by parallelism mode × interconnect (see header comment).
export const DECODE_PENALTY_PCT = {
  tp:   { pcie: 10, nvlink: 3 },
  pp:   { pcie: 2,  nvlink: 2 }
};

/**
 * Parse the human parameter label used by MODEL_PRESETS into billions of
 * parameters: '70B' -> 70, '2.8T' -> 2800, '2.6B' -> 2.6.
 */
export function parseParamBillions(paramsStr) {
  const m = /^([\d.]+)\s*([TB])$/i.exec(String(paramsStr).trim());
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n)) return null;
  return m[2].toUpperCase() === 'T' ? n * 1000 : n;
}

const GiB = 1024 * 1024 * 1024;

/**
 * Plan a multi-GPU split.
 *
 * @param {object} args
 * @param {number} args.paramB            total params in billions
 * @param {number} args.weightBytesPerParam  2 (FP16/BF16), 1 (FP8/INT8), 0.5 (INT4)
 * @param {number} args.totalKvBytes      whole-model KV cache bytes (all sequences in flight)
 * @param {number} args.kvHeads           KV heads per attention layer (TP sharding granularity)
 * @param {number} args.kvLayers          layers that store KV (PP sharding granularity)
 * @param {number} args.gpuCount          1 | 2 | 4
 * @param {'tp'|'pp'} args.mode           tensor vs pipeline parallelism
 * @param {'pcie'|'nvlink'} args.interconnect
 * @param {number} args.cardVramGb        selected card's VRAM
 * @returns {object} plan (see component for consumed fields)
 */
export function planSplit({
  paramB,
  weightBytesPerParam,
  totalKvBytes,
  kvHeads = null,
  kvLayers = null,
  gpuCount,
  mode = 'tp',
  interconnect = 'pcie',
  cardVramGb
}) {
  const n = Math.max(1, Math.round(gpuCount));
  const warnings = [];

  // Weights are always evenly sharded across the pipeline/tensor group.
  const weightsTotalBytes = paramB * 1e9 * weightBytesPerParam;
  const weightsPerGpuBytes = weightsTotalBytes / n;

  // KV sharding rules (see header comment).
  let kvPerGpuBytes;
  let kvSharded;
  if (n === 1) {
    kvPerGpuBytes = totalKvBytes;
    kvSharded = false;
  } else if (mode === 'tp') {
    if (Number.isFinite(kvHeads) && kvHeads >= n && kvHeads % n === 0) {
      kvPerGpuBytes = totalKvBytes / n;
      kvSharded = true;
    } else {
      kvPerGpuBytes = totalKvBytes; // replicated: too few KV heads to divide
      kvSharded = false;
      warnings.push('kvReplicated');
    }
  } else {
    if (!Number.isFinite(kvLayers) || kvLayers >= n) {
      kvPerGpuBytes = totalKvBytes / n;
      kvSharded = true;
    } else {
      kvPerGpuBytes = totalKvBytes;
      kvSharded = false;
      warnings.push('kvReplicated');
    }
  }

  const overheadBytes = PER_GPU_OVERHEAD_GB * GiB;
  const perGpuNeededBytes = weightsPerGpuBytes + kvPerGpuBytes + overheadBytes;
  const usableVramGb = cardVramGb * USABLE_VRAM_FRACTION;
  const headroomGb = usableVramGb - perGpuNeededBytes / GiB;
  const fits = headroomGb >= 0;
  if (!fits) warnings.push('doesNotFit');

  // Interconnect penalty on decode speed (fraction of tok/s lost). A single
  // GPU has no interconnect, so no penalty.
  const penaltyPct = n === 1 ? 0 : (DECODE_PENALTY_PCT[mode]?.[interconnect] ?? 0);
  const effectiveDecodeFactor = 1 - penaltyPct / 100;

  // "One bigger card beats two small ones": only meaningful for tensor
  // parallelism over PCIe, where every decode step pays the all-reduce tax.
  // Find the smallest catalog card that hosts the WHOLE model alone.
  let largerCard = null;
  if (n > 1 && mode === 'tp' && interconnect === 'pcie') {
    const singleGpuBytes = weightsTotalBytes + totalKvBytes + overheadBytes;
    largerCard = GPU_CARDS.find(c => c.vramGb * USABLE_VRAM_FRACTION * GiB >= singleGpuBytes) || null;
    if (largerCard && largerCard.vramGb >= cardVramGb) warnings.push('singleCardFaster');
  }

  return {
    gpuCount: n,
    weightsTotalGb: weightsTotalBytes / GiB,
    weightsPerGpuGb: weightsPerGpuBytes / GiB,
    kvPerGpuGb: kvPerGpuBytes / GiB,
    kvSharded,
    overheadGb: PER_GPU_OVERHEAD_GB,
    perGpuNeededGb: perGpuNeededBytes / GiB,
    usableVramGb,
    headroomGb,
    fits,
    decodePenaltyPct: penaltyPct,
    effectiveDecodeFactor,
    largerCard,
    warnings
  };
}
