// Shared engine-feature math for single-turn exports (#698).
//
// The on-page simulation (SingleTurnVisualizer) applies three engine features
// that change TTFT / decode time / walltime — attached images (vision tokens
// extend prefill), context scaling (closed-form scaled decode walltime) and
// ITL jitter (seeded per-token latency draws). Both exporters
// (exportMarkdown.js + exportJson.js) import THIS module so their numbers are
// computed once and can never drift apart from each other or from the page.
//
// Pure functions only: same inputs → same outputs, deterministic exports.

import { IMAGE_RESOLUTION_PRESETS, estimateImageTokens } from './multimodal.js';
import {
  DEFAULT_HALF_SPEED_CONTEXT,
  scaledDecodeTime,
  averageScaledSpeed
} from './contextScaling.js';
import { drawItlSamples, summarizeItl } from './itl.js';

// Must stay in sync with ITL_SEED in SingleTurnVisualizer.jsx so an exported
// run replays to the exact same per-token draw sequence as the page.
export const EXPORT_ITL_SEED = 20260821;

const DEFAULT_IMAGE_RES_ID = '1080p';

/**
 * Recompute the single-turn run with every active engine feature applied,
 * mirroring SingleTurnVisualizer.jsx lines ~156-203 exactly.
 *
 * @returns {object} sanitized inputs detail + feature-aware metrics.
 */
export function computeSingleTurnEngineRun({
  promptTokens,
  outputTokens,
  prefillSpeed,
  decodeSpeed, // eslint-disable-line no-unused-vars -- kept in signature for parity with callers/docs
  specEnabled, // eslint-disable-line no-unused-vars -- signature parity; see acceptance below
  draftTokens, // eslint-disable-line no-unused-vars -- signature parity; see acceptance below
  acceptance, // eslint-disable-line no-unused-vars -- spec params kept for signature parity; spec math is pre-folded into effectiveDecodeSpeed
  effectiveDecodeSpeed,
  ctxScaleEnabled = false,
  ctxHalf,
  imagesEnabled = false,
  imageCount = 1,
  imageResId,
  jitterEnabled = false,
  jitterPct = 25
}) {
  const safePrompt = Math.max(0, promptTokens || 0);
  const safeOutput = Math.max(0, outputTokens || 0);

  // --- Attached images: vision-encoder tokens join prefill -----------------
  const resolutionId = IMAGE_RESOLUTION_PRESETS.some(p => p.id === imageResId)
    ? imageResId
    : DEFAULT_IMAGE_RES_ID;
  const resolutionPreset =
    IMAGE_RESOLUTION_PRESETS.find(p => p.id === resolutionId) ||
    IMAGE_RESOLUTION_PRESETS.find(p => p.id === DEFAULT_IMAGE_RES_ID);
  const safeImageCount = imagesEnabled
    ? Math.min(8, Math.max(1, Math.round(imageCount || 1)))
    : 0;
  const imageTokensPerImage = estimateImageTokens(resolutionPreset);
  const imageTokensTotal = imageTokensPerImage * safeImageCount;
  const totalPrefillTokens = safePrompt + imageTokensTotal;

  // --- Prefill --------------------------------------------------------------
  const ttftSeconds = totalPrefillTokens / prefillSpeed;

  // --- Decode: context scaling → closed-form walltime ----------------------
  const ctxHalfSafe = Math.max(1024, ctxHalf || DEFAULT_HALF_SPEED_CONTEXT);
  const ctxActive = Boolean(ctxScaleEnabled) && safeOutput > 0;
  const preJitterDecodeTimeSeconds = ctxActive
    ? scaledDecodeTime(effectiveDecodeSpeed, totalPrefillTokens, safeOutput, ctxHalfSafe)
    : safeOutput / effectiveDecodeSpeed;
  // Average per-token time under scaling feeds the ITL draws (mean-preserving).
  const tpotMs = safeOutput > 0
    ? (1000 * preJitterDecodeTimeSeconds) / Math.max(1, safeOutput)
    : Infinity;
  const avgDecodeSpeedTokPerSec = ctxActive
    ? averageScaledSpeed(effectiveDecodeSpeed, totalPrefillTokens, safeOutput, ctxHalfSafe)
    : effectiveDecodeSpeed;

  // --- Decode: seeded ITL jitter --------------------------------------------
  const itlCv = jitterEnabled ? jitterPct / 100 : 0;
  const itlSamples =
    jitterEnabled && Number.isFinite(tpotMs) && safeOutput > 0
      ? drawItlSamples({ baseMs: tpotMs, cv: itlCv, count: safeOutput, seed: EXPORT_ITL_SEED })
      : [];
  const decodeTimeSeconds = itlSamples.length > 0
    ? itlSamples.reduce((acc, ms) => acc + ms, 0) / 1000
    : preJitterDecodeTimeSeconds;
  const itlSummary = itlSamples.length > 0 ? summarizeItl(itlSamples) : null;

  // --- Aggregates -------------------------------------------------------------
  const totalWalltimeSeconds = ttftSeconds + decodeTimeSeconds;
  const throughputTokPerSec = totalWalltimeSeconds > 0
    ? (totalPrefillTokens + safeOutput) / totalWalltimeSeconds
    : 0;
  const prefillSharePct = totalWalltimeSeconds > 0
    ? (ttftSeconds / totalWalltimeSeconds) * 100
    : 0;
  const decodeSharePct = totalWalltimeSeconds > 0
    ? (decodeTimeSeconds / totalWalltimeSeconds) * 100
    : 0;

  return {
    // Sanitized input detail (both exporters render these identically).
    safePrompt,
    safeOutput,
    imagesEnabled: Boolean(imagesEnabled),
    imageCount: safeImageCount,
    imageResolutionId: resolutionId,
    imageResolutionLabel: resolutionPreset.label,
    imageTokensPerImage,
    imageTokensTotal,
    ctxScaleEnabled: Boolean(ctxScaleEnabled),
    ctxHalfSafe,
    jitterEnabled: Boolean(jitterEnabled),
    jitterPct,
    // Feature-aware metrics.
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
  };
}
