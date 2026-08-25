import { enforceRateLimit } from './_ratelimit.js';
import { sendJson } from './_schema.js';
import { sendProblemFromError } from './_errors.js';
import { getAllRuns } from './_localmaxxing.js';
import {
  validateWatch, saveWatch, listWatches, removeWatch,
  runsForWatch, watchLabel, rssPathFor, MAX_WATCHES
} from './_watch.js';

export const config = { runtime: 'nodejs' };

// Conservative Retry-After (seconds) advertised on watch_limit_reached 429s —
// the cap frees up as other watches expire/are deleted, so we suggest an hour
// rather than a hard window. Keeps the "every app-emitted 429 carries
// Retry-After" guarantee (see api/_waf.js).
export const WATCH_LIMIT_RETRY_AFTER_SECONDS = 3600;

const DESCRIPTION =
  'Watch feeds (#109): subscribe to a hardware+model combination (e.g. "RTX 4090 + Qwen3 32B") and get notified when new community LocalMaxxing runs land for that pair. ' +
  'POST { model?, hardware?, quant?, webhookUrl?, includeExisting? } to create a watch — at least one of model/hardware is required; webhookUrl (https) adds webhook delivery on top of the RSS feed; includeExisting=true opts into receiving matching runs dated before the watch was created (backfilled/imported data) on the first dispatch (#699). ' +
  'The response carries watchId + secret (save the secret: it is shown once and is required to DELETE) and a ready-made rssUrl. ' +
  'RSS: GET /api/watch/rss.xml?model=&hardware=&quant=&page=&perPage= — poll it like any feed; it supports ETag/If-None-Match (304), Last-Modified, and cursor pagination (#696). ' +
  'Webhooks: POST /api/watch/dispatch (cron-friendly) delivers unseen matching runs to each registered webhook with an X-Watch-Secret header; failed deliveries are retried with capped exponential backoff and dead-lettered after repeated failures instead of losing the runs (#694). ' +
  'DELETE /api/watch?id=&secret= to unsubscribe. Storage is per-instance JSONL (WATCHES_DIR), same durability model as run submissions.';

/**
 * GET  /api/watch — describe the feature + list registered combos (no secrets).
 * POST /api/watch — create a watch (returns watchId + one-time secret).
 * DELETE /api/watch?id=&secret= — remove a watch.
 */
export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(204).end();
  }
  if (!enforceRateLimit(req, res)) return;

  try {
    if (req.method === 'GET') {
      let watches = [];
      try {
        watches = await listWatches();
      } catch { /* store unavailable — describe the feature anyway */ }

      // Never expose secrets or webhook URLs in the public listing.
      // Delivery-health fields (#694) let an agent detect that its
      // subscription went deaf (backoff / dead-letter) instead of guessing.
      return sendJson(res, {
        description: DESCRIPTION,
        maxWatches: MAX_WATCHES,
        totalWatches: watches.length,
        watches: watches.map(w => ({
          watchId: w.watchId,
          label: watchLabel(w),
          model: w.model, hardware: w.hardware, quant: w.quant,
          hasWebhook: !!w.webhookUrl,
          includeExisting: !!w.includeExisting,
          createdAt: w.createdAt,
          ...(w.webhookUrl ? {
            lastDispatchAt: w.lastDispatchAt ?? null,
            consecutiveFailures: w.consecutiveFailures ?? 0,
            deadLettered: !!w.deadLettered,
            ...(w.nextRetryAt ? { nextRetryAt: w.nextRetryAt } : {}),
            ...(w.lastDeliveryError ? { lastDeliveryError: w.lastDeliveryError } : {})
          } : {})
        }))
      }, { cacheTtl: 60 });
    }

    if (req.method === 'POST') {
      const { ok, errors, watch } = validateWatch(req.body);
      if (!ok) {
        return sendJson(res, { error: 'validation_failed', errors }, { status: 400 });
      }

      let record;
      try {
        record = await saveWatch(watch);
      } catch (err) {
        if (String(err.message || '').includes('limit reached')) {
          // App-emitted 429s always carry Retry-After (see api/_waf.js — the
          // edge WAF block is the one layer that cannot). The watch cap frees
          // up when other watches are deleted; advertise a conservative hour.
          res.setHeader('Retry-After', String(WATCH_LIMIT_RETRY_AFTER_SECONDS));
          return sendJson(res, {
            error: 'watch_limit_reached',
            message: err.message,
            retryAfterSeconds: WATCH_LIMIT_RETRY_AFTER_SECONDS
          }, { status: 429 });
        }
        return sendJson(res, { error: 'watch_store_unavailable', message: String(err.message || err) }, { status: 503 });
      }

      // Preview: how many existing runs already match this combo (helps the
      // user confirm their spelling matches the dataset's naming).
      let matchingRuns = null;
      try {
        matchingRuns = runsForWatch(await getAllRuns(), record).length;
      } catch { /* dataset unavailable — skip the preview */ }

      return sendJson(res, {
        description: 'Watch created. Poll the rssUrl for new runs; if you registered a webhookUrl, POST /api/watch/dispatch delivers unseen matching runs to it. The secret is shown once — it is required to DELETE and is sent to your webhook as X-Watch-Secret.',
        watchId: record.watchId,
        secret: record.secret,
        label: watchLabel(record),
        rssUrl: rssPathFor(record),
        webhookUrl: record.webhookUrl,
        matchingExistingRuns: matchingRuns,
        createdAt: record.createdAt
      }, { status: 201 });
    }

    if (req.method === 'DELETE') {
      const q = req.query || {};
      const id = q.watchId ?? q.id;
      if (!id) {
        return sendJson(res, { error: 'validation_failed', errors: [{ field: 'id', code: 'required', message: "'id' is required" }] }, { status: 400 });
      }
      let removed;
      try {
        removed = await removeWatch(String(id), q.secret ?? req.headers['x-watch-secret']);
      } catch (err) {
        if (err.code === 'INVALID_SECRET') {
          return sendJson(res, { error: 'invalid_secret', message: err.message }, { status: 403 });
        }
        throw err;
      }
      if (!removed) {
        return sendJson(res, { error: 'watch_not_found', message: `no watch with id '${id}'` }, { status: 404 });
      }
      return res.status(204).end();
    }

    return sendJson(res, { error: `Method ${req.method} not allowed. Use GET to list watches, POST to create one, DELETE ?id=&secret= to remove one.` }, { status: 405 });
  } catch (err) {
    return sendProblemFromError(res, req, err);
  }
}
