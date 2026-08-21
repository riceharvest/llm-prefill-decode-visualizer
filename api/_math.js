// Pure inference-math shared by the /api/compute endpoint.
// Mirrors the formulas the visualizer UI uses — single source of truth so
// agents get exactly the numbers the page shows.

// ---- Sanity bounds (issue #44: implausible-output warnings) ---------------
// Decode is memory-bandwidth bound: one token per step means streaming every
// model weight from VRAM each forward pass. Even a ~1 TB/s GPU running a
// ~1B-param Q4 model tops out around ~2000 tok/s single-stream, so anything
// above this cannot be a real single-stream measurement.
export const MAX_PLAUSIBLE_DECODE_TOK_PER_SEC = 2000;
// Prefill is compute-bound. The fastest measured single-GPU prefill for any
// model people actually simulate stays orders of magnitude below 500k tok/s;
// above this the input is almost certainly a unit mixup (e.g. tok/s vs ms).
export const MAX_PLAUSIBLE_PREFILL_TOK_PER_SEC = 500000;
// A single forward pass can never complete faster than kernel-launch +
// framework overhead (~2 ms). A computed TTFT below this floor means the
// prefill speed / prompt length combination is physically impossible.
export const MIN_PLAUSIBLE_TTFT_SECONDS = 0.002;

// Non-blocking sanity checks. Returns an array of { code, message } — empty
// when every input sits inside plausible bounds. Never throws, never alters
// the math; consumers surface the warnings alongside the results.
export function sanityWarnings({ promptTokens = 0, prefillSpeed = 0, decodeSpeed = 0 } = {}) {
  const warnings = [];

  if (decodeSpeed > MAX_PLAUSIBLE_DECODE_TOK_PER_SEC) {
    warnings.push({
      code: 'decode_above_bandwidth_roofline',
      message: `Decode speed ${decodeSpeed} tok/s exceeds the memory-bandwidth roofline (~${MAX_PLAUSIBLE_DECODE_TOK_PER_SEC} tok/s single-stream on ~1 TB/s hardware with a ~1B Q4 model) — no real single-stream run is this fast.`
    });
  }

  if (prefillSpeed > MAX_PLAUSIBLE_PREFILL_TOK_PER_SEC) {
    warnings.push({
      code: 'prefill_above_compute_roofline',
      message: `Prefill speed ${prefillSpeed} tok/s exceeds any known single-GPU compute roofline (~${MAX_PLAUSIBLE_PREFILL_TOK_PER_SEC} tok/s) — check for a unit mixup (tok/s vs ms/tok).`
    });
  }

  const ttft = promptTokens > 0 && prefillSpeed > 0 ? promptTokens / prefillSpeed : null;
  if (ttft !== null && ttft < MIN_PLAUSIBLE_TTFT_SECONDS) {
    warnings.push({
      code: 'ttft_below_kernel_launch_floor',
      message: `TTFT ${(ttft * 1000).toFixed(3)} ms is below the kernel-launch overhead floor (~${MIN_PLAUSIBLE_TTFT_SECONDS * 1000} ms per forward pass) — this prompt/speed combination cannot happen on real hardware.`
    });
  }

  return warnings;
}

export function singleTurn({ promptTokens = 2048, outputTokens = 512, prefillSpeed = 3800, decodeSpeed = 105 } = {}) {
  const ttft = promptTokens / prefillSpeed;
  const decodeTime = outputTokens / decodeSpeed;
  const total = ttft + decodeTime;
  return {
    inputs: { promptTokens, outputTokens, prefillSpeed, decodeSpeed },
    warnings: sanityWarnings({ promptTokens, prefillSpeed, decodeSpeed }),
    ttftSeconds: round(ttft),
    tpotMs: round(decodeSpeed > 0 ? 1000 / decodeSpeed : Infinity),
    decodeSeconds: round(decodeTime),
    totalWalltimeSeconds: round(total),
    effectiveThroughputTokPerSec: round(total > 0 ? (promptTokens + outputTokens) / total : 0),
    prefillSharePct: round(total > 0 ? (ttft / total) * 100 : 0),
    decodeSharePct: round(total > 0 ? (decodeTime / total) * 100 : 0)
  };
}

export function speculative({ baseDecodeSpeed = 105, draftTokens = 4, acceptanceRate = 0.7, draftCostFraction = 0.2 } = {}) {
  const k = Math.max(1, draftTokens);
  const alpha = Math.min(1, Math.max(0, acceptanceRate));
  const tokensPerStep = 1 + k * alpha;
  const stepsPerSecond = baseDecodeSpeed / (1 + k * draftCostFraction);
  const effective = stepsPerSecond * tokensPerStep;
  return {
    inputs: { baseDecodeSpeed, draftTokens: k, acceptanceRate: alpha, draftCostFraction },
    warnings: sanityWarnings({ decodeSpeed: baseDecodeSpeed }),
    effectiveDecodeTokPerSec: round(effective),
    speedupVsVanilla: round(effective / baseDecodeSpeed),
    tokensPerVerifyStep: round(tokensPerStep),
    // Acceptance rate below which speculation is slower than vanilla decode
    // (= draftCostFraction in this linear verify-cost model).
    breakevenAcceptanceRate: round(Math.min(1, Math.max(0, draftCostFraction))),
    hurtsVsVanilla: alpha <= Math.min(1, Math.max(0, draftCostFraction))
  };
}

export function batched({ prefillSpeed = 3800, decodeSpeed = 105, batchSize = 1, promptTokens = 4096, outputTokens = 512, decodeDecayExponent = 0.25 } = {}) {
  const b = Math.max(1, batchSize);
  const perUserDecode = decodeSpeed * Math.pow(b, -decodeDecayExponent);
  const ttft = promptTokens / prefillSpeed;
  const decodeTime = outputTokens / perUserDecode;
  return {
    inputs: { prefillSpeed, decodeSpeed, batchSize: b, promptTokens, outputTokens, decodeDecayExponent },
    warnings: sanityWarnings({ promptTokens, prefillSpeed, decodeSpeed }),
    perUserDecodeTokPerSec: round(perUserDecode),
    aggregateDecodeTokPerSec: round(b * perUserDecode),
    ttftSeconds: round(ttft),
    perUserDecodeSeconds: round(decodeTime),
    perUserTotalSeconds: round(ttft + decodeTime)
  };
}

export function agentic(options = {}) {
  const {
    numTurns = 4, basePromptTokens = 1500, toolOutputTokensPerTurn = 800,
    decodeTokensPerTurn = 250, prefillSpeed = 3800, decodeSpeed = 105,
    enablePrefixCaching = true
  } = options;
  const turns = [];
  let cumulativePromptTokens = basePromptTokens;
  let cumulativeWalltime = 0;

  for (let turn = 1; turn <= numTurns; turn++) {
    const totalPromptTokens = cumulativePromptTokens;
    const newTokensPrefilled = enablePrefixCaching && turn > 1
      ? toolOutputTokensPerTurn
      : totalPromptTokens;
    const prefillTime = newTokensPrefilled / prefillSpeed;
    const decodeTime = decodeTokensPerTurn / decodeSpeed;
    cumulativeWalltime += prefillTime + decodeTime;

    turns.push({
      turn,
      totalPromptTokens,
      newTokensPrefilled,
      isCached: enablePrefixCaching && turn > 1,
      prefillSeconds: round(prefillTime),
      decodeSeconds: round(decodeTime),
      turnWalltimeSeconds: round(prefillTime + decodeTime),
      cumulativeWalltimeSeconds: round(cumulativeWalltime)
    });

    cumulativePromptTokens += decodeTokensPerTurn + toolOutputTokensPerTurn;
  }

  // Same loop without caching, for savings comparison
  let noCacheTotal = 0;
  let p = basePromptTokens;
  for (let t = 1; t <= numTurns; t++) {
    noCacheTotal += p / prefillSpeed + decodeTokensPerTurn / decodeSpeed;
    p += decodeTokensPerTurn + toolOutputTokensPerTurn;
  }

  return {
    inputs: options,
    warnings: sanityWarnings({ promptTokens: basePromptTokens, prefillSpeed, decodeSpeed }),
    turns,
    finalContextTokens: turns.length ? turns[turns.length - 1].totalPromptTokens + decodeTokensPerTurn : 0,
    totalWalltimeSeconds: round(cumulativeWalltime),
    walltimeWithoutCachingSeconds: round(noCacheTotal),
    cachingSavesSeconds: round(noCacheTotal - cumulativeWalltime),
    cachingSavesPct: round(noCacheTotal > 0 ? ((noCacheTotal - cumulativeWalltime) / noCacheTotal) * 100 : 0)
  };
}

export function cost({
  hardwarePriceUsd = 0, electricityRatePerKwh = 0, powerDrawWatts = 0,
  amortizationMonths = 36, promptTokens = 2048, outputTokens = 512,
  prefillSpeed = 3800, decodeSpeed = 105
} = {}) {
  const ttft = promptTokens / prefillSpeed;
  const decodeTime = outputTokens / decodeSpeed;
  const total = ttft + decodeTime;
  const throughput = total > 0 ? (promptTokens + outputTokens) / total : 0;
  const HOURS_PER_MONTH = 730;
  const hourlyHardware = amortizationMonths > 0
    ? hardwarePriceUsd / (amortizationMonths * HOURS_PER_MONTH)
    : 0;
  const hourlyElectricity = (powerDrawWatts / 1000) * electricityRatePerKwh;
  const hourlyTotal = hourlyHardware + hourlyElectricity;
  const requestsPerHour = total > 0 ? 3600 / total : 0;

  return {
    inputs: {
      hardwarePriceUsd, electricityRatePerKwh, powerDrawWatts, amortizationMonths,
      promptTokens, outputTokens, prefillSpeed, decodeSpeed
    },
    effectiveThroughputTokPerSec: round(throughput),
    requestsPerHour: round(requestsPerHour),
    hardwareCostUsdPerHour: round(hourlyHardware),
    electricityCostUsdPerHour: round(hourlyElectricity),
    totalCostUsdPerHour: round(hourlyTotal),
    costUsdPerMillionTokens: round(throughput > 0 ? (hourlyTotal / throughput) * 1e6 : null),
    costUsdPerThousandRequests: round(requestsPerHour > 0 ? (hourlyTotal / requestsPerHour) * 1000 : null)
  };
}

export function kvCache({ numLayers = 80, kvHeads = 8, headDim = 128, contextLength = 32768, precisionBytes = 2, batchSize = 1 } = {}) {
  const bytesPerToken = 2 * numLayers * kvHeads * headDim * precisionBytes;
  const totalBytes = bytesPerToken * contextLength * batchSize;
  return {
    inputs: { numLayers, kvHeads, headDim, contextLength, precisionBytes, batchSize },
    bytesPerToken,
    kbPerToken: round(bytesPerToken / 1024),
    totalGb: round(totalBytes / (1024 ** 3)),
    totalMb: round(totalBytes / (1024 ** 2)),
    formula: `2 × ${numLayers} layers × ${kvHeads} KV heads × ${headDim} dim × ${precisionBytes}B × ${contextLength} ctx × ${batchSize} batch`
  };
}

// ---- VRAM budget planner (issue #45) ---------------------------------------
// Full memory ledger: weights + KV cache + framework overhead vs a GPU's
// actual VRAM. Mirrors what the KV calculator tab renders so agents get the
// same verdict the page shows.
//
// vLLM (activation buffers, CUDA graphs, PagedAttention block tables) and
// llama.cpp (compute buffers, scratch) both reserve roughly 10–20% of VRAM on
// top of weights + KV. Default 15% sits in the middle of that band.

/** Utilization above which a fit is flagged 'warn' (tight but possible). */
export const VRAM_WARN_UTILIZATION = 0.9;
/** Framework overhead default — middle of the real-world 10–20% band. */
export const DEFAULT_OVERHEAD_FRACTION = 0.15;

/**
 * Build a VRAM ledger and pass/warn/fail verdict against an optional GPU.
 * Never throws; returns verdict null when no GPU capacity was given.
 */
export function vramBudget({ weightsGb = 0, kvGb = 0, overheadFraction = DEFAULT_OVERHEAD_FRACTION, gpuVramGb = null } = {}) {
  const w = Math.max(0, Number(weightsGb) || 0);
  const kv = Math.max(0, Number(kvGb) || 0);
  const overhead = Math.max(0, Number(overheadFraction) || 0);
  const overheadGb = (w + kv) * overhead;
  const totalGb = w + kv + overheadGb;

  const vram = Number.isFinite(Number(gpuVramGb)) ? Number(gpuVramGb) : null;
  const hasGpu = vram !== null && vram > 0;
  const utilization = hasGpu ? totalGb / vram : null;
  let verdict = null;
  if (hasGpu) {
    verdict = utilization <= VRAM_WARN_UTILIZATION ? 'pass' : utilization <= 1 ? 'warn' : 'fail';
  }

  return {
    inputs: { weightsGb: round(w), kvGb: round(kv), overheadFraction: overhead, gpuVramGb: hasGpu ? vram : null },
    weightsGb: round(w),
    kvGb: round(kv),
    overheadGb: round(overheadGb),
    totalGb: round(totalGb),
    headroomGb: hasGpu ? round(vram - totalGb) : null,
    utilizationPct: hasGpu ? round(utilization * 100) : null,
    fits: verdict === 'pass' || verdict === 'warn',
    verdict
  };
}

function round(x) {
  if (!Number.isFinite(x)) return null;
  return Math.round(x * 1e6) / 1e6;
}
