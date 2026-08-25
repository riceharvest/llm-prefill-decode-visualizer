// Export a simulation as machine-readable JSON for agents and scripts.
//
// Like exportMarkdown.js / exportPng.js, the builders are pure functions
// (no DOM access) so the output is deterministic and unit-testable: the same
// inputs always produce byte-identical JSON (given the same `generatedAt`).
//
// Stability contract for consumers:
// - `schemaVersion` is bumped whenever a field is renamed/removed or its
//   meaning changes. Additive fields do NOT bump the version.
// - Field names are stable snakeCase-free camelCase keys; units are encoded
//   in the name (…Seconds, …Ms, …Tokens, …TokPerSec, …Pct).
// - Numbers are rounded to a fixed precision so output is deterministic.
//
// Cross-`exportType` field-equivalence table (#722) — both builders ship under
// the same schemaVersion=1 and follow ONE convention. Canonical form first;
// legacy/alias forms are kept so v1 consumers keep parsing unchanged:
//
// | Concept              | single-turn-chat            | agentic-tool-loop                |
// | -------------------- | --------------------------- | -------------------------------- |
// | Metric container     | `metrics`                   | `metrics` (alias of `summary`)   |
// | Average throughput   | `avgThroughputTokPerSec`    | `avgThroughputTokPerSec`         |
// | Throughput alias     | `throughputTokPerSec`       | `throughputTokPerSec` (in both)  |
// | Feature toggle       | object `{ enabled, … }`     | object `{ enabled }`; the flat   |
// |                      | (speculativeDecoding,       | boolean `prefixCachingEnabled`   |
// |                      | contextScaling, attached-   | and `contextScalingEnabled`-style|
// |                      | Images, itlJitter           | booleans remain as aliases       |
// New payloads should key off `metrics` + object toggles; every alias above is
// populated with an identical value in the same payload.

import { calculateAgenticTimeline } from './agenticMath.js';
import { computeSingleTurnEngineRun } from './exportEngineMath.js';
import { DEFAULT_HALF_SPEED_CONTEXT } from './contextScaling.js';
import { evaluateSlo, evaluateAgenticSlo } from './slo.js';

export const EXPORT_JSON_VERSION = 1;
export const GENERATOR_ID = 'llm-prefill-decode-visualizer';

// Hard cap on the optional per-token series (#426) so a runaway ?output=
// value cannot balloon the export payload. The cap mirrors the UI slider
// ceiling order-of-magnitude; tokens beyond it are truncated.
export const MAX_SERIES_TOKENS = 10000;

/**
 * Build the additive `slo` export block (#425): the active budgets plus the
 * same pass/fail verdicts the ✓/✗ badges show on the page. All values use one
 * canonical unit (milliseconds). Returns undefined when no budget is active,
 * so exports without SLO budgets stay byte-identical to their previous shape.
 */
export function buildSloExport(ttftSec, tpotMsValue, walltimeSecValue, budgets) {
  const r = evaluateSlo(
    { ttftSec, tpotMs: tpotMsValue, walltimeSec: walltimeSecValue },
    budgets
  );
  const results = [];
  if (r.ttft) results.push({ metric: 'ttft', valueMs: r.ttft.value, budgetMs: r.ttft.budget, pass: r.ttft.pass, marginPct: roundTo(r.ttft.marginPct, 2) });
  if (r.tpot) results.push({ metric: 'tpot', valueMs: r.tpot.value, budgetMs: r.tpot.budget, pass: r.tpot.pass, marginPct: roundTo(r.tpot.marginPct, 2) });
  if (r.walltime) results.push({ metric: 'walltime', valueMs: r.walltime.value, budgetMs: r.walltime.budget, pass: r.walltime.pass, marginPct: roundTo(r.walltime.marginPct, 2) });
  if (results.length === 0) return undefined;
  return {
    budgets: {
      ttftMs: budgets?.ttftMs ?? null,
      tpotMs: budgets?.tpotMs ?? null,
      walltimeMs: budgets?.walltimeSec != null ? budgets.walltimeSec * 1000 : null
    },
    results
  };
}

/**
 * Build the optional per-token decode timeline (#426). `scheduleMs` is the
 * cumulative per-token emission schedule in ms since decode start (jittered
 * when ITL jitter is on, constant otherwise); `prefillEndMs` anchors token 0
 * at the TTFT instant. Deterministic by construction — the schedule comes
 * from the seeded drawItlSamples distribution. Returns undefined when no
 * schedule is available so default exports stay unchanged.
 */
export function buildSeriesExport(prefillEndMs, scheduleMs) {
  if (!Array.isArray(scheduleMs) || scheduleMs.length === 0) return undefined;
  const prefillEnd = Number.isFinite(prefillEndMs) ? prefillEndMs : 0;
  const n = Math.min(scheduleMs.length, MAX_SERIES_TOKENS);
  let prev = 0;
  const tokens = new Array(n);
  for (let i = 0; i < n; i++) {
    const tMs = prefillEnd + (Number(scheduleMs[i]) || 0);
    tokens[i] = { i, tMs: roundTo(tMs, 2), itlMs: i === 0 ? null : roundTo(tMs - prev, 2) };
    prev = tMs;
  }
  return { prefillEndMs: roundTo(prefillEnd, 2), tokenCount: scheduleMs.length, tokens };
}

/** Round to `digits` decimals; non-finite input passes through unchanged. */
export function roundTo(value, digits = 4) {
  if (!Number.isFinite(value)) return value;
  const f = 10 ** digits;
  return Math.round(value * f) / f;
}

// ---------------------------------------------------------------------------
// Single-turn chat export
// ---------------------------------------------------------------------------

/**
 * Build the machine-readable single-turn simulation export.
 * Mirrors the math in buildSingleTurnMarkdown (exportMarkdown.js); both
 * delegate the engine-feature math (attached images, context scaling, ITL
 * jitter — #698) to computeSingleTurnEngineRun so MD and JSON can't drift.
 */
export function buildSingleTurnJson({
  promptTokens,
  outputTokens,
  prefillSpeed,
  decodeSpeed,
  specEnabled,
  draftTokens,
  acceptance,
  effectiveDecodeSpeed,
  ctxScaleEnabled,
  ctxHalf,
  imagesEnabled,
  imageCount,
  imageResId,
  jitterEnabled,
  jitterPct,
  deepLink,
  provenance,
  generatedAt = new Date().toISOString(),
  // Optional richer-state inputs (issue #408): present in the output only when
  // the caller provides them, so existing consumers' outputs are unchanged.
  engineFlags,
  itlJitter,
  images,
  contextScaling,
  sloBudgets,
  sloResults,
    includeSeries = false,  // ?series=1 -> per-token decode timeline
  prefillEndMs = 0,       // TTFT instant anchoring the series
  itlScheduleMs = null    // cumulative per-token emission schedule (ms)
}) {
  const run = computeSingleTurnEngineRun({
    promptTokens,
    outputTokens,
    prefillSpeed,
    decodeSpeed,
    specEnabled,
    draftTokens,
    acceptance,
    effectiveDecodeSpeed,
    ctxScaleEnabled,
    ctxHalf,
    imagesEnabled,
    imageCount,
    imageResId,
    jitterEnabled,
    jitterPct
  });
  const {
    safePrompt,
    safeOutput,
    imagesEnabled: imgOn,
    imageCount: imgN,
    imageResolutionId,
    imageResolutionLabel,
    imageTokensPerImage,
    imageTokensTotal,
    ctxScaleEnabled: ctxOn,
    ctxHalfSafe,
    jitterEnabled: jitOn,
    jitterPct: jitPctSafe,
    totalPrefillTokens,
    ttftSeconds,
    tpotMs,
    decodeTimeSeconds,
    totalWalltimeSeconds,
    avgDecodeSpeedTokPerSec,
    throughputTokPerSec,
    prefillSharePct,
    decodeSharePct,
    itlSummary
  } = run;

  const metrics = {
      ttftSeconds: roundTo(ttftSeconds),
      tpotMs: roundTo(tpotMs),
      decodeTimeSeconds: roundTo(decodeTimeSeconds),
      totalWalltimeSeconds: roundTo(totalWalltimeSeconds),
      effectiveDecodeSpeedTokPerSec: roundTo(effectiveDecodeSpeed, 2),
      avgDecodeSpeedTokPerSec: roundTo(avgDecodeSpeedTokPerSec, 2),
      prefillTokensTotal: totalPrefillTokens,
      imageTokensTotal,
      throughputTokPerSec: roundTo(throughputTokPerSec, 2),
      avgThroughputTokPerSec: roundTo(throughputTokPerSec, 2),
      prefillSharePct: roundTo(prefillSharePct, 2),
      decodeSharePct: roundTo(decodeSharePct, 2)
  };
  // ITL tail percentiles only carry meaning when the seeded draws ran; they
  // appear as additive fields exactly when inputs.itlJitter.enabled is true.
  if (itlSummary) {
    metrics.itlMeanMs = roundTo(itlSummary.mean);
    metrics.itlP50Ms = roundTo(itlSummary.p50);
    metrics.itlP95Ms = roundTo(itlSummary.p95);
    metrics.itlP99Ms = roundTo(itlSummary.p99);
  }

  const payload = {
    schemaVersion: EXPORT_JSON_VERSION,
    generator: GENERATOR_ID,
    exportType: 'single-turn-chat',
    generatedAt,
    deepLink,
    // LocalMaxxing measurement provenance (#602): present only when the
    // active preset is lmx:<runId> so synthetic-preset exports stay
    // byte-identical to before.
    ...(provenance ? { provenance } : {}),
    inputs: {
      promptTokens: safePrompt,
      outputTokens: safeOutput,
      prefillSpeedTokPerSec: prefillSpeed,
      decodeSpeedTokPerSec: decodeSpeed,
      speculativeDecoding: {
        enabled: Boolean(specEnabled),
        draftTokens: specEnabled ? draftTokens : 0,
        acceptanceRate: specEnabled ? acceptance : 0,
        draftCost: specEnabled ? 0.2 : 0
      },
      // Engine features that alter the metrics below (#698): present in every
      // payload so a consumer can tell from the inputs alone which features
      // were active for this run. Object-toggle convention per #722.
      contextScaling: {
        enabled: ctxOn,
        halfSpeedContextTokens: ctxOn ? ctxHalfSafe : DEFAULT_HALF_SPEED_CONTEXT
      },
      attachedImages: {
        enabled: imgOn,
        count: imgN,
        resolutionId: imgOn ? imageResolutionId : null,
        resolutionLabel: imgOn ? imageResolutionLabel : null,
        tokensPerImage: imgOn ? imageTokensPerImage : 0,
        tokensTotal: imageTokensTotal
      },
      itlJitter: {
        enabled: jitOn,
        jitterPct: jitOn ? jitPctSafe : 0
      }
    },
    metrics
  };
  const slo = buildSloExport(ttftSeconds, tpotMs, totalWalltimeSeconds, sloBudgets);
  if (slo) payload.slo = slo;
  if (includeSeries) {
    const series = buildSeriesExport(prefillEndMs || ttftSeconds * 1000, itlScheduleMs);
    if (series) payload.series = series;
  }
  return payload;
}

// ---------------------------------------------------------------------------
// Agentic tool-loop export
// ---------------------------------------------------------------------------

/**
 * Build the machine-readable agentic tool-loop simulation export.
 * Mirrors the math in buildAgenticMarkdown (exportMarkdown.js).
 */
export function buildAgenticJson({
  numTurns,
  basePromptTokens,
  toolOutputTokensPerTurn,
  decodeTokensPerTurn,
  enablePrefixCaching,
  prefillSpeed,
  decodeSpeed,
  deepLink,
  generatedAt = new Date().toISOString(),
  sloBudgets = null // #425: active SLO budgets → `slo` verdict block
}) {
  const turns = calculateAgenticTimeline({
    numTurns,
    basePromptTokens,
    toolOutputTokensPerTurn,
    decodeTokensPerTurn,
    prefillSpeed,
    decodeSpeed,
    enablePrefixCaching
  });

  const totalWalltimeSeconds = turns.reduce((acc, t) => acc + t.turnWalltime, 0);
  const noCacheWalltimeSeconds = enablePrefixCaching
    ? calculateAgenticTimeline({
      numTurns,
      basePromptTokens,
      toolOutputTokensPerTurn,
      decodeTokensPerTurn,
      prefillSpeed,
      decodeSpeed,
      enablePrefixCaching: false
    }).reduce((acc, t) => acc + t.turnWalltime, 0)
    : totalWalltimeSeconds;
  const cachingTimeSavedSeconds = noCacheWalltimeSeconds - totalWalltimeSeconds;
  const cachingSavingsPct = noCacheWalltimeSeconds > 0
    ? (cachingTimeSavedSeconds / noCacheWalltimeSeconds) * 100
    : 0;
  const last = turns[turns.length - 1];
  const finalContextTokens = turns.length
    ? last.totalPromptTokens + last.decodeTokens
    : 0;
  const totalTokensProcessed = turns.reduce((acc, t) => acc + t.newTokensPrefilled + t.decodeTokens, 0);

  // Legacy `summary` container kept for v1 back-compat; `metrics` is the
  // canonical container shared with single-turn-chat per the #722 unification.
  const summary = {
    totalWalltimeSeconds: roundTo(totalWalltimeSeconds),
    finalContextTokens,
    totalTokensProcessed,
    avgThroughputTokPerSec: roundTo(totalWalltimeSeconds > 0 ? totalTokensProcessed / totalWalltimeSeconds : 0, 2),
    walltimeWithoutCachingSeconds: roundTo(noCacheWalltimeSeconds),
    cachingTimeSavedSeconds: roundTo(cachingTimeSavedSeconds),
    cachingSavingsPct: roundTo(cachingSavingsPct, 2)
  };
  const metrics = {
    ...summary,
    throughputTokPerSec: summary.avgThroughputTokPerSec
  };

  const payload = {
    schemaVersion: EXPORT_JSON_VERSION,
    generator: GENERATOR_ID,
    exportType: 'agentic-tool-loop',
    generatedAt,
    deepLink,
    inputs: {
      numTurns,
      basePromptTokens,
      toolOutputTokensPerTurn,
      decodeTokensPerTurn,
      prefillSpeedTokPerSec: prefillSpeed,
      decodeSpeedTokPerSec: decodeSpeed,
      prefixCachingEnabled: Boolean(enablePrefixCaching),
      // Object-toggle convention (#722): mirrors speculativeDecoding.enabled /
      // contextScaling.enabled in single-turn exports. The flat boolean above
      // is retained as a v1 alias carrying an identical value.
      prefixCaching: { enabled: Boolean(enablePrefixCaching) }
    },
    turns: turns.map(t => ({
      turn: t.turn,
      totalPromptTokens: t.totalPromptTokens,
      newTokensPrefilled: t.newTokensPrefilled,
      decodeTokens: t.decodeTokens,
      prefillTimeSeconds: roundTo(t.prefillTime),
      decodeTimeSeconds: roundTo(t.decodeTime),
      turnWalltimeSeconds: roundTo(t.turnWalltime),
      cumulativeWalltimeSeconds: roundTo(t.cumulativeWalltime),
      kvCacheReused: t.isCached
    })),
    summary,
    metrics
  };
  // #425: mirror the per-turn ✓/✗ badges — whole-loop verdicts plus the
  // failing-turn list the UI's offender banner names.
  if (sloBudgets && (sloBudgets.ttftMs || sloBudgets.tpotMs || sloBudgets.walltimeSec)) {
    const first = turns[0] || { prefillTime: 0 };
    const decodeTurns = turns.filter(t => t.decodeTokens > 0);
    const avgTpotMs = decodeTurns.length > 0
      ? decodeTurns.reduce((sum, t) => sum + (1000 * t.decodeTime) / t.decodeTokens, 0) / decodeTurns.length
      : Infinity;
    const slo = buildSloExport(first.prefillTime, avgTpotMs, totalWalltimeSeconds, sloBudgets);
    if (slo) {
      const agentic = evaluateAgenticSlo(turns, sloBudgets);
      payload.slo = { ...slo, failingTurns: agentic.failingTurns, worstTurn: agentic.worstTurn };
    }
  }
  return payload;
}

// ---------------------------------------------------------------------------
// Delivery: serialize + download (mirrors downloadMarkdown in exportMarkdown.js)
// ---------------------------------------------------------------------------

/** Deterministic pretty-printed JSON text for a payload object. */
export function serializeJson(payload) {
  return JSON.stringify(payload, null, 2) + '\n';
}

/** Trigger a browser download of a JSON export object. */
export function downloadJson(payload, filename = 'simulation.json') {
  const text = serializeJson(payload);
  const blob = new Blob([text], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
