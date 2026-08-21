// Engine-specific flag modeling — explicit, auditable deltas.
//
// Each flag documents exactly how it changes the simulated numbers and where
// the number comes from (source + sourceNote), so every adjusted figure on
// the page can be traced back to a stated assumption. Deltas are
// multiplicative and composed in list order; nothing here is a measurement —
// all tags are `heuristic` unless a flag says otherwise.

export const ENGINE_FLAGS = [
  {
    id: 'flash-attn',
    engine: 'llamacpp',
    flag: '--flash-attn (-fa)',
    label: 'Flash Attention (llama.cpp)',
    summary: 'Fused attention kernels cut prefill compute and unlock KV quantization.',
    prefillMult: 1.18,
    decodeMult: 1.03,
    kvBits: null,
    source: 'heuristic',
    sourceNote: 'llama.cpp PR #5029 follow-up discussions: ~15-25% prefill gain at long context, ~0-5% decode. Midpoint used; varies with context length and GPU.'
  },
  {
    id: 'kv-q8',
    engine: 'llamacpp',
    flag: '--cache-type-k q8_0 --cache-type-v q8_0',
    label: 'Q8_0 KV cache (llama.cpp)',
    summary: 'Stores K/V at 8 bits instead of 16, halving KV bandwidth per token.',
    prefillMult: 1.04,
    decodeMult: 1.08,
    kvBits: 8,
    requires: 'flash-attn',
    source: 'heuristic',
    sourceNote: 'llama.cpp discussions (#5697): halving KV bytes gives ~5-10% decode gain on bandwidth-bound GPUs. Requires --flash-attn on most builds.'
  },
  {
    id: 'kv-q4',
    engine: 'llamacpp',
    flag: '--cache-type-k q4_0 --cache-type-v q4_0',
    label: 'Q4_0 KV cache (llama.cpp)',
    summary: 'Aggressive 4-bit KV cache: quarter the KV bytes, measurable quality loss.',
    prefillMult: 1.06,
    decodeMult: 1.14,
    kvBits: 4,
    requires: 'flash-attn',
    source: 'heuristic',
    sourceNote: 'Extrapolated from Q8_0 deltas scaled by bytes saved; quality degradation is real and NOT modeled numerically — treat speedups as upper bounds.'
  },
  {
    id: 'no-mmap',
    engine: 'llamacpp',
    flag: '--no-mmap',
    label: 'No mmap (llama.cpp)',
    summary: 'Weights load fully into RAM at startup instead of being paged in on demand.',
    prefillMult: 1.0,
    decodeMult: 1.0,
    kvBits: null,
    source: 'heuristic',
    sourceNote: 'Deliberately 0% delta: affects load behavior and first-token page-fault stalls, not steady-state tok/s. Listed for completeness so runs are reproducible.'
  },
  {
    id: 'vllm-fp8-kv',
    engine: 'vllm',
    flag: '--kv-cache-dtype fp8',
    label: 'FP8 KV cache (vLLM)',
    summary: 'FP8 KV cache halves KV memory and bandwidth on Hopper/Ada tensor cores.',
    prefillMult: 1.05,
    decodeMult: 1.10,
    kvBits: 8,
    source: 'heuristic',
    sourceNote: 'vLLM docs + community FP8 KV benchmarks: ~8-12% decode on H100-class HW, less on Ampere (no native FP8). Midpoint used.'
  },
  {
    id: 'vllm-o3',
    engine: 'vllm',
    flag: '-O3',
    label: 'Compilation level 3 (vLLM)',
    summary: 'torch.compile max optimization: CUDA graphs + operator fusion.',
    prefillMult: 1.10,
    decodeMult: 1.06,
    kvBits: null,
    source: 'heuristic',
    sourceNote: 'vLLM docs cite up to ~7% from -O3 on decode; prefill fusion gains are workload-dependent. Midpoint used, long warmup not modeled.'
  }
];

export const FLAG_SOURCE_TAG_HELP = {
  heuristic: 'Documented heuristic, not a measurement. Midpoints of published/community ranges; verify against your own hardware.'
};

function clampSpeed(x) {
  return Math.max(1, x);
}

// Apply engine flags to base speeds. Unknown or duplicate ids are ignored
// (reported in `warnings`) so a bad URL param can never corrupt the model.
// Returns adjusted speeds plus a per-flag audit trail.
export function applyEngineFlags({ prefillSpeed = 3800, decodeSpeed = 105, kvBits = 16, flags = [] } = {}) {
  const ids = Array.isArray(flags) ? flags : String(flags).split(',');
  const adjustments = [];
  const warnings = [];
  const seen = new Set();

  let prefill = prefillSpeed;
  let decode = decodeSpeed;
  let outKvBits = kvBits;

  for (const rawId of ids) {
    const id = String(rawId).trim();
    if (!id) continue;
    const def = ENGINE_FLAGS.find(f => f.id === id);
    if (!def) {
      warnings.push(`Unknown flag id '${id}' ignored`);
      continue;
    }
    if (seen.has(id)) continue;
    seen.add(id);

    if (def.requires && !seen.has(def.requires) && !ids.includes(def.requires)) {
      warnings.push(`'${id}' requires '${def.requires}' to be enabled — applied anyway, but the engine would reject this combination`);
    }

    prefill *= def.prefillMult;
    decode *= def.decodeMult;
    if (def.kvBits !== null) outKvBits = def.kvBits;

    adjustments.push({
      id: def.id,
      engine: def.engine,
      flag: def.flag,
      label: def.label,
      prefillDeltaPct: round((def.prefillMult - 1) * 100),
      decodeDeltaPct: round((def.decodeMult - 1) * 100),
      kvBits: def.kvBits,
      source: def.source,
      sourceNote: def.sourceNote
    });
  }

  return {
    inputs: { prefillSpeed, decodeSpeed, kvBits, flags: [...seen] },
    adjusted: {
      prefillSpeed: Math.round(clampSpeed(prefill)),
      decodeSpeed: Math.round(clampSpeed(decode) * 10) / 10,
      kvBits: outKvBits
    },
    totalPrefillDeltaPct: round((prefill / prefillSpeed - 1) * 100),
    totalDecodeDeltaPct: round((decode / decodeSpeed - 1) * 100),
    adjustments,
    warnings
  };
}

export function getEngineFlag(id) {
  return ENGINE_FLAGS.find(f => f.id === id) || null;
}

function round(x) {
  if (!Number.isFinite(x)) return null;
  return Math.round(x * 10) / 10;
}
