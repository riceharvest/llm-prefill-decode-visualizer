// Shared engine for the watch-feed API (#109):
// validation of watched hardware+model combos, combo matching against
// community runs, RSS 2.0 feed rendering, and webhook dispatch.
// Pure logic — no Vercel/req/res dependencies — so it can be unit-tested.

import { normalizeModelId } from './_normalize.js';

const STRING_LIMITS = { model: 160, hardware: 160, quant: 60 };
export const MAX_WATCHES = 500;
/** Max run IDs remembered per watch so the notified-set cannot grow unbounded. */
export const MAX_SEEN_RUN_IDS = 200;
/** Cap on entries in one RSS response (RSS readers page via their own state). */
export const RSS_MAX_ITEMS = 50;
/** Webhook POST timeout in ms. */
export const WEBHOOK_TIMEOUT_MS = 5_000;
/**
 * Max webhook redirects followed per delivery (#1029). Every hop — including
 * the first — is re-validated as https before the request (or the next hop's
 * URL) is fetched, so a 30x from a validated host cannot downgrade the
 * delivery to http://internal targets.
 */
export const MAX_WEBHOOK_REDIRECTS = 3;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

function isBlank(v) {
  return v === undefined || v === null || (typeof v === 'string' && v.trim() === '');
}

/**
 * Validate a watch-subscription body.
 * A watch needs at least one of `model` / `hardware` (a "combo" is the pair,
 * but watching a bare model or bare rig is useful too); `quant` is optional.
 * `webhookUrl` is optional but must be https when present (RSS covers the
 * no-server case; http webhooks would leak the secret header in transit).
 * Returns { ok, errors, watch } — watch is null unless ok.
 */
export function validateWatch(body) {
  const errors = [];
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, errors: [{ field: 'body', code: 'type', message: 'request body must be a JSON object' }], watch: null };
  }

  const fields = {};
  for (const key of ['model', 'hardware', 'quant']) {
    const raw = body[key];
    if (isBlank(raw)) continue;
    if (typeof raw !== 'string') {
      errors.push({ field: key, code: 'type', message: `'${key}' must be a string` });
      continue;
    }
    const max = STRING_LIMITS[key];
    if (raw.length > max) {
      errors.push({ field: key, code: 'too_long', message: `'${key}' exceeds ${max} characters` });
      continue;
    }
    fields[key] = raw.trim();
  }

  if (!fields.model && !fields.hardware) {
    errors.push({ field: 'combo', code: 'required', message: "at least one of 'model' or 'hardware' is required (e.g. model='Qwen3 32B', hardware='RTX 4090')" });
  }

  let webhookUrl = null;
  if (!isBlank(body.webhookUrl)) {
    if (typeof body.webhookUrl !== 'string') {
      errors.push({ field: 'webhookUrl', code: 'type', message: "'webhookUrl' must be a string" });
    } else {
      try {
        const u = new URL(body.webhookUrl.trim());
        if (u.protocol !== 'https:') {
          errors.push({ field: 'webhookUrl', code: 'insecure', message: "'webhookUrl' must use https" });
        } else {
          webhookUrl = u.toString();
        }
      } catch {
        errors.push({ field: 'webhookUrl', code: 'invalid_url', message: "'webhookUrl' must be a valid absolute URL" });
      }
    }
  }

  if (errors.length) return { ok: false, errors, watch: null };

  return {
    ok: true,
    errors: [],
    watch: {
      // `model` keeps the caller's spelling for display; matching also tries
      // the normalized family so 'Qwen3 32B' finds runs keyed 'qwen3-32b'.
      model: fields.model ?? null,
      modelFamily: fields.model ? normalizeModelId(fields.model) : null,
      hardware: fields.hardware ?? null,
      quant: fields.quant ? fields.quant.toLowerCase() : null,
      webhookUrl,
      createdAt: new Date().toISOString(),
      lastSeenRunIds: []
    }
  };
}

const norm = s => String(s || '').toLowerCase();

/**
 * Canonical identity of a watch combo (#1027): normalized model/hardware/
 * quant plus the exact webhook target. Two registrations with the same
 * fingerprint would deliver every dispatch N times, so saveWatch refuses
 * exact duplicates.
 */
export function watchFingerprint(watch) {
  const canon = s => String(s ?? '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
  return JSON.stringify([
    canon(watch.model),
    canon(watch.hardware),
    canon(watch.quant),
    watch.webhookUrl ? String(watch.webhookUrl).trim() : ''
  ]);
}

/**
 * Does one community run match a watch? Mirrors the /api/localmaxxing GET
 * filters: model matches modelFamily or raw modelId as a substring, hardware
 * matches hardwareKey or label as a substring, quant compares exactly
 * (lowercased). Null watch fields are wildcards.
 */
export function matchesWatch(run, watch) {
  const modelNeedle = norm(watch.model);
  const familyNeedle = norm(watch.modelFamily);
  const hwNeedle = norm(watch.hardware).replace(/[^a-z0-9]/g, '');
  const quantNeedle = watch.quant ? norm(watch.quant) : null;

  if (modelNeedle || familyNeedle) {
    // Display spellings ('Qwen3 32B') differ from dataset keys ('qwen3-32b')
    // only in punctuation, so compare both raw and alnum-canonical forms.
    const needles = [modelNeedle, familyNeedle].filter(Boolean);
    const canon = s => s.replace(/[^a-z0-9]/g, '');
    const canonNeedles = needles.map(canon);
    const hit = [norm(run.modelFamily), norm(run.modelId), norm(run.modelName)]
      .some(hay => hay && (needles.some(n => hay.includes(n)) || canonNeedles.some(n => canon(hay).includes(n))));
    if (!hit) return false;
  }
  if (hwNeedle) {
    const hays = [norm(run.hardwareKey), norm(run.hardware)].map(h => h.replace(/[^a-z0-9]/g, ''));
    if (!hays.some(h => h && (h.includes(hwNeedle) || hwNeedle.includes(h)))) return false;
  }
  if (quantNeedle && norm(run.quantization) !== quantNeedle) return false;
  return true;
}

/** All runs matching a watch, newest first (undated runs last). */
export function runsForWatch(runs, watch) {
  return runs
    .filter(r => matchesWatch(r, watch))
    .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
}

/**
 * Runs a watch has NOT been notified about yet: matched, created after the
 * watch itself, and not already in the watch's bounded seen-set. Pure — the
 * caller persists the updated seen-set.
 */
export function unseenRunsForWatch(runs, watch, _now = Date.now()) {
  const seen = new Set(watch.lastSeenRunIds || []);
  const createdAtMs = new Date(watch.createdAt || 0).getTime();
  return runsForWatch(runs, watch).filter(r => {
    if (seen.has(String(r.runId))) return false;
    const t = r.createdAt ? new Date(r.createdAt).getTime() : NaN;
    if (!Number.isFinite(t)) return true; // undated runs surface once (no ordering signal)
    return t >= createdAtMs - 1000;
  }).slice(0, MAX_SEEN_RUN_IDS);
}

/** Bounded merge of notified run IDs onto a watch record (mutates + returns it). */
export function markRunsSeen(watch, runs, now = Date.now()) {
  const prior = watch.lastSeenRunIds || [];
  // runs arrive newest-first (runsForWatch); keep that ordering and cap the set.
  const fresh = runs.map(r => String(r.runId)).filter(id => !prior.includes(id));
  watch.lastSeenRunIds = [...fresh, ...prior].slice(0, MAX_SEEN_RUN_IDS);
  watch.lastDispatchAt = new Date(now).toISOString();
  return watch;
}

// ---------- RSS ----------

function xmlEscape(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

/** RFC 822 date for RSS pubDate; falls back to build time for undated runs. */
function rfc822(d, fallback) {
  const t = d ? new Date(d).getTime() : NaN;
  return new Date(Number.isFinite(t) ? t : fallback).toUTCString();
}

/** Stable GUID per run (the upstream run id, namespaced). */
function runGuid(run) {
  return `urn:llm-prefill-decode-visualizer:run:${run.runId}`;
}

/**
 * Render an RSS 2.0 feed of community runs for a combo.
 * `origin` seeds absolute self-references; runs carry their own `source` link.
 */
export function buildRssFeed({ runs, title, description, origin = '', builtAt = Date.now() }) {
  const items = runs.slice(0, RSS_MAX_ITEMS);
  const esc = xmlEscape;
  const itemXml = items.map(r => {
    const speed = `${r.prefillTokPerSec} prefill / ${r.decodeTokPerSec} decode tok/s`;
    const bits = [
      r.quantization && `quant ${r.quantization}`,
      r.engine && `engine ${r.engine}`,
      r.contextBand && `context ${r.contextBand}`
    ].filter(Boolean).join(' · ');
    return [
      '    <item>',
      `      <title>${esc(`${r.modelFamily} on ${r.hardware}: ${speed}`)}</title>`,
      `      <link>${esc(r.source || origin)}</link>`,
      `      <guid isPermaLink="false">${esc(runGuid(r))}</guid>`,
      `      <pubDate>${rfc822(r.createdAt, builtAt)}</pubDate>`,
      `      <description>${esc([bits, speed].filter(Boolean).join('\n'))}</description>`,
      '    </item>'
    ].join('\n');
  }).join('\n');

  const selfTitle = esc(title || 'Watched combo — new community benchmark runs');
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${selfTitle}</title>
    <link>${esc(origin)}</link>
    <description>${esc(description || 'New single-stream LLM benchmark runs matching your watched hardware/model combination.')}</description>
    <language>en</language>
    <lastBuildDate>${new Date(builtAt).toUTCString()}</lastBuildDate>
${items.length ? `
    <atom:link href="${esc(origin)}" rel="self" type="application/rss+xml" />
` : ''}${itemXml ? itemXml + '\n' : ''}  </channel>
</rss>
`;
}

// ---------- Webhooks ----------

/** JSON payload POSTed to a watch's webhookUrl when new runs land. */
export function webhookPayload(watch, runs, sentAt = new Date().toISOString()) {
  return {
    type: 'watch.new_runs',
    sentAt,
    watch: {
      watchId: watch.watchId,
      model: watch.model,
      hardware: watch.hardware,
      quant: watch.quant,
      rssUrl: rssPathFor(watch)
    },
    totalNew: runs.length,
    runs: runs.map(r => ({
      runId: r.runId,
      source: r.source,
      modelFamily: r.modelFamily,
      modelId: r.modelId,
      hardware: r.hardware ?? r.hardwareKey,
      hwClass: r.hwClass,
      quantization: r.quantization,
      engine: r.engine,
      prefillTokPerSec: r.prefillTokPerSec,
      decodeTokPerSec: r.decodeTokPerSec,
      contextBand: r.contextBand ?? null,
      createdAt: r.createdAt
    }))
  };
}

/** Human-readable combo label used in feeds/UI. */
export function watchLabel(watch) {
  return [watch.hardware, watch.model].filter(Boolean).join(' + ') || 'any combo';
}

/** Relative RSS URL for a watch's combo. */
export function rssPathFor(watch) {
  const q = new URLSearchParams();
  if (watch.model) q.set('model', watch.model);
  if (watch.hardware) q.set('hardware', watch.hardware);
  if (watch.quant) q.set('quant', watch.quant);
  const qs = q.toString();
  return `/api/watch/rss.xml${qs ? `?${qs}` : ''}`;
}

// ---------- Watch store ----------
// JSONL file, one watch per line — same pattern as the submission review
// queue in _submit.js: per-instance on ephemeral serverless filesystems,
// point WATCHES_DIR at a mounted volume to persist.

const WATCHES_FILE = 'watches.jsonl';

function watchesPath() {
  const dir = process.env.WATCHES_DIR || '/tmp';
  return `${dir.replace(/\/$/, '')}/${WATCHES_FILE}`;
}

function newId() {
  const t = Date.now().toString(36);
  const r = Math.random().toString(36).slice(2, 8);
  return `watch_${t}_${r}`;
}

/** Read all stored watches; missing file = no watches yet. */
export async function listWatches() {
  const { readFile } = await import('node:fs/promises');
  let raw;
  try {
    raw = await readFile(watchesPath(), 'utf8');
  } catch {
    return [];
  }
  return raw.split('\n').filter(Boolean).map(line => {
    try { return JSON.parse(line); } catch { return null; }
  }).filter(Boolean);
}

/**
 * Persist a new watch: assigns watchId + secret and appends to the store.
 * Enforces MAX_WATCHES so the file cannot grow without bound.
 */
export async function saveWatch(watch) {
  const existing = await listWatches();
  if (existing.length >= MAX_WATCHES) {
    throw new Error(`watch limit reached (${MAX_WATCHES})`);
  }
  // Duplicate registration guard (#1027): an identical combo+webhook would
  // receive every dispatch N times. Refuse with a structured error (the
  // handler maps it to 409 + the existing watchId); the secret is NOT
  // re-disclosed to the duplicate caller.
  const fp = watchFingerprint(watch);
  const dupe = existing.find(w => watchFingerprint(w) === fp);
  if (dupe) {
    const err = new Error(`an identical watch already exists (${dupe.watchId}); reuse its rssUrl or DELETE it first`);
    err.code = 'DUPLICATE_WATCH';
    err.existingWatchId = dupe.watchId;
    throw err;
  }
  const record = { ...watch, watchId: newId(), secret: newSecret() };
  const { appendFile } = await import('node:fs/promises');
  await appendFile(watchesPath(), JSON.stringify(record) + '\n', 'utf8');
  return record;
}

/** Find one watch by id, or null. */
export async function findWatch(watchId) {
  return (await listWatches()).find(w => w.watchId === watchId) ?? null;
}

/**
 * Rewrite a single watch record (e.g. after dispatch marks runs seen).
 * Best-effort atomicity: write temp file, rename over the original.
 */
export async function updateWatch(updated) {
  const all = await listWatches();
  const next = all.map(w => (w.watchId === updated.watchId ? updated : w));
  const { writeFile, rename } = await import('node:fs/promises');
  const path = watchesPath();
  await writeFile(`${path}.tmp`, next.map(w => JSON.stringify(w)).join('\n') + '\n', 'utf8');
  await rename(`${path}.tmp`, path);
}

/**
 * Delete a watch — requires both id and its secret (returned exactly once
 * at signup; RSS subscribers never need it, webhooks carry it as a header).
 * Returns true when removed, false for unknown id, throws on bad secret.
 */
export async function removeWatch(watchId, secret) {
  const all = await listWatches();
  const target = all.find(w => w.watchId === watchId);
  if (!target) return false;
  if (!secret || target.secret !== String(secret)) {
    const err = new Error('invalid or missing secret for this watchId');
    err.code = 'INVALID_SECRET';
    throw err;
  }
  const next = all.filter(w => w.watchId !== watchId);
  const { writeFile, rename } = await import('node:fs/promises');
  const path = watchesPath();
  await writeFile(`${path}.tmp`, next.map(w => JSON.stringify(w)).join('\n') + '\n', 'utf8');
  await rename(`${path}.tmp`, path);
  return true;
}

function newSecret() {
  // 128 bits of URL-safe entropy via Web Crypto (available in Node >= 19 globally).
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return Buffer.from(bytes).toString('base64url');
}

/** Test hook: clear any module state (kept for symmetry with _ratelimit.js). */
export function _resetWatchStore() {
  /* stateless — nothing cached in memory */
}

/**
 * POST the payload to a watch's webhook. Resolves to
 * { ok, status?, error?, skipped? } — never throws (delivery failures are
 * data, not crashes: dispatch continues with the remaining watches).
 */
export async function deliverWebhook(watch, runs, { fetchImpl = fetch, timeoutMs = WEBHOOK_TIMEOUT_MS, maxRedirects = MAX_WEBHOOK_REDIRECTS } = {}) {
  if (!watch.webhookUrl) return { ok: false, skipped: true, error: 'no webhookUrl registered' };
  const body = JSON.stringify(webhookPayload(watch, runs));
  try {
    let url = String(watch.webhookUrl);
    let method = 'POST';
    for (let hop = 0; ; hop++) {
      // Re-validate the scheme on EVERY hop (#1029): validateWatch only gates
      // the URL at subscribe time; a redirect from the validated host must
      // not be allowed to downgrade https → http.
      if (new URL(url).protocol !== 'https:') {
        return { ok: false, error: `blocked non-https webhook ${hop ? 'redirect target' : 'URL'}: ${url}` };
      }
      const isGet = method === 'GET';
      const res = await fetchImpl(url, {
        method,
        headers: {
          // HMAC-lite: lets receivers confirm the ping came from this deploy
          // (share the secret out-of-band; it was returned exactly once at signup).
          'x-watch-secret': watch.secret,
          'user-agent': 'llm-prefill-decode-visualizer-watch/1.0',
          ...(isGet ? {} : { 'content-type': 'application/json' })
        },
        body: isGet ? undefined : body,
        redirect: 'manual',
        signal: AbortSignal.timeout(timeoutMs)
      });
      if (REDIRECT_STATUSES.has(res.status)) {
        const loc = res?.headers?.get?.('location');
        if (!loc) return { ok: res.ok, status: res.status };
        if (hop >= maxRedirects) return { ok: false, error: `too many webhook redirects (> ${maxRedirects})` };
        url = new URL(loc, url).toString();
        if (res.status === 303 && method === 'POST') method = 'GET'; // RFC 9110: 303 → GET, body dropped
        continue;
      }
      return { ok: res.ok, status: res.status };
    }
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  }
}
