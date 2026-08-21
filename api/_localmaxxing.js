// Shared engine for the agent-facing LocalMaxxing API:
// cached full-dataset fetch, model-name normalization, and aggregation.

import { normalizeModelId } from './_normalize.js';

const UPSTREAM = 'https://www.localmaxxing.com/api';
const PAGE = 200;
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

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
  if (cache.rows && Date.now() - cache.fetchedAt < CACHE_TTL_MS) {
    return cache.rows;
  }
  if (cache.promise) return cache.promise;

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
    return await cache.promise;
  } catch (err) {
    cache.promise = null; // allow retry; serve stale if we have it
    if (cache.rows) return cache.rows;
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

// Robust outlier rejection: a run is an outlier when its value sits more
// than K × MAD away from the group's median (MAD = median absolute
// deviation). Unlike IQR/z-score fences this needs no distributional
// assumptions and is itself immune to the outliers it flags.
const OUTLIER_K = 3;
const MIN_GROUP_FOR_TRIM = 4; // never trim groups smaller than this

function mad(sortedValues, med) {
  return median(sortedValues.map(v => Math.abs(v - med)).sort((a, b) => a - b));
}

/**
 * Split a group into inliers and outliers for one metric.
 * Returns { inliers, outliers }; no trimming happens when the MAD is 0
 * (degenerate spread) or the group is too small to trust the estimate.
 */
function splitOutliers(group, valueOf) {
  if (group.length < MIN_GROUP_FOR_TRIM) return { inliers: group, outliers: [] };
  const sorted = group.map(valueOf).sort((a, b) => a - b);
  const med = median(sorted);
  const m = mad(sorted, med);
  if (!m) return { inliers: group, outliers: [] };
  const cutoff = OUTLIER_K * m;
  const inliers = [];
  const outliers = [];
  for (const run of group) {
    (Math.abs(valueOf(run) - med) <= cutoff ? inliers : outliers).push(run);
  }
  return { inliers, outliers };
}

/**
 * Group runs by an arbitrary key function and aggregate speeds with
 * outlier-resistant stats (median + IQR).
 *
 * By default runs whose decode OR prefill speed deviates more than
 * 3×MAD from their cohort's median are excluded before aggregating
 * (they still count toward `runs`, and `excludedRuns` reports how many
 * were trimmed). Pass `{ includeOutliers: true }` to keep every run.
 */
export function aggregate(runs, keyFn, { includeOutliers = false } = {}) {
  const groups = new Map();
  for (const run of runs) {
    const k = keyFn(run);
    if (!k) continue;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(run);
  }

  const out = [];
  for (const [key, group] of groups) {
    let excludedRuns = [];
    let statGroup = group;
    if (!includeOutliers) {
      const dec = splitOutliers(group, r => r.decodeTokPerSec);
      const pre = splitOutliers(group, r => r.prefillTokPerSec);
      const flagged = new Set([...dec.outliers, ...pre.outliers]);
      // Only trim when enough runs survive to keep the aggregate meaningful.
      if (flagged.size && group.length - flagged.size >= MIN_GROUP_FOR_TRIM) {
        excludedRuns = [...flagged];
        statGroup = group.filter(r => !flagged.has(r));
      }
    }

    const prefills = statGroup.map(r => r.prefillTokPerSec).sort((a, b) => a - b);
    const decodes = statGroup.map(r => r.decodeTokPerSec).sort((a, b) => a - b);
    const pq = quartiles(prefills);
    const dq = quartiles(decodes);
    out.push({
      key,
      runs: group.length,
      excludedRuns: excludedRuns.length,
      sampleLabel: `n=${group.length}${excludedRuns.length ? `, ${excludedRuns.length} excluded` : ''}`,
      models: [...new Set(group.map(r => r.modelFamily))],
      prefill: { median: pq.median, q1: pq.q1, q3: pq.q3, min: prefills[0], max: prefills[prefills.length - 1] },
      decode: { median: dq.median, q1: dq.q1, q3: dq.q3, min: decodes[0], max: decodes[decodes.length - 1] },
      bestRun: statGroup.reduce((best, r) => (r.decodeTokPerSec > best.decodeTokPerSec ? r : best), statGroup[0])
    });
  }
  return out.sort((a, b) => b.decode.median - a.decode.median);
}
