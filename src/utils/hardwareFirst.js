// Hardware-first index for LocalMaxxing runs.
//
// The LocalMaxxing leaderboard API only filters server-side by model (hfId),
// not by hardware, and it paginates with limit+offset. This module lazily
// fetches ALL comparable single-stream runs once (~3.6k rows, ~150 KB gzipped
// over the wire) and indexes them hardware → model → quant so the picker can
// run in either direction:
//   - model-first (existing flow): fetchComparableRuns(hfId)
//   - hardware-first (this module): allRuns() → group client-side

let allRunsPromise = null;

function comparable(r) {
  const ef = r.engineFlags || {};
  return r.batchSize === 1
    && (ef.concurrency == null || ef.concurrency <= 1)
    && (ef.numParallel == null || ef.numParallel <= 1)
    && Number.isFinite(r.tokSPrefill) && r.tokSPrefill > 0
    && Number.isFinite(r.tokSOut) && r.tokSOut > 0;
}

async function fetchJson(path, signal) {
  const response = await fetch(path, { signal });
  if (!response.ok) throw new Error(`LocalMaxxing returned ${response.status}`);
  return response.json();
}

/**
 * Fetch every comparable single-stream run from the leaderboard, following
 * offset pagination until exhausted. Resolves once per page load; concurrent
 * callers share the same in-flight promise.
 *
 * Failure semantics: a failed or aborted fetch clears the cached promise so
 * the next call retries from scratch — a transient network error must never
 * poison the cache and leave the picker stuck on "Loading…" forever.
 */
export function fetchAllComparableRuns(signal) {
  if (!allRunsPromise) {
    allRunsPromise = paginate(signal).catch(err => {
      allRunsPromise = null; // allow retry on next call
      throw err;
    });
  }
  return allRunsPromise;
}

/** Progress callback for UI (pages done, rows so far). Optional. */
export function setFetchProgressListener(fn) {
  progressListener = typeof fn === 'function' ? fn : null;
}

let progressListener = null;

function reportProgress(pagesDone, rows) {
  if (progressListener) progressListener({ pages: pagesDone, rows });
}

async function paginate(signal) {
  const PAGE = 200;
  let offset = 0;
  let pages = 0;
  const rows = [];
  for (;;) {
    const data = await fetchJson(`/localmaxxing-api/leaderboard?limit=${PAGE}&offset=${offset}`, signal);
    const batch = data.rows || [];
    rows.push(...batch);
    pages += 1;
    reportProgress(pages, rows.length);
    if (batch.length < PAGE) break;
    offset += PAGE;
    if (offset > 20000) break; // safety valve against runaway loops
  }
  return rows.filter(comparable);
}

/** Distinct hardware groups sorted by measured-run count, descending. */
export function getHardwareGroups(runs) {
  const counts = new Map();
  for (const run of runs) {
    counts.set(run.hardwareGroupKey, (counts.get(run.hardwareGroupKey) || 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])))
    .map(([key]) => key);
}

/** Distinct models available for a hardware group, most runs first. */
export function getModelsForHardware(runs, hardwareGroupKey) {
  const counts = new Map();
  for (const run of runs) {
    if (run.hardwareGroupKey !== hardwareGroupKey) continue;
    const hfId = run.model?.hfId;
    if (hfId) counts.set(hfId, (counts.get(hfId) || 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([hfId]) => hfId);
}

/** Runs for one hardware+model pair, grouped/sorted by quantization popularity. */
export function getQuantsForHardwareModel(runs, hardwareGroupKey, hfId) {
  return runs.filter(run =>
    run.hardwareGroupKey === hardwareGroupKey && run.model?.hfId === hfId
  );
}

export { comparable };
