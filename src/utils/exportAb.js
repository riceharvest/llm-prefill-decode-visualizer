// Export the A/B replay comparison as deterministic markdown/JSON (#403).
//
// Pure functions, no DOM access — the same inputs always produce
// byte-identical output so an agent can cite the artifact of a run.

const round = (v, d = 2) => Number(v.toFixed(d));

export function buildAbMarkdown({
  presetA,
  presetB,
  promptTokens,
  outputTokens,
  ttftA,
  ttftB,
  decodeTimeA,
  decodeTimeB,
  totalA,
  totalB,
  deepLink
}) {
  const speedupTotal = totalA > 0 && Number.isFinite(totalA) ? totalB / totalA : 0;
  const winnerLabel = speedupTotal > 1
    ? `${presetA.name} finishes first`
    : speedupTotal < 1 && speedupTotal > 0
      ? `${presetB.name} finishes first`
      : 'Dead heat';
  const lines = [
    '# A/B replay comparison',
    '',
    `Shared workload: ${promptTokens} prompt tokens → ${outputTokens} output tokens.`,
    '',
    '| Metric | System A | System B |',
    '| --- | --- | --- |',
    `| Hardware | ${presetA.name} | ${presetB.name} |`,
    `| Prefill (tok/s) | ${Math.round(presetA.prefillSpeed)} | ${Math.round(presetB.prefillSpeed)} |`,
    `| Decode (tok/s) | ${Math.round(presetA.decodeSpeed)} | ${Math.round(presetB.decodeSpeed)} |`,
    `| TTFT | ${round(ttftA)}s | ${round(ttftB)}s |`,
    `| Decode walltime | ${round(decodeTimeA)}s | ${round(decodeTimeB)}s |`,
    `| Total walltime | ${round(totalA)}s | ${round(totalB)}s |`,
    '',
    `- Overall: ${speedupTotal >= 1 ? `${round(speedupTotal)}x faster` : speedupTotal > 0 ? `${round(1 / speedupTotal)}x slower` : '—'} (A vs B)`,
    `- TTFT advantage: ${ttftA > 0 && Number.isFinite(ttftA) ? `${round(ttftB / ttftA)}x` : '—'}`,
    `- First to finish: ${winnerLabel}`
  ];
  if (deepLink) {
    lines.push('', `Reproduce: ${deepLink}`);
  }
  return lines.join('\n');
}

export function buildAbJson({
  presetA,
  presetB,
  promptTokens,
  outputTokens,
  ttftA,
  ttftB,
  decodeTimeA,
  decodeTimeB,
  totalA,
  totalB,
  deepLink
}) {
  const speedupTotal = totalA > 0 && Number.isFinite(totalA) ? totalB / totalA : 0;
  return {
    view: 'ab-replay',
    schemaVersion: 1,
    workload: { promptTokens, outputTokens },
    laneA: {
      id: presetA.id,
      name: presetA.name,
      prefillTokPerSec: Math.round(presetA.prefillSpeed),
      decodeTokPerSec: Math.round(presetA.decodeSpeed),
      ttftSeconds: Number.isFinite(ttftA) ? round(ttftA) : null,
      decodeSeconds: Number.isFinite(decodeTimeA) ? round(decodeTimeA) : null,
      totalWalltimeSeconds: Number.isFinite(totalA) ? round(totalA) : null
    },
    laneB: {
      id: presetB.id,
      name: presetB.name,
      prefillTokPerSec: Math.round(presetB.prefillSpeed),
      decodeTokPerSec: Math.round(presetB.decodeSpeed),
      ttftSeconds: Number.isFinite(ttftB) ? round(ttftB) : null,
      decodeSeconds: Number.isFinite(decodeTimeB) ? round(decodeTimeB) : null,
      totalWalltimeSeconds: Number.isFinite(totalB) ? round(totalB) : null
    },
    comparison: {
      overallSpeedup: speedupTotal > 0 ? round(speedupTotal) : null,
      overallVerdict: speedupTotal >= 1 ? 'A-faster' : speedupTotal > 0 ? 'B-faster' : 'dead-heat',
      ttftRatioBOverA: ttftA > 0 && Number.isFinite(ttftA) ? round(ttftB / ttftA) : null
    },
    deepLink: deepLink || null
  };
}
