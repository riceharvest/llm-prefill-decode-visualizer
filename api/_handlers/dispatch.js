// POST|GET /api/watch/dispatch — deliver unseen matching runs to registered
// webhooks (#109). Designed to be called by a scheduler (Vercel Cron sends
// GET) or manually; RSS subscribers need nothing from this endpoint.
//
// Per watch: find matching unseen runs (respecting the #699 includeExisting
// backfill opt-in), POST a watch.new_runs payload signed with the watch's
// secret in X-Watch-Secret, then persist the seen-set. Delivery failures are
// recorded, not thrown — one dead endpoint must not block the others.
//
// Failure handling (#694): failed deliveries no longer mark their runs seen.
// The watch accrues consecutiveFailures and a capped exponential nextRetryAt
// (1min → 24h); after WEBHOOK_MAX_FAILURES consecutive failures it is
// dead-lettered (no further attempts) but stays listed with its failure
// state so the owner can detect the deafness and re-create the watch.
// Successful delivery resets the failure state and marks the runs seen.
//
// Auth: set WATCH_DISPATCH_SECRET to require ?secret= / x-dispatch-secret on
// this endpoint (recommended once webhooks exist); unset = open, like the
// rest of the read API.
import { enforceRateLimit } from '../_ratelimit.js';
import { sendJson } from '../_schema.js';
import { sendProblemFromError } from '../_errors.js';
import { getAllRuns } from '../_localmaxxing.js';
import {
  listWatches, updateWatch, unseenRunsForWatch,
  markRunsSeen, deliverWebhook, webhookPayload,
  recordDeliveryFailure, recordDeliverySuccess, retryDue
} from '../_watch.js';

export const config = { runtime: 'nodejs' };

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    return res.status(204).end();
  }
  if (req.method !== 'GET' && req.method !== 'POST') {
    return sendJson(res, { error: `Method ${req.method} not allowed. Use GET or POST to run a dispatch pass.` }, { status: 405 });
  }
  if (!enforceRateLimit(req, res)) return;

  const expected = process.env.WATCH_DISPATCH_SECRET;
  if (expected) {
    const given = req.query?.secret ?? req.headers['x-dispatch-secret'];
    if (given !== expected) {
      return sendJson(res, { error: 'unauthorized', message: 'dispatch requires WATCH_DISPATCH_SECRET (?secret= or x-dispatch-secret header)' }, { status: 401 });
    }
  }

  try {
    let watches;
    try {
      watches = await listWatches();
    } catch {
      return sendJson(res, { error: 'watch_store_unavailable', message: 'watch store could not be read' }, { status: 503 });
    }
    const webhookWatches = watches.filter(w => w.webhookUrl);
    if (!webhookWatches.length) {
      return sendJson(res, {
        description: 'Dispatch pass: delivers unseen matching runs to each registered webhook. Nothing to do.',
        dispatched: 0, totalNewRuns: 0, results: []
      });
    }

    const allRuns = await getAllRuns(); // cached dataset (10 min TTL)
    const now = Date.now();
    const results = [];
    let totalNew = 0;

    for (const watch of webhookWatches) {
      // Dead-lettered / backing-off watches are skipped this pass so a dead
      // endpoint is neither hammered nor silently re-marked seen (#694).
      if (!retryDue(watch, now)) {
        results.push({
          watchId: watch.watchId,
          newRuns: 0,
          delivered: false,
          ...(watch.deadLettered
            ? { deadLettered: true, error: watch.lastDeliveryError ?? 'dead-lettered after repeated delivery failures' }
            : { retryScheduledAt: watch.nextRetryAt })
        });
        continue;
      }

      const fresh = unseenRunsForWatch(allRuns, watch, now);
      if (!fresh.length) {
        results.push({ watchId: watch.watchId, newRuns: 0, delivered: false });
        continue;
      }

      const delivery = await deliverWebhook(watch, fresh);
      if (delivery.ok) {
        // Success only now: mark seen + clear any failure state (#694).
        markRunsSeen(watch, fresh, now);
        recordDeliverySuccess(watch);
      } else {
        // Failure leaves lastSeenRunIds untouched — the runs stay unseen and
        // are retried with backoff until delivered or dead-lettered (#694).
        recordDeliveryFailure(watch, {
          error: delivery.error ?? null,
          status: delivery.status ?? null,
          now
        });
      }
      await updateWatch(watch);
      if (delivery.ok) totalNew += fresh.length;
      results.push({
        watchId: watch.watchId,
        newRuns: fresh.length,
        delivered: delivery.ok,
        ...(delivery.ok ? {} : {
          willRetry: !watch.deadLettered,
          consecutiveFailures: watch.consecutiveFailures,
          ...(watch.deadLettered ? { deadLettered: true } : { retryScheduledAt: watch.nextRetryAt })
        }),
        ...(delivery.status != null ? { httpStatus: delivery.status } : {}),
        ...(!delivery.ok && delivery.error ? { error: delivery.error } : {})
      });
    }

    return sendJson(res, {
      description: 'Dispatch pass complete. Each result is one webhook watch: newRuns counts unseen matching runs at dispatch time. Failed deliveries are retried with capped exponential backoff and dead-lettered after repeated failures; their runs stay unseen (#694).',
      schemaNote: 'Payload shape per webhook is the watch.new_runs object echoed in previewPayload.',
      dispatched: results.filter(r => r.delivered).length,
      totalNewRuns: totalNew,
      results,
      previewPayload: webhookPayload(webhookWatches[0], [], new Date(now).toISOString())
    });
  } catch (err) {
    return sendProblemFromError(res, req, err);
  }
}
