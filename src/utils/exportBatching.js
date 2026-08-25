// Export the Batching simulation as deterministic markdown/JSON (#398).
//
// Like exportMarkdown.js / exportJson.js, the builders are pure functions
// (no DOM access) so the same inputs always produce byte-identical output —
// an agent can capture and cite the artifact of a batch run instead of
// polling transient animation DOM text.

const round = (v, d = 1) => Number(v.toFixed(d));

function configBlock({ numRequests, meanPromptTokens, meanOutputTokens, maxBatchSize, chunkSize, arrivalIntervalMs, prefillSpeed, decodeSpeed }) {
  return [
    '```',
    `requests          = ${numRequests}`,
    `mean prompt tokens = ${meanPromptTokens}`,
    `mean output tokens = ${meanOutputTokens}`,
    `max batch size     = ${maxBatchSize}`,
    `chunk size         = ${chunkSize === 0 ? 'off' : `${chunkSize} tok`}`,
    `arrival interval   = ${arrivalIntervalMs} ms`,
    `prefill speed      = ${Math.round(prefillSpeed)} tok/s`,
    `decode speed       = ${Math.round(decodeSpeed)} tok/s`,
    '```'
  ].join('\n');
}

function metricsTable(summary) {
  return [
    '| Metric | Value |',
    '| --- | --- |',
    `| Makespan | ${round(summary.makespan)}s |`,
    `| Total output tokens | ${summary.totalOutputTokens} |`,
    `| Output throughput | ${round(summary.throughput)} tok/s |`,
    `| Avg TTFT | ${round(summary.avgTTFT * 1000)} ms |`,
    `| Max TTFT | ${round(summary.maxTTFT * 1000)} ms |`,
    `| Avg ITL | ${round(summary.avgITL * 1000)} ms |`,
    `| Max ITL | ${round(summary.maxITL * 1000)} ms |`,
    `| Batch occupancy | ${round(summary.occupancyPct)}% |`,
    `| Stalled steps (prefill interleaved) | ${round(summary.stalledStepPct)}% |`
  ].join('\n');
}

export function buildBatchingMarkdown({
  numRequests,
  meanPromptTokens,
  meanOutputTokens,
  maxBatchSize,
  chunkSize,
  arrivalIntervalMs,
  prefillSpeed,
  decodeSpeed,
  summary,
  staticSummary,
  requests = [],
  deepLink
}) {
  const saving = staticSummary.makespan - summary.makespan;
  const savingPct = staticSummary.makespan > 0 ? (saving / staticSummary.makespan) * 100 : 0;
  const lines = [
    '# Continuous batching simulation',
    '',
    '## Configuration',
    '',
    configBlock({ numRequests, meanPromptTokens, meanOutputTokens, maxBatchSize, chunkSize, arrivalIntervalMs, prefillSpeed, decodeSpeed }),
    '',
    '## Continuous batching results',
    '',
    metricsTable(summary),
    '',
    '## Static batching comparison',
    '',
    `- Static makespan: ${round(staticSummary.makespan)}s`,
    `- Continuous saving: ${round(saving)}s (${round(savingPct)}%)`,
    '',
    '## Per-request timeline',
    '',
    '| # | Prompt tok | Output tok | TTFT (ms) | Finish (s) |',
    '| --- | --- | --- | --- | --- |'
  ];
  for (const r of requests) {
    lines.push(`| ${r.id} | ${r.promptTokens} | ${r.outputTokens} | ${Number.isFinite(r.ttft) ? round(r.ttft * 1000) : '—'} | ${Number.isFinite(r.finishTime) ? round(r.finishTime) : '—'} |`);
  }
  if (deepLink) {
    lines.push('', `Reproduce: ${deepLink}`);
  }
  return lines.join('\n');
}

export function buildBatchingJson({
  numRequests,
  meanPromptTokens,
  meanOutputTokens,
  maxBatchSize,
  chunkSize,
  arrivalIntervalMs,
  prefillSpeed,
  decodeSpeed,
  summary,
  staticSummary,
  requests = [],
  deepLink
}) {
  return {
    view: 'batching',
    schemaVersion: 1,
    workload: {
      requests: numRequests,
      meanPromptTokens,
      meanOutputTokens,
      maxBatchSize,
      chunkSize,
      chunkingEnabled: chunkSize > 0,
      arrivalIntervalMs
    },
    speeds: {
      prefillTokPerSec: Math.round(prefillSpeed),
      decodeTokPerSec: Math.round(decodeSpeed)
    },
    continuous: { ...summary },
    staticBatching: {
      makespan: staticSummary.makespan,
      totalOutputTokens: staticSummary.totalOutputTokens,
      throughput: staticSummary.throughput
    },
    comparison: {
      savingSeconds: staticSummary.makespan - summary.makespan,
      savingPct: staticSummary.makespan > 0
        ? ((staticSummary.makespan - summary.makespan) / staticSummary.makespan) * 100
        : 0
    },
    requests: requests.map(r => ({
      id: r.id,
      promptTokens: r.promptTokens,
      outputTokens: r.outputTokens,
      arrivalTime: r.arrivalTime,
      ttft: r.ttft ?? null,
      finishTime: r.finishTime ?? null
    })),
    deepLink: deepLink || null
  };
}
