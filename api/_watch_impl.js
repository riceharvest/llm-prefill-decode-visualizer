import { enforceRateLimit } from './_ratelimit.js';
import { sendJson } from './_schema.js';
import { sendProblemFromError } from './_errors.js';
import { getAllRuns } from './_localmaxxing.js';
import {
  validateWatch, saveWatch, listWatches, removeWatch,
  runsForWatch, watchLabel, rssPathFor, MAX_WATCHES
} from './_watch.js';

export const config = { runtime: 'nodejs' };

const DESCRIPTION =
  'Watch feeds (#109): subscribe to a hardware+model combination (e.g. "RTX 4090 + Qwen3 32B") and get notified when new community LocalMaxxing runs land for that pair. ' +
  'POST { model?, hardware?, quant?, webhookUrl? } to create a watch — at least one of model/hardware is required; webhookUrl (https) adds webhook delivery on top of the RSS feed. ' +
  'The response carries watchId + secret (save the secret: it is shown once and is required to DELETE) and a ready-made rssUrl. ' +
  'RSS: GET /api/watch/rss.xml?model=&hardware=&quant= — poll it like any feed. ' +
  'Webhooks: POST /api/watch/dispatch (cron-friendly) delivers unseen matching runs to each registered webhook with an X-Watch-Secret header. ' +
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
      return sendJson(res, {
        description: DESCRIPTION,
        maxWatches: MAX_WATCHES,
        totalWatches: watches.length,
        watches: watches.map(w => ({
          watchId: w.watchId,
          label: watchLabel(w),
          model: w.model, hardware: w.hardware, quant: w.quant,
          hasWebhook: !!w.webhookUrl,
          createdAt: w.createdAt
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
          return sendJson(res, { error: 'watch_limit_reached', message: err.message }, { status: 429 });
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

    return sendJson(res, { error: `Method ${req.method} not allowed. Use GET to list watches, POST to create one, DELETE ?id= with the X-Watch-Secret header (or ?secret=) to remove one.` }, { status: 405 });
  } catch (err) {
    return sendProblemFromError(res, req, err);
  }
}
