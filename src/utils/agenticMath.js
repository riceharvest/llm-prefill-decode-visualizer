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

export function waterfallGeometry(turns) {
  const totalWalltime = turns.reduce((total, turn) => total + turn.turnWalltime, 0);

  return turns.map((turn) => {
    const turnStart = turn.cumulativeWalltime - turn.turnWalltime;
    const hasTotal = Number.isFinite(totalWalltime) && totalWalltime > 0;
    const hasTurn = Number.isFinite(turn.turnWalltime) && turn.turnWalltime > 0;

    return {
      leftPercent: hasTotal ? (turnStart / totalWalltime) * 100 : 0,
      widthPercent: hasTotal ? (turn.turnWalltime / totalWalltime) * 100 : 0,
      prefillPercent: hasTurn ? (turn.prefillTime / turn.turnWalltime) * 100 : 0
    };
  });
}
