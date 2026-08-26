// GET /api/health — liveness + readiness + upstream data freshness for the
// status page. Cheap by design: reports cache state only, never blocks on
// upstream fetches.
//
// Contract (#649/#654/#657):
//   ok        — liveness only (the handler itself is up). Unchanged, always
//               true unless this handler throws; existing gates keep working.
//   readiness — "ready" | "degraded" | "starting", derived from
//               upstreamFreshness.status (fresh → ready, stale → degraded,
//               empty → starting).
//   degraded  — boolean twin of readiness !== 'ready'.
//   warming   — true while the dataset has never loaded on this instance
//               (first data call will block on a full upstream crawl).
//   components— per-subsystem view: upstreamCache, watchStore, submitQueue,
//               so watch/submission outages are visible without blind probes.
import { getCacheInfo } from '../_localmaxxing.js';
import { sendJson } from '../_schema.js';
import { probeWatchStore } from '../_watch.js';
import { probeSubmitQueue } from '../_submit.js';

export const config = { runtime: 'nodejs' };

/**
 * Map an upstreamFreshness.status to explicit readiness semantics (#649).
 * Pure so tests can pin the mapping without touching module state.
 */
export function deriveReadiness(upstreamStatus) {
  if (upstreamStatus === 'fresh') return { readiness: 'ready', degraded: false };
  if (upstreamStatus === 'stale') return { readiness: 'degraded', degraded: true };
  // 'empty' (or anything unexpected): no usable data yet on this instance.
  return { readiness: 'starting', degraded: true };
}

function json(res, body, status = 200) {
  // Preserve the historical no-store policy (sendJson only sets Cache-Control
  // when asked to, and an already-set header wins).
  res.setHeader('Cache-Control', 'no-store');
  return sendJson(res, body, { status });
}

export default async function handler(req, res) {
  try {
    const c = getCacheInfo();
    const ageSeconds = c.ageMs == null ? null : Math.round(c.ageMs / 1000);
    const upstreamFreshness = {
      // fresh: within TTL · stale: older than TTL but serving · empty: no data yet
      status: c.hasData ? (c.fresh ? 'fresh' : 'stale') : 'empty',
      fetchedAt: c.fetchedAt,
      ageSeconds,
      ttlSeconds: Math.round(c.ttlMs / 1000),
      rowCount: c.rowCount,
      crawlComplete: c.crawlComplete,
      upstreamRows: c.upstreamRows,
      source: c.upstream
    };
    const { readiness, degraded } = deriveReadiness(upstreamFreshness.status);
    let watchStore;
    let submitQueue;
    try {
      [watchStore, submitQueue] = await Promise.all([probeWatchStore(), probeSubmitQueue()]);
    } catch (err) {
      // Probes must never take health down with them.
      watchStore = { ok: false, error: String((err && err.message) || err) };
      submitQueue = { ok: false, error: String((err && err.message) || err) };
    }
    return json(res, {
      ok: true,
      service: 'llm-prefill-decode-visualizer',
      time: new Date().toISOString(),
      upstreamFreshness,
      cacheAge: ageSeconds,
      // Readiness semantics (#649/#654): ok stays liveness-only; agents that
      // want the quickstart's "readiness probe" should gate on these instead.
      readiness,
      degraded,
      warming: upstreamFreshness.status === 'empty',
      components: {
        upstreamCache: { ok: upstreamFreshness.status !== 'empty', status: upstreamFreshness.status },
        watchStore: watchStore.ok ? { ok: true } : { ok: false, error: watchStore.error },
        submitQueue: submitQueue.ok ? { ok: true } : { ok: false, error: submitQueue.error }
      }
    });
  } catch (err) {
    return json(res, {
      ok: false,
      service: 'llm-prefill-decode-visualizer',
      time: new Date().toISOString(),
      error: String((err && err.message) || err)
    }, 500);
  }
}
