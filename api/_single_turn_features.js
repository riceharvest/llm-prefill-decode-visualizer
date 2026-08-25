// Single-turn engine features for the /api/compute API (#472, #480).
//
// The browser bundle models four engine features the API silently ignored:
// ITL jitter (jit/jitPct), context-length scaling (ctx/ctxHalf), attached
// images (img/imgN/imgRes) and SLO budget evaluation. This module ports the
// EXACT same math the UI uses — same helpers, same defaults, same seed — so
// an agent calling the API gets the numbers the page shows.
//
// All feature params are opt-in: when none is requested the response is
// byte-identical to plain singleTurn() output (additive, non-breaking).

import { singleTurn } from './_math.js';
import {
  scaledDecodeTime
} from '../src/utils/contextScaling.js';
import { estimateImageTokens, IMAGE_RESOLUTION_PRESETS } from '../src/utils/multimodal.js';
import { drawItlSamples, summarizeItl } from '../src/utils/itl.js';

// Same seed the visualizer uses so share links and API calls agree.
export const ITL_SEED = 20260821;
export const DEFAULT_HALF_SPEED_CONTEXT = 32768;

function num(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function boolish(v) {
  return v === '1' || v === 1 || v === 'true' || v === true;
}

/**
 * Parse the optional feature params off a request. Returns null when no
 * feature was requested (caller should use plain singleTurn), otherwise a
 * resolved feature-inputs object with every default filled in and echoed.
 */
export function resolveSingleTurnFeatures(params = {}) {
  const ctxEnabled = boolish(params.ctx);
  const imgEnabled = boolish(params.img);
  const jitEnabled = boolish(params.jit);
  if (!ctxEnabled && !imgEnabled && !jitEnabled) return null;

  // Context scaling: C½ (cache depth at which decode speed halves).
  const halfSpeedContext = Math.max(1024, num(params.ctxHalf, DEFAULT_HALF_SPEED_CONTEXT));

  // Images: count 1–8, resolution preset id (UI offers 720p/1080p/1440p/4k).
  const imgN = Math.min(8, Math.max(1, Math.round(num(params.imgN, 1))));
  const imgResRaw = String(params.imgRes ?? '');
  const imageResId = IMAGE_RESOLUTION_PRESETS.some(p => p.id === imgResRaw) ? imgResRaw : '1080p';
  const imageResolution = IMAGE_RESOLUTION_PRESETS.find(p => p.id === imageResId);
  const tokensPerImage = estimateImageTokens(imageResolution);

  // ITL jitter: coefficient of variation in percent, UI clamps to [5,60].
  const jitPct = Math.min(60, Math.max(5, Math.round(num(params.jitPct, 25) / 5) * 5));

  return {
    contextScaling: ctxEnabled ? { enabled: true, halfSpeedContext } : null,
    images: imgEnabled ? { enabled: true, count: imgN, resolution: imageResId, tokensPerImage, totalImageTokens: tokensPerImage * imgN } : null,
    jitter: jitEnabled ? { enabled: true, cvPct: jitPct, seed: ITL_SEED } : null
  };
}

/**
 * Run the single-turn simulation with resolved features applied.
 * Mirrors SingleTurnVisualizer's math:
 *   - image tokens join the prompt during prefill (TTFT grows),
 *   - context scaling slows decode linearly as the KV cache fills
 *     (closed-form walltime, tpot reported at the average depth),
 *   - jitter draws seeded mean-preserving lognormal per-token latencies;
 *     decode walltime becomes the sum of drawn gaps (mean-preserving).
 * Returns the plain singleTurn() shape plus additive feature blocks.
 */
export function simulateSingleTurnFeatures(baseInputs, features) {
  const base = singleTurn(baseInputs);

  const promptTokens = baseInputs.promptTokens;
  const outputTokens = baseInputs.outputTokens;
  const prefillSpeed = baseInputs.prefillSpeed;
  const decodeSpeed = baseInputs.decodeSpeed;

  const totalPrefillTokens = promptTokens + (features.images?.totalImageTokens ?? 0);
  const halfSpeedContext = features.contextScaling
    ? features.contextScaling.halfSpeedContext
    : DEFAULT_HALF_SPEED_CONTEXT;

  // TTFT: image tokens are ingested before the first text token emerges.
  const ttftSeconds = totalPrefillTokens > 0 && prefillSpeed > 0
    ? totalPrefillTokens / prefillSpeed
    : base.ttftSeconds;

  // Decode: closed form under context scaling; plain n/speed otherwise.
  const ctxScaledDecodeTime = features.contextScaling && outputTokens > 0
    ? scaledDecodeTime(decodeSpeed, totalPrefillTokens, outputTokens, halfSpeedContext)
    : (decodeSpeed > 0 ? outputTokens / decodeSpeed : Infinity);
  let tpotMs = ctxScaledDecodeTime > 0 ? (1000 * ctxScaledDecodeTime) / Math.max(1, outputTokens) : Infinity;

  // Jitter: mean-preserving draws; decode walltime = sum of drawn gaps.
  let itl = null;
  let decodeSeconds = ctxScaledDecodeTime;
  if (features.jitter && Number.isFinite(tpotMs) && outputTokens > 0) {
    const samples = drawItlSamples({
      baseMs: tpotMs,
      cv: features.jitter.cvPct / 100,
      count: outputTokens,
      seed: features.jitter.seed
    });
    const summary = summarizeItl(samples);
    itl = {
      cvPct: features.jitter.cvPct,
      seed: features.jitter.seed,
      count: summary.count,
      meanMs: round(summary.mean),
      p50Ms: round(summary.p50),
      p95Ms: round(summary.p95),
      p99Ms: round(summary.p99),
      minMs: round(summary.min),
      maxMs: round(summary.max)
    };
    decodeSeconds = samples.reduce((acc, s) => acc + s, 0) / 1000;
  }

  const totalWalltimeSeconds = ttftSeconds + decodeSeconds;
  const total = totalWalltimeSeconds;
  const effectiveThroughputTokPerSec = total > 0
    ? (totalPrefillTokens + outputTokens) / total
    : 0;

  return {
    ...base,
    ttftSeconds: round(ttftSeconds),
    tpotMs: Number.isFinite(tpotMs) ? round(tpotMs) : null,
    decodeSeconds: round(decodeSeconds),
    totalWalltimeSeconds: round(total),
    effectiveThroughputTokPerSec: round(effectiveThroughputTokPerSec),
    prefillSharePct: round(total > 0 ? (ttftSeconds / total) * 100 : 0),
    decodeSharePct: round(total > 0 ? (decodeSeconds / total) * 100 : 0),
    ...(features.contextScaling ? { contextScaling: features.contextScaling } : {}),
    ...(features.images ? { images: features.images } : {}),
    ...(itl ? { itl } : {})
  };
}

/**
 * Server-side SLO evaluation (#480): the same pass/fail verdict the views
 * render from user budgets, computed over the API metrics instead of the DOM.
 * Budgets are optional; each metric evaluates only when its budget is present,
 * positive and finite (mirrors src/utils/slo.js sanitizeBudgets semantics).
 */
export function evaluateSlo({ maxTtftSeconds, maxTpotMs, ttftSeconds, tpotMs }) {
  const budgets = {};
  const checks = {};

  const ttftBudget = positiveFinite(maxTtftSeconds);
  if (ttftBudget !== null) {
    budgets.maxTtftSeconds = ttftBudget;
    checks.ttft = {
      valueSeconds: ttftSeconds ?? null,
      pass: ttftSeconds != null && Number.isFinite(ttftSeconds) ? ttftSeconds <= ttftBudget : null
    };
  }
  const tpotBudget = positiveFinite(maxTpotMs);
  if (tpotBudget !== null) {
    budgets.maxTpotMs = tpotBudget;
    checks.tpot = {
      valueMs: tpotMs ?? null,
      pass: tpotMs != null && Number.isFinite(tpotMs) ? tpotMs <= tpotBudget : null
    };
  }

  if (!Object.keys(budgets).length) return null;

  const results = Object.values(checks).map(c => c.pass).filter(p => p !== null);
  const verdict = results.length === 0 ? null : results.every(Boolean) ? 'pass' : 'fail';

  return { budgets, ...checks, verdict };
}

function positiveFinite(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function round(x) {
  if (!Number.isFinite(x)) return null;
  return Math.round(x * 1e6) / 1e6;
}
