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

import { calculateAgenticTimeline } from './agenticMath.js';

export const EXPORT_JSON_VERSION = 1;
export const GENERATOR_ID = 'llm-prefill-decode-visualizer';

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
 * Mirrors the math in buildSingleTurnMarkdown (exportMarkdown.js).
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
  deepLink,
  generatedAt = new Date().toISOString()
}) {
  const safePrompt = Math.max(0, promptTokens || 0);
  const safeOutput = Math.max(0, outputTokens || 0);
  const ttftSeconds = safePrompt / prefillSpeed;
  const decodeTimeSeconds = safeOutput / effectiveDecodeSpeed;
  const totalWalltimeSeconds = ttftSeconds + decodeTimeSeconds;
  const tpotMs = effectiveDecodeSpeed > 0 ? 1000 / effectiveDecodeSpeed : Infinity;
  const throughputTokPerSec = totalWalltimeSeconds > 0
    ? (safePrompt + safeOutput) / totalWalltimeSeconds
    : 0;
  const prefillSharePct = totalWalltimeSeconds > 0 ? (ttftSeconds / totalWalltimeSeconds) * 100 : 0;
  const decodeSharePct = totalWalltimeSeconds > 0 ? (decodeTimeSeconds / totalWalltimeSeconds) * 100 : 0;

  return {
    schemaVersion: EXPORT_JSON_VERSION,
    generator: GENERATOR_ID,
    generatorId: GENERATOR_ID,
    exportType: 'single-turn-chat',
    generatedAt,
    deepLink,
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
      }
    },
    metrics: {
      ttftSeconds: roundTo(ttftSeconds),
      tpotMs: roundTo(tpotMs),
      decodeTimeSeconds: roundTo(decodeTimeSeconds),
      totalWalltimeSeconds: roundTo(totalWalltimeSeconds),
      effectiveDecodeSpeedTokPerSec: roundTo(effectiveDecodeSpeed, 2),
      throughputTokPerSec: roundTo(throughputTokPerSec, 2),
      prefillSharePct: roundTo(prefillSharePct, 2),
      decodeSharePct: roundTo(decodeSharePct, 2)
    }
  };
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
  generatedAt = new Date().toISOString()
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

  return {
    schemaVersion: EXPORT_JSON_VERSION,
    generator: GENERATOR_ID,
    generatorId: GENERATOR_ID,
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
      prefixCachingEnabled: Boolean(enablePrefixCaching)
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
    summary: {
      totalWalltimeSeconds: roundTo(totalWalltimeSeconds),
      finalContextTokens,
      totalTokensProcessed,
      avgThroughputTokPerSec: roundTo(totalWalltimeSeconds > 0 ? totalTokensProcessed / totalWalltimeSeconds : 0, 2),
      walltimeWithoutCachingSeconds: roundTo(noCacheWalltimeSeconds),
      cachingTimeSavedSeconds: roundTo(cachingTimeSavedSeconds),
      cachingSavingsPct: roundTo(cachingSavingsPct, 2)
    }
  };
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
