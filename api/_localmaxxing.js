// Shared engine for the agent-facing LocalMaxxing API:
// cached full-dataset fetch, model-name normalization, and aggregation.

import { normalizeModelId } from './_normalize.js';

const UPSTREAM = 'https://www.localmaxxing.com/api';
const PAGE = 200;
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

/** Runs further than this many IQRs from their group median are flagged as outliers. */
export const DEFAULT_OUTLIER_IQRS = 2.5;

let cache = { rows: null, fetchedAt: 0, promise: null };

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

/** Fetch all comparable runs plus the fetch timestamp of the cached set. */
export async function getDataset() {
  if (cache.rows && Date.now() - cache.fetchedAt < CACHE_TTL_MS) {
    return { rows: cache.rows, fetchedAt: cache.fetchedAt };
  }
  if (cache.promise) {
    return cache.promise.then(rows => ({ rows, fetchedAt: cache.fetchedAt }));
  }

  cache.promise = (async () => {
    const rows = [];
    for (let offset = 0; offset <= 20000; offset += PAGE) {
      const res = await fetch(`${UPSTREAM}/leaderboard?limit=${PAGE}&offset=${offset}`, {
        headers: { accept: 'application/json' }
      });
      if (!res.ok) throw new Error(`upstream ${res.status}`);
      const data = await res.json();
      const batch = data.rows || [];
      rows.push(...batch);
      if (batch.length < PAGE) break;
    }
    const comparableRows = rows.filter(comparable).map(slim);
    cache.rows = comparableRows;
    cache.fetchedAt = Date.now();
    return comparableRows;
  })();

  try {
    return { rows: await cache.promise, fetchedAt: cache.fetchedAt };
  } catch (err) {
    cache.promise = null; // allow retry; serve stale if we have it
    if (cache.rows) return { rows: cache.rows, fetchedAt: cache.fetchedAt };
    throw err;
  }
}

function slim(r) {
  const h = r.hardware || {};
  return {
    runId: r.id,
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
    quantization: r.engine?.quantization,
    prefillTokPerSec: Math.round(r.tokSPrefill),
    decodeTokPerSec: Math.round(r.tokSOut),
    promptTokens: r.promptTokens,
    outputTokens: r.outputTokens,
    contextLength: r.contextLength,
    source: `https://localmaxxing.com/en/runs/${r.id}`
  };
}

export function invalidateCache() {
  cache = { rows: null, fetchedAt: 0, promise: null };
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
 * Group runs by an arbitrary key function and aggregate speeds with
 * outlier-resistant stats (median + IQR).
 *
 * Every group also carries a provenance-reviewed outlier report: runs further
 * than `outlierIqrs` IQRs from the group median are listed in `outliers`.
 * Pass `includeOutliers: false` to compute the stats without them — this stops
 * one misconfigured rig from dragging a group median while the raw data stays
 * queryable via the `outliers` array.
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
    out.push({
      key,
      runs: group.length,
      runsInStats: statsRuns.length,
      outliersExcludedFromStats: includeOutliers ? 0 : outlierIds.size,
      models: [...new Set(group.map(r => r.modelFamily))],
      outlierIqrs,
      includeOutliers,
      prefill: statsOf(statsRuns.map(r => r.prefillTokPerSec)),
      decode: statsOf(statsRuns.map(r => r.decodeTokPerSec)),
      engines: [...new Set(group.map(r => r.engine).filter(Boolean))],
      bestRun: group.reduce((best, r) => (r.decodeTokPerSec > best.decodeTokPerSec ? r : best), group[0]),
      outliers
    });
  }
  return out.sort((a, b) => b.decode.median - a.decode.median);
}

function round6(x) {
  return Number.isFinite(x) ? Math.round(x * 1e6) / 1e6 : null;
}
