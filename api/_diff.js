// Pure run-diff math, shared by the /api/diff endpoint and its tests.
// Takes two slim run objects (shape produced by ./_localmaxxing.js `slim`)
// and returns per-metric deltas, ratios and a plain-language summary.

// Reference workload used for derived time metrics (TTFT / TPOT / walltime)
// so runs measured with different prompt/output lengths stay comparable.
export const REF_PROMPT_TOKENS = 2048;
export const REF_OUTPUT_TOKENS = 512;

const round = (x, places = 4) => (Number.isFinite(x) ? Math.round(x * 10 ** places) / 10 ** places : null);

/**
 * Diff a single metric.
 * higherIsBetter=true for throughputs (tok/s), false for times (s).
 * Returns { a, b, delta, deltaPct, ratio, winner } where winner is
 * 'A' | 'B' | 'tie' from A's point of view, or null when incomputable.
 */
export function diffMetric(valueA, valueB, { higherIsBetter = true } = {}) {
  const a = Number(valueA);
  const b = Number(valueB);
  if (!Number.isFinite(a) || !Number.isFinite(b)) {
    return { a: valueA ?? null, b: valueB ?? null, delta: null, deltaPct: null, ratio: null, winner: null };
  }

  const delta = round(b - a);
  const deltaPct = a !== 0 ? round((b - a) / Math.abs(a)) : null;
  const ratio = a > 0 ? round(b / a) : null;

  let winner;
  if (b === a) winner = 'tie';
  else if (higherIsBetter) winner = b > a ? 'B' : 'A';
  else winner = b < a ? 'B' : 'A';

  return { a, b, delta, deltaPct, ratio, winner };
}

/** Derived time metrics for one run at the reference workload. */
export function derivedTimes(run) {
  const prefill = Number(run.prefillTokPerSec);
  const decode = Number(run.decodeTokPerSec);
  const ttftSeconds = prefill > 0 ? REF_PROMPT_TOKENS / prefill : null;
  const tpotSeconds = decode > 0 ? 1 / decode : null;
  const walltimeSeconds = prefill > 0 && decode > 0
    ? REF_PROMPT_TOKENS / prefill + REF_OUTPUT_TOKENS / decode
    : null;
  return {
    ttftSeconds: round(ttftSeconds),
    tpotSeconds: round(tpotSeconds),
    walltimeSeconds: round(walltimeSeconds)
  };
}

// Locale-invariant prose (#652): no thousands grouping inside JSON strings.
function fmt(x, digits = 1) {
  if (!Number.isFinite(x)) return '?';
  const n = Number(x);
  return Number.isInteger(n) ? String(n) : String(Number(n.toFixed(digits)));
}

/**
 * Build the full diff between runA and runB plus a plain-language summary.
 * Never throws for missing fields — metrics that either run lacks come back
 * with winner: null so callers can skip them.
 */
export function computeRunDiff(runA, runB) {
  const timesA = derivedTimes(runA);
  const timesB = derivedTimes(runB);

  const metrics = {
    prefill: diffMetric(runA.prefillTokPerSec, runB.prefillTokPerSec, { higherIsBetter: true }),
    decode: diffMetric(runA.decodeTokPerSec, runB.decodeTokPerSec, { higherIsBetter: true }),
    ttft: diffMetric(timesA.ttftSeconds, timesB.ttftSeconds, { higherIsBetter: false }),
    tpot: diffMetric(timesA.tpotSeconds, timesB.tpotSeconds, { higherIsBetter: false }),
    walltime: diffMetric(timesA.walltimeSeconds, timesB.walltimeSeconds, { higherIsBetter: false })
  };

  // Context flags: same model family / same hardware make the comparison
  // apples-to-apples; differing token counts are absorbed by the reference
  // workload but still worth surfacing.
  const context = {
    sameModelFamily: String(runA.modelFamily) === String(runB.modelFamily),
    sameQuantization: String(runA.quantization) === String(runB.quantization),
    sameHardware: String(runA.hardwareKey) === String(runB.hardwareKey),
    referenceWorkload: `${REF_PROMPT_TOKENS}-token prompt, ${REF_OUTPUT_TOKENS}-token output`
  };

  return { context, metrics, summary: buildSummary(runA, runB, metrics, context) };
}

function buildSummary(runA, runB, metrics, context) {
  const nameOf = r => `${r.hardware || r.hardwareKey || 'run ' + r.runId}`;
  const parts = [];

  const decode = metrics.decode;
  if (decode.ratio !== null && decode.winner !== 'tie') {
    const faster = decode.winner === 'B' ? runB : runA;
    const slower = decode.winner === 'B' ? runA : runB;
    // Express as "X decodes N× faster": always ≥1, from the winner's side.
    const speedup = decode.ratio >= 1 ? decode.ratio : Math.round((1 / decode.ratio) * 100) / 100;
    parts.push(`${nameOf(faster)} decodes ${fmt(speedup)}× faster than ${nameOf(slower)} (${fmt(faster.decodeTokPerSec, 0)} vs ${fmt(slower.decodeTokPerSec, 0)} tok/s)`);
  } else if (decode.ratio !== null) {
    parts.push(`Both runs decode at the same speed (~${fmt(runA.decodeTokPerSec, 0)} tok/s)`);
  }

  const prefill = metrics.prefill;
  if (prefill.ratio !== null && prefill.winner !== 'tie') {
    const speedup = prefill.ratio >= 1 ? prefill.ratio : Math.round((1 / prefill.ratio) * 100) / 100;
    parts.push(`prefills ${fmt(speedup)}× faster`);
  }

  const walltime = metrics.walltime;
  if (walltime.ratio !== null && walltime.winner && walltime.winner !== 'tie') {
    // Same N× convention as decode: always ≥1, from the faster side.
    const speedup = walltime.ratio >= 1 ? walltime.ratio : Math.round((1 / walltime.ratio) * 100) / 100;
    parts.push(`for a ${context.referenceWorkload}, ${walltime.winner === 'B' ? nameOf(runB) : nameOf(runA)} is ${fmt(speedup)}× faster overall`);
  }

  if (!parts.length) return 'Not enough comparable data to summarize this pair of runs.';

  let head = parts.join(', ') + '.';
  if (!context.sameModelFamily) {
    head += ` Note: different model families (${runA.modelFamily || '?'} vs ${runB.modelFamily || '?'}).`;
  }
  if (!context.sameQuantization) {
    head += ` Different quantizations (${runA.quantization || '?'} vs ${runB.quantization || '?'}).`;
  }
  return head;
}
