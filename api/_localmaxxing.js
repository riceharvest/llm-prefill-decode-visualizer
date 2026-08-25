// Shared engine for the agent-facing LocalMaxxing API:
// cached full-dataset fetch, model-name normalization, and aggregation.

import { normalizeModelId } from './_normalize.js';
import { engineTags } from './_engine.js';
import { ApiError } from './_errors.js';
import { groupFreshness } from './_freshness.js';
import { contextBandOf, contextBandMix } from './_contextbands.js';

const UPSTREAM = 'https://www.localmaxxing.com/api';
const PAGE = 200;
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

/** Runs further than this many IQRs from their group median are flagged as outliers. */
export const DEFAULT_OUTLIER_IQRS = 2.5;

let cache = { rows: null, fetchedAt: 0, promise: null };
// Full index (comparable + non-comparable runs), populated by the same
// upstream fetch that fills `cache` — used only by the /api/runs dump.
let rawCache = { rows: null, fetchedAt: 0 };

function comparable(r) {
  const ef = r.engineFlags || {};
  return r.batchSize === 1
    && (ef.concurrency == null || ef.concurrency <= 1)
    && (ef.numParallel == null || ef.numParallel <= 1)
    && Number.isFinite(r.tokSPrefill) && r.tokSPrefill > 0
    && Number.isFinite(r.tokSOut) && r.tokSOut > 0;
}

/**
 * Model-name normalization lives in ./_normalize.js (with tests).
 */

/** Fetch all comparable runs, from cache when fresh. */
export async function getAllRuns() {
  return (await getDataset()).rows;
}

/**
 * Fetch the FULL run index — every community-measured run including batched /
 * non-comparable ones — tagged with a `comparable` boolean. Served by the
 * /api/runs machine-readable dump. Non-finite speeds (possible on runs the
 * comparable filter would have dropped) are nulled so the JSON/CSV stays clean.
 * Shares the upstream fetch + cache window with getAllRuns(): no extra load.
 */
export async function getAllRunsRaw() {
  await getDataset(); // ensures the shared upstream fetch has run
  return rawCache.rows ?? [];
}

/**
 * Await an in-flight upstream walk and settle it safely:
 * - on success, clear `cache.promise` so future calls past the TTL can start a
 *   fresh walk (without this the first resolved promise short-circuits every
 *   later call and the 10-minute TTL never fires — issues #1076/#1101);
 * - on failure, allow retry and serve the previous snapshot when we have one.
 * The identity guard stops a late settler from clearing a NEWER walk's slot.
 */
async function settleWalk(promise) {
  try {
    const rows = await promise;
    if (cache.promise === promise) cache.promise = null;
    return { rows, fetchedAt: cache.fetchedAt };
  } catch (err) {
    if (cache.promise === promise) cache.promise = null; // allow retry; serve stale if we have it
    if (cache.rows) return { rows: cache.rows, fetchedAt: cache.fetchedAt };
    throw err;
  }
}

/** Fetch all comparable runs plus the fetch timestamp of the cached set. */
export async function getDataset() {
  if (cache.rows && Date.now() - cache.fetchedAt < CACHE_TTL_MS) {
    return { rows: cache.rows, fetchedAt: cache.fetchedAt };
  }
  if (cache.promise) {
    return settleWalk(cache.promise);
  }

  cache.promise = (async () => {
    const rows = [];
    // Track upstream run ids so an insert between page fetches (which shifts
    // every subsequent offset by one) cannot duplicate a row inside the
    // cached dataset (#1102).
    const seen = new Set();
    for (let offset = 0; offset <= 20000; offset += PAGE) {
      const res = await fetch(`${UPSTREAM}/leaderboard?limit=${PAGE}&offset=${offset}`, {
        headers: { accept: 'application/json' }
      });
      if (!res.ok) throw new ApiError('UPSTREAM_UNAVAILABLE', `localmaxxing.com leaderboard returned HTTP ${res.status}`);
      const data = await res.json();
      const batch = data.rows || [];
      for (const r of batch) {
        if (r && r.id != null) {
          const key = String(r.id);
          if (seen.has(key)) continue;
          seen.add(key);
        }
        rows.push(r);
      }
      if (batch.length < PAGE) break;
    }
    const comparableRows = rows.filter(comparable).map(slim);
    cache.rows = comparableRows;
    cache.fetchedAt = Date.now();
    // Full index for /api/runs: every run, tagged. Same upstream pages —
    // zero additional requests.
    rawCache.rows = rows.map(r => {
      const s = slim(r);
      if (!Number.isFinite(s.prefillTokPerSec)) s.prefillTokPerSec = null;
      if (!Number.isFinite(s.decodeTokPerSec)) s.decodeTokPerSec = null;
      return { ...s, comparable: comparable(r) };
    });
    rawCache.fetchedAt = Date.now();
    return comparableRows;
  })();

  return settleWalk(cache.promise);
}

function slim(r) {
  const h = r.hardware || {};
  return {
    runId: r.id,
    createdAt: r.createdAt || null,
    modelFamily: normalizeModelId(r.model?.hfId),
    modelId: r.model?.hfId,
    modelName: r.model?.displayName,
    paramsB: r.model?.params || null,
    hardwareKey: r.hardwareGroupKey,
    hardware: r.hardwareGroupLabel || r.hardwareGroupKey,
    hwClass: h.hwClass,
    gpu: h.gpuName,
    gpuCount: h.gpuCount || 1,
    vramGb: h.vramGb,
    chip: h.chipVariant || h.chipFamily || h.chipVendor || null,
    unifiedMemoryGb: h.unifiedMemoryGb,
    cpu: h.cpu,
    engine: r.engine?.engineName,
    engineVersion: r.engine?.engineVersion ?? null,
    quantization: r.engine?.quantization,
    prefillTokPerSec: Math.round(r.tokSPrefill),
    decodeTokPerSec: Math.round(r.tokSOut),
    promptTokens: r.promptTokens,
    outputTokens: r.outputTokens,
    // Comparability inputs (#719): lets agents re-derive the wizard's
    // single-stream filter (batchSize===1 && concurrency<=1 && numParallel<=1)
    // from the documented API instead of trusting a bare comparable flag.
    batchSize: Number.isFinite(r.batchSize) ? r.batchSize : null,
    concurrency: r.engineFlags?.concurrency ?? null,
    numParallel: r.engineFlags?.numParallel ?? null,
    contextLength: r.contextLength,
    // Context-length band (issue #39): null when the run reports no usable
    // contextLength — comparisons annotate the mix instead of assuming.
    contextBand: contextBandOf(r.contextLength)?.id ?? null,
    createdAt: r.createdAt || null,
    engineVersion: r.engine?.engineVersion || null,
    source: `https://localmaxxing.com/en/runs/${r.id}`
  };
}

export function invalidateCache() {
  cache = { rows: null, fetchedAt: 0, promise: null };
  rawCache = { rows: null, fetchedAt: 0 };
}

/**
 * Cache-freshness snapshot for /api/health. Cheap: no network calls.
 */
export function getCacheInfo() {
  const now = Date.now();
  return {
    hasData: cache.rows != null,
    fresh: !!(cache.rows && now - cache.fetchedAt < CACHE_TTL_MS),
    fetchedAt: cache.rows ? new Date(cache.fetchedAt).toISOString() : null,
    ageMs: cache.rows ? now - cache.fetchedAt : null,
    rowCount: cache.rows ? cache.rows.length : 0,
    ttlMs: CACHE_TTL_MS,
    upstream: UPSTREAM
  };
}

// ---------- Aggregation ----------

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
  const lower = sorted.slice(0, n % 2 ? mid : mid);
  const upper = sorted.slice(n % 2 ? mid + 1 : mid);
  return { q1: median(lower), median: median(sorted), q3: median(upper) };
}

/** Median + IQR + range over an unsorted array of speeds. */
function statsOf(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const q = quartiles(sorted);
  return {
    median: q.median,
    q1: q.q1,
    q3: q.q3,
    min: sorted[0] ?? null,
    max: sorted[sorted.length - 1] ?? null
  };
}

/**
 * Flag runs whose prefill or decode tok/s sits more than `threshold` IQRs from
 * their group median (a robust z-score: |value − median| / IQR). A run is
 * flagged if either metric trips the fence.
 *
 * The fences are refit iteratively (up to 5 passes): each pass recomputes
 * median/IQR over the runs not yet flagged, so one wildly misconfigured rig
 * cannot inflate its own IQR and slip under the fence. A metric whose IQR is 0
 * (e.g. many identical rounded values) can never flag on that metric, so
 * quantized data doesn't mass-flag. Returns one entry per flagged run,
 * worst deviation first.
 */
export function flagOutliers(group, threshold = DEFAULT_OUTLIER_IQRS) {
  if (!group.length || !(threshold > 0)) return [];

  const flagged = new Map();
  let pool = group;
  for (let pass = 0; pass < 5 && pool.length; pass++) {
    const pStats = statsOf(pool.map(r => r.prefillTokPerSec));
    const dStats = statsOf(pool.map(r => r.decodeTokPerSec));
    const pIqr = pStats.q3 - pStats.q1;
    const dIqr = dStats.q3 - dStats.q1;

    let newFlags = 0;
    for (const r of group) {
      if (flagged.has(r.runId)) continue;
      const pDev = pIqr > 0 ? Math.abs(r.prefillTokPerSec - pStats.median) / pIqr : 0;
      const dDev = dIqr > 0 ? Math.abs(r.decodeTokPerSec - dStats.median) / dIqr : 0;
      const fields = [];
      if (pDev > threshold) fields.push('prefill');
      if (dDev > threshold) fields.push('decode');
      if (!fields.length) continue;
      flagged.set(r.runId, {
        runId: r.runId,
        source: r.source,
        engine: r.engine,
        quantization: r.quantization,
        hardware: r.hardware ?? r.hardwareKey,
        modelFamily: r.modelFamily,
        prefillTokPerSec: r.prefillTokPerSec,
        decodeTokPerSec: r.decodeTokPerSec,
        prefillIqrDeviations: round6(pDev),
        decodeIqrDeviations: round6(dDev),
        maxIqrDeviations: round6(Math.max(pDev, dDev)),
        fields
      });
      newFlags++;
    }
    if (!newFlags) break;
    pool = group.filter(r => !flagged.has(r.runId));
  }
  return [...flagged.values()].sort((a, b) => b.maxIqrDeviations - a.maxIqrDeviations);
}

/**
 * 0–100 confidence for one aggregate group, combining three signals:
 * - sample count: saturates at SAMPLE_SATURATION comparable runs
 * - IQR width: relative IQR of decode speeds (IQR / median); tighter is better
 * - outlier density: share of runs outside the 1.5×IQR fences
 */
const SAMPLE_SATURATION = 10;
const WEIGHTS = { sample: 0.4, spread: 0.4, outliers: 0.2 };

function clamp01(x) {
  return Math.max(0, Math.min(1, x));
}

function round3(x) {
  return Number.isFinite(x) ? Math.round(x * 1000) / 1000 : null;
}

export function confidenceFor(group) {
  const decodes = group.map(r => r.decodeTokPerSec).sort((a, b) => a - b);
  const dq = quartiles(decodes);
  // quartiles() yields null q1/q3 when the group has a single run — guard
  // instead of doing null arithmetic (#864, #852): null - null coerces IQR
  // to 0 (fake "perfectly tight" relativeIqr) and collapses the 1.5×IQR
  // fences to [0, 0], which counted the single run as a 100%-outlier.
  const hasIqr = dq.q1 != null && dq.q3 != null;
  const iqr = hasIqr ? dq.q3 - dq.q1 : null;
  const relIqr = hasIqr && dq.median > 0 ? iqr / dq.median : null;
  const lo = hasIqr ? dq.q1 - 1.5 * iqr : -Infinity;
  const hi = hasIqr ? dq.q3 + 1.5 * iqr : Infinity;
  const outliers = decodes.filter(v => v < lo || v > hi).length;
  const outlierDensity = decodes.length ? outliers / decodes.length : 1;

  const sampleFactor = clamp01(decodes.length / SAMPLE_SATURATION);
  const spreadFactor = clamp01(1 - (relIqr ?? 0));
  const outlierFactor = clamp01(1 - outlierDensity);

  const score = Math.round(
    100 * (WEIGHTS.sample * sampleFactor + WEIGHTS.spread * spreadFactor + WEIGHTS.outliers * outlierFactor)
  );

  return {
    score: Math.max(0, Math.min(100, score)),
    sampleSize: decodes.length,
    relativeIqr: round3(relIqr),
    outlierDensity: round3(outlierDensity)
  };
}

// ---------- Bootstrap confidence intervals ----------
// Percentile bootstrap over the group's runs: resample with replacement,
// take the median of each resample, and read the 2.5/97.5 percentiles off
// the resampled medians. Seeded PRNG keyed on the group so responses are
// deterministic across requests (and cache-friendly).

const BOOTSTRAP_RESAMPLES = 2000;
const BOOTSTRAP_CONFIDENCE = 0.95;

/** Deterministic 32-bit PRNG (mulberry32). */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashSeed(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * Percentile bootstrap CI for the median of a sorted sample.
 * Returns { lo, hi } rounded ints, or null when there are fewer than
 * two runs (a single observation has no meaningful spread).
 */
export function bootstrapMedianCI(sorted, {
  resamples = BOOTSTRAP_RESAMPLES,
  confidence = BOOTSTRAP_CONFIDENCE,
  seed = 1
} = {}) {
  const n = sorted.length;
  if (n < 2) return null;
  const rand = mulberry32(seed);
  const medians = new Array(resamples);
  for (let b = 0; b < resamples; b++) {
    const sample = new Array(n);
    for (let i = 0; i < n; i++) sample[i] = sorted[(rand() * n) | 0];
    sample.sort((a, b) => a - b);
    medians[b] = median(sample);
  }
  medians.sort((a, b) => a - b);
  const alpha = (1 - confidence) / 2;
  const loIdx = Math.floor(alpha * resamples);
  const hiIdx = Math.min(resamples - 1, Math.ceil((1 - alpha) * resamples) - 1);
  return { lo: Math.round(medians[loIdx]), hi: Math.round(medians[hiIdx]) };
}

/** 'median [lo–hi]' rendering of a stat block that carries ci95. */
function ciLabel(stats) {
  if (!stats.ci95) return `${stats.median}`;
  return `${stats.median} [${stats.ci95.lo}–${stats.ci95.hi}]`;
}

/**
 * Group runs by an arbitrary key function and aggregate speeds with
 * outlier-resistant stats (median + IQR), a 0-100 confidence score
 * (sample size, IQR width, outlier density), a provenance-reviewed outlier
 * report (runs further than `outlierIqrs` IQRs from the group median are listed
 * in `outliers`; pass `includeOutliers: false` to compute the stats without
 * them — this stops one misconfigured rig from dragging a group median while
 * the raw data stays queryable via the `outliers` array) and a 95% percentile
 * bootstrap confidence interval on each median (ci95 + 'median [lo–hi]' label).
 */
export function aggregate(runs, keyFn, { outlierIqrs = DEFAULT_OUTLIER_IQRS, includeOutliers = true } = {}) {
  const groups = new Map();
  for (const run of runs) {
    const k = keyFn(run);
    if (!k) continue;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(run);
  }

  const out = [];
  for (const [key, group] of groups) {
    const outliers = flagOutliers(group, outlierIqrs);
    const outlierIds = new Set(outliers.map(o => o.runId));
    const statsRuns = includeOutliers ? group : group.filter(r => !outlierIds.has(r.runId));

    // Deterministic bootstrap CIs over the group's runs (#43).
    const prefills = group.map(r => r.prefillTokPerSec).sort((a, b) => a - b);
    const decodes = group.map(r => r.decodeTokPerSec).sort((a, b) => a - b);
    const seed = hashSeed(String(key));
    const pCI = bootstrapMedianCI(prefills, { seed });
    const dCI = bootstrapMedianCI(decodes, { seed });
    out.push({
      key,
      runs: group.length,
      runsInStats: statsRuns.length,
      outliersExcludedFromStats: includeOutliers ? 0 : outlierIds.size,
      models: [...new Set(group.map(r => r.modelFamily))],
      outlierIqrs,
      includeOutliers,
      prefill: { ...statsOf(statsRuns.map(r => r.prefillTokPerSec)), ci95: pCI, label: null },
      decode: { ...statsOf(statsRuns.map(r => r.decodeTokPerSec)), ci95: dCI, label: null },
      engines: engineTags(group),
      mixedEngines: engineTags(group).length > 1,
      // Context-band mix (issue #39): groups that blend context bands are
      // annotated so cross-band comparisons aren't read as apples-to-apples.
      contextBands: contextBandMix(group),
      mixedContextBands: contextBandMix(group).mixed,
      confidence: confidenceFor(group),
      freshness: groupFreshness(group),
      // Equal-decode runs tie-break by runId so the cited example stays
      // stable when upstream row order churns (#812).
      bestRun: group.reduce((best, r) => {
        if (r.decodeTokPerSec > best.decodeTokPerSec) return r;
        if (r.decodeTokPerSec === best.decodeTokPerSec && String(r.runId ?? '') < String(best.runId ?? '')) return r;
        return best;
      }, group[0]),
      outliers
    });
    // labels reference the stat blocks above
    out[out.length - 1].prefill.label = ciLabel(out[out.length - 1].prefill);
    out[out.length - 1].decode.label = ciLabel(out[out.length - 1].decode);
  }
  // Deterministic group order (#812 #813): equal medians previously resolved
  // by upstream insertion order, so identical queries could replay groups in
  // a different order. Group keys are unique content and total-order ties.
  return out.sort((a, b) => b.decode.median - a.decode.median || String(a.key).localeCompare(String(b.key)));
}

function round6(x) {
  return Number.isFinite(x) ? Math.round(x * 1e6) / 1e6 : null;
}
