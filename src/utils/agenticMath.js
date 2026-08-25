export function calculateAgenticTimeline({
  numTurns,
  basePromptTokens,
  toolOutputTokensPerTurn,
  decodeTokensPerTurn,
  prefillSpeed,
  decodeSpeed,
  enablePrefixCaching
}) {
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
    const turnWalltime = prefillTime + decodeTime;
    cumulativeWalltime += turnWalltime;

    turns.push({
      turn,
      totalPromptTokens,
      newTokensPrefilled,
      decodeTokens: decodeTokensPerTurn,
      prefillTime,
      decodeTime,
      turnWalltime,
      cumulativeWalltime,
      isCached: enablePrefixCaching && turn > 1
    });

    cumulativePromptTokens += decodeTokensPerTurn + toolOutputTokensPerTurn;
  }

  return turns;
}

// Issue #495: the waterfall suppresses a segment's inline numeric label when
// that segment is narrower than this percentage of the bar (too little room
// to draw the text). Suppressed values must still appear as visible text in
// the row (see MultiGpuPlanner-style fallback), never tooltip-only.
export const WATERFALL_LABEL_MIN_PERCENT = 15;

/**
 * Decide which waterfall segment labels fit inline and which need a text
 * fallback. Returns { prefillInline, decodeInline, hiddenSegments,
 * needsTextFallback } so the renderer can move suppressed values into the
 * row's text column instead of dropping them (#495).
 */
export function waterfallSegmentLabels(prefillPercent, minPercent = WATERFALL_LABEL_MIN_PERCENT) {
  const p = Number(prefillPercent);
  const ratio = Number.isFinite(p) ? Math.min(100, Math.max(0, p)) : 0;
  const prefillInline = ratio > minPercent;
  const decodeInline = (100 - ratio) > minPercent;
  const hiddenSegments = [
    ...(prefillInline ? [] : ['prefill']),
    ...(decodeInline ? [] : ['decode'])
  ];
  return {
    prefillInline,
    decodeInline,
    hiddenSegments,
    needsTextFallback: hiddenSegments.length > 0
  };
}

export function waterfallGeometry(turns) {
  const totalWalltime = turns.reduce((total, turn) => total + turn.turnWalltime, 0);

  return turns.map((turn) => {
    const turnStart = turn.cumulativeWalltime - turn.turnWalltime;
    const hasTotal = Number.isFinite(totalWalltime) && totalWalltime > 0;
    const hasTurn = Number.isFinite(turn.turnWalltime) && turn.turnWalltime > 0;

    return {
      leftPercent: hasTotal ? (turnStart / totalWalltime) * 100 : 0,
      widthPercent: hasTotal ? (turn.turnWalltime / totalWalltime) * 100 : 0,
      prefillPercent: hasTurn ? (turn.prefillTime / turn.turnWalltime) * 100 : 0,
      // Issue #591: absolute time values so the chart is self-describing —
      // the rendered bars are percent-of-loop only and the total scale used
      // to live in an unrelated DOM node outside the chart container.
      startSeconds: Number.isFinite(turnStart) ? turnStart : 0,
      durationSeconds: hasTurn ? turn.turnWalltime : 0,
      prefillSeconds: Number.isFinite(turn.prefillTime) ? turn.prefillTime : 0,
      decodeSeconds: Number.isFinite(turn.decodeTime) ? turn.decodeTime : 0
    };
  });
}
