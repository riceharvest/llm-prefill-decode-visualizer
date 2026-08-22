// POST|GET /api/watch/dispatch — deliver unseen matching runs to registered
// webhooks (#109). Designed to be called by a scheduler (Vercel Cron sends
// GET) or manually; RSS subscribers need nothing from this endpoint.
//
// Per watch: find matching runs created after the watch (minus the bounded
// seen-set), POST a watch.new_runs payload signed with the watch's secret in
// X-Watch-Secret, then persist the seen-set. Delivery failures are recorded,
// not thrown — one dead endpoint must not block the others.
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
  markRunsSeen, deliverWebhook, webhookPayload
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
        description: 'Dispatch pass: delivers runs that arrived after each watch was created to its registered webhook. Nothing to do.',
        dispatched: 0, totalNewRuns: 0, results: []
      });
    }

    const allRuns = await getAllRuns(); // cached dataset (10 min TTL)
    const now = Date.now();
    const results = [];
    let totalNew = 0;

    for (const watch of webhookWatches) {
      const fresh = unseenRunsForWatch(allRuns, watch, now);
      if (!fresh.length) {
        results.push({ watchId: watch.watchId, newRuns: 0, delivered: false });
        continue;
      }
      const delivery = await deliverWebhook(watch, fresh);
      // Mark seen even when delivery failed: a persistently broken endpoint
      // must not accumulate an unbounded backlog and hammer itself forever.
      markRunsSeen(watch, fresh, now);
      await updateWatch(watch);
      totalNew += fresh.length;
      results.push({
        watchId: watch.watchId,
        newRuns: fresh.length,
        delivered: delivery.ok,
        ...(delivery.status != null ? { httpStatus: delivery.status } : {}),
        ...(!delivery.ok && delivery.error ? { error: delivery.error } : {})
      });
    }

    return sendJson(res, {
      description: 'Dispatch pass complete. Each result is one webhook watch: newRuns counts unseen matching runs at dispatch time.',
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
