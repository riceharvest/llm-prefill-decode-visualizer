// Human-reading-speed anchors (issue #86 / #90): calibrated comparisons that
// turn abstract latency figures into embodied intuition. All anchors derive
// from a fast human reader at ~250 wpm ≈ 330 tok/s (≈1.32 tokens per word).
//
// Every function returns a display-ready string, or null when the inputs are
// invalid/non-finite — callers render nothing for null so degenerate states
// (0 tok/s, ∞ ms) never show a bogus comparison.

// ~250 words per minute at ≈1.32 tokens per word (OpenAI tokenizer heuristic).
export const FAST_HUMAN_READER_TPS = 330;
// Cadence at which a fast reader absorbs tokens: 1000 ms ÷ 330 tok/s ≈ 3 ms.
export const HUMAN_TOKEN_GAP_MS = 1000 / FAST_HUMAN_READER_TPS;
// Average human blink lasts ~100–400 ms; use the midpoint as the "instant" bar.
export const BLINK_SECONDS = 0.3;

const isNum = (n) => typeof n === 'number' && Number.isFinite(n);

function fmtDuration(seconds) {
  if (seconds >= 5400) return `${(seconds / 3600).toFixed(1)} h`;
  if (seconds >= 90) return `${Math.round(seconds / 60)} min`;
  if (seconds >= 10) return `${Math.round(seconds)} s`;
  if (seconds >= 1) return `${seconds.toFixed(1)} s`;
  return `${Math.round(seconds * 1000)} ms`;
}

/**
 * Anchor for any tok/s figure: how does it compare to a fast human reader?
 * e.g. "≈2.1× faster than a fast human reader (~330 tok/s)".
 */
export function throughputAnchor(tokensPerSecond) {
  if (!isNum(tokensPerSecond) || tokensPerSecond <= 0) return null;
  const ratio = tokensPerSecond / FAST_HUMAN_READER_TPS;
  // Within ±15% counts as "the same pace" — avoid noise like "1.04×".
  if (ratio >= 0.87 && ratio <= 1.15) {
    return `About the pace of a fast human reader (~330 tok/s)`;
  }
  if (ratio > 1) {
    return `≈${ratio.toFixed(1)}× faster than a fast human reader (~330 tok/s)`;
  }
  const slowerRatio = FAST_HUMAN_READER_TPS / tokensPerSecond;
  return `≈${slowerRatio.toFixed(1)}× slower than a fast human reader (~330 tok/s)`;
}

/**
 * Anchor for TTFT. Below a blink it says so outright; above ~2 s it compares
 * against the time a fast reader would need just to skim the same prompt.
 */
export function ttftAnchor(ttftSeconds, promptTokens) {
  if (!isNum(ttftSeconds) || ttftSeconds < 0) return null;
  if (ttftSeconds < BLINK_SECONDS) return 'Shorter than a blink';
  const promptTok = isNum(promptTokens) ? Math.max(0, promptTokens) : 0;
  const skimSeconds = promptTok / FAST_HUMAN_READER_TPS;
  if (skimSeconds > 0 && ttftSeconds >= 2 * skimSeconds) {
    return `A fast reader skims this prompt in ${fmtDuration(skimSeconds)} — you wait ${fmtDuration(ttftSeconds)}`;
  }
  if (ttftSeconds < 2) return 'Longer than a blink, shorter than a coffee sip';
  return `${fmtDuration(ttftSeconds)} before the first word appears`;
}

/**
 * Anchor for TPOT: compare the token arrival cadence against how fast a
 * fast human reader can absorb tokens (~3 ms/token). LLMs decode far slower
 * than reading pace, which is why streaming feels comfortable.
 */
export function tpotAnchor(tpotMs) {
  if (!isNum(tpotMs) || tpotMs <= 0) return null;
  if (tpotMs <= HUMAN_TOKEN_GAP_MS) return 'Faster than a fast reader can absorb tokens';
  const ratio = tpotMs / HUMAN_TOKEN_GAP_MS;
  if (ratio <= 1.15) return 'About the cadence of a fast human reader';
  return `Each token lands ≈${ratio.toFixed(1)}× slower than a fast reader reads (~3 ms/tok)`;
}

/**
 * Anchor for total walltime / decode time: how long would a fast human reader
 * need just to read the generated answer aloud at the same pace?
 */
export function walltimeAnchor(walltimeSeconds, outputTokens) {
  if (!isNum(walltimeSeconds) || walltimeSeconds <= 0) return null;
  const outTok = isNum(outputTokens) ? Math.max(0, outputTokens) : 0;
  if (outTok <= 0) return null;
  const readSeconds = outTok / FAST_HUMAN_READER_TPS;
  if (walltimeSeconds <= readSeconds) {
    const ratio = readSeconds / walltimeSeconds;
    if (ratio <= 1.15) return 'About what a fast reader needs to read this answer';
    return `A fast reader needs ${fmtDuration(readSeconds)} to read an answer this long — you get it ≈${ratio.toFixed(1)}× sooner`;
  }
  const ratio = walltimeSeconds / readSeconds;
  if (ratio <= 1.15) return 'About what a fast reader needs to read this answer';
  return `Reading this answer takes a fast reader ≈${ratio.toFixed(1)}× less time (${fmtDuration(readSeconds)})`;
}
