// Pure inference-math shared by the /api/compute endpoint.
// Mirrors the formulas the visualizer UI uses — single source of truth so
// agents get exactly the numbers the page shows.

export function singleTurn({ promptTokens = 2048, outputTokens = 512, prefillSpeed = 3800, decodeSpeed = 105 } = {}) {
  const ttft = promptTokens / prefillSpeed;
  const decodeTime = outputTokens / decodeSpeed;
  const total = ttft + decodeTime;
  return {
    inputs: { promptTokens, outputTokens, prefillSpeed, decodeSpeed },
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

function round(x) {
  if (!Number.isFinite(x)) return null;
  return Math.round(x * 1e6) / 1e6;
}
