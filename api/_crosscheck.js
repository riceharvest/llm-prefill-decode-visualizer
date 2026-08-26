// Cross-hardware validation + data-quality confidence for benchmark groups.
//
// Community runs are unvalidated submissions, so every group carries a
// confidence block (run count, IQR spread, outliers, recency, grade) and
// logically related rigs — e.g. a single RTX 3090 vs a '2x rtx 3090' group on
// the same model + quantization — are consistency-checked against each other.

const DAY_MS = 24 * 60 * 60 * 1000;

function median(sorted) {
  const n = sorted.length;
  if (!n) return null;
  const mid = n >> 1;
  return n % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function quartiles(sorted) {
  const n = sorted.length;
  if (!n) return { q1: null, median: null, q3: null };
  const mid = n >> 1;
  const lower = sorted.slice(0, mid);
  const upper = sorted.slice(n % 2 ? mid + 1 : mid);
  return { q1: median(lower), median: median(sorted), q3: median(upper) };
}

function round(x) {
  return x == null || !Number.isFinite(x) ? null : Math.round(x * 10) / 10;
}

/**
 * Data-quality confidence block for one group of runs (issue #32).
 *
 * grade is 'high' for 10+ runs with a tight decode IQR (<=40% of median),
 * 'low' for fewer than 3 runs (a single submission is always 'low'),
 * 'medium' in between.
 */
export function confidence(runs, now = Date.now()) {
  const decodes = runs.map(r => r.decodeTokPerSec).filter(Number.isFinite).sort((a, b) => a - b);
  const { q1, median: med, q3 } = quartiles(decodes);
  const iqr = q1 != null && q3 != null ? q3 - q1 : null;
  const iqrSpreadPct = med > 0 && iqr != null ? round((iqr / med) * 100) : null;

  let outliers = 0;
  if (iqr != null) {
    const lo = q1 - 1.5 * iqr;
    const hi = q3 + 1.5 * iqr;
    outliers = decodes.filter(v => v < lo || v > hi).length;
  }

  const timestamps = runs
    .map(r => (r.createdAt ? Date.parse(r.createdAt) : NaN))
    .filter(Number.isFinite);
  const newestRunAgeDays = timestamps.length
    ? Math.max(0, Math.round((now - Math.max(...timestamps)) / DAY_MS))
    : null;

  const grade = runs.length < 3 ? 'low'
    : runs.length >= 10 && (iqrSpreadPct == null || iqrSpreadPct <= 40) ? 'high'
    : 'medium';

  return {
    runs: runs.length,
    iqrSpreadPct,
    outliers,
    newestRunAgeDays,
    grade
  };
}

/**
 * Consistency checks between logically related rigs inside one aggregate
 * group: runs are bucketed by model family × quantization × GPU card, and
 * each multi-GPU subset (gpuCount > 1) is compared against the single-GPU
 * baseline of the same bucket.
 *
 * The GPU-card axis matters (#992): under coarse groupings (e.g.
 * /api/benchmarks?groupBy=model) a model+quant bucket can span many unrelated
 * cards — iGPUs, laptops, flagship GPUs. Comparing a 2x budget-card rig
 * against a median inflated by a faster card produced false "likely
 * misconfigured run" verdicts on apples-to-oranges baselines. Bucketing by
 * card keeps every single-vs-multi comparison like-for-like; the leading
 * "N x" count prefix is stripped so "2x RTX 3090"-style labels match their
 * single-card rows.
 *
 * Contradictions emitted:
 *  - 'slower_than_single': the multi-GPU rig's total decode is below the
 *    single-card median — adding GPUs made it slower.
 *  - 'poor_scaling': per-GPU decode efficiency dropped below 50% of the
 *    single-card baseline — plausible for CPU-bound setups but suspicious
 *    enough to flag.
 */
// Normalized GPU identity for one run: hardwareKey when present, else the gpu/
// hardware label; lowercased with any leading count prefix ("2x ") removed so
// multi-GPU rows land in the same bucket as single-card rows of the same card.
function gpuKey(r) {
  return String(r.hardwareKey || r.gpu || r.hardware || '')
    .toLowerCase()
    .replace(/^\d+\s*x\s*/, '')
    .trim();
}

export function crossCheck(runs) {
  const buckets = new Map();
  for (const r of runs) {
    const k = `${r.modelFamily}|${String(r.quantization || '').toLowerCase()}|${gpuKey(r)}`;
    if (!buckets.has(k)) buckets.set(k, []);
    buckets.get(k).push(r);
  }

  const contradictions = [];
  let comparisons = 0;

  for (const bucket of buckets.values()) {
    const singles = bucket.filter(r => (r.gpuCount ?? 1) === 1);
    const multis = new Map();
    for (const r of bucket) {
      const n = r.gpuCount ?? 1;
      if (n > 1) {
        if (!multis.has(n)) multis.set(n, []);
        multis.get(n).push(r);
      }
    }
    if (!singles.length || !multis.size) continue;

    const baseDecode = median(singles.map(r => r.decodeTokPerSec).sort((a, b) => a - b));
    const basePrefill = median(singles.map(r => r.prefillTokPerSec).sort((a, b) => a - b));
    if (!(baseDecode > 0)) continue;

    for (const [n, rs] of [...multis].sort((a, b) => a[0] - b[0])) {
      comparisons++;
      const multiDecode = median(rs.map(r => r.decodeTokPerSec).sort((a, b) => a - b));
      const multiPrefill = median(rs.map(r => r.prefillTokPerSec).sort((a, b) => a - b));
      const perGpuScalingPct = round(((multiDecode / n) / baseDecode) * 100);
      const sample = rs[0];
      const rigLabel = `${n}x ${sample.gpu || sample.hardware}`;

      if (multiDecode < baseDecode) {
        contradictions.push({
          kind: 'slower_than_single',
          vs: rigLabel,
          gpuCount: n,
          metric: 'decode',
          singleTokPerSec: round(baseDecode),
          multiTokPerSec: round(multiDecode),
          deltaPct: round(((multiDecode - baseDecode) / baseDecode) * 100),
          perGpuScalingPct,
          note: `${n}-GPU rig reports less total decode than a single card on the same model/quant/card — likely misconfigured run`
        });
      } else if (perGpuScalingPct < 50) {
        contradictions.push({
          kind: 'poor_scaling',
          vs: rigLabel,
          gpuCount: n,
          metric: 'decode',
          singleTokPerSec: round(baseDecode),
          multiTokPerSec: round(multiDecode),
          deltaPct: round(((multiDecode - baseDecode) / baseDecode) * 100),
          perGpuScalingPct,
          note: `per-GPU decode is only ${perGpuScalingPct}% of the single-card baseline — check for CPU/Ring bottlenecks or a bad submission`
        });
      }
      if (basePrefill > 0 && multiPrefill > 0 && multiPrefill < basePrefill) {
        contradictions.push({
          kind: 'slower_than_single',
          vs: rigLabel,
          gpuCount: n,
          metric: 'prefill',
          singleTokPerSec: round(basePrefill),
          multiTokPerSec: round(multiPrefill),
          deltaPct: round(((multiPrefill - basePrefill) / basePrefill) * 100),
          perGpuScalingPct: round(((multiPrefill / n) / basePrefill) * 100),
          note: `${n}-GPU rig reports less total prefill than a single card on the same model/quant/card — likely misconfigured run`
        });
      }
    }
  }

  return {
    relatedRigComparisons: comparisons,
    contradictions
  };
}
