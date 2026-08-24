// Regression tests for watch-registration dedupe (#1027) and webhook
// redirect hardening (#1029).
//
// #1027: POSTing an identical combo+webhookUrl twice used to append a second
// watch record, so every dispatch delivered the payload N times. saveWatch
// now refuses exact duplicates (canonicalized combo fingerprint) with a
// structured DUPLICATE_WATCH error; the handler maps it to 409.
//
// #1029: deliverWebhook used fetch's default redirect:'follow', so a single
// 30x from a validated https host could silently downgrade the delivery to an
// http:// internal target. Redirects are now followed manually with per-hop
// https re-validation (and a hop cap).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  validateWatch, saveWatch, listWatches,
  deliverWebhook, watchFingerprint, MAX_WEBHOOK_REDIRECTS
} from './_watch.js';

const RUN = () => ({
  runId: 'r1',
  createdAt: '2026-08-20T00:00:00Z',
  modelFamily: 'qwen3-32b',
  hardwareKey: 'rtx-4090',
  hardware: 'RTX 4090 (24GB)',
  quantization: 'q4_k_m'
});

async function freshStore() {
  const dir = await mkdtemp(join(tmpdir(), 'watches-dedupe-'));
  process.env.WATCHES_DIR = dir;
  return dir;
}

// ---------- #1027 duplicate registration ----------

test('watchFingerprint canonicalizes spelling/punctuation of the combo', () => {
  const a = validateWatch({ model: 'Qwen3 32B', hardware: 'RTX 4090', quant: 'Q4_K_M' }).watch;
  const b = validateWatch({ model: 'qwen3-32b', hardware: 'rtx 4090', quant: 'q4_k_m' }).watch;
  assert.equal(watchFingerprint(a), watchFingerprint(b));
});

test('saveWatch refuses an exact duplicate registration (#1027)', async () => {
  await freshStore();
  const first = validateWatch({ model: 'Qwen3 32B', hardware: 'RTX 4090', webhookUrl: 'https://example.com/hook' });
  const rec1 = await saveWatch(first.watch);
  assert.equal((await listWatches()).length, 1);

  // Same combo re-POSTed (e.g. agent retry) — must not stack a second record.
  const again = validateWatch({ model: 'qwen3-32b', hardware: 'rtx 4090', webhookUrl: 'https://example.com/hook' });
  await assert.rejects(
    () => saveWatch(again.watch),
    err => err.code === 'DUPLICATE_WATCH' && err.existingWatchId === rec1.watchId
  );
  assert.equal((await listWatches()).length, 1, 'duplicate must not be appended');
});

test('same combo with a different webhook target is NOT a duplicate (#1027)', async () => {
  await freshStore();
  await saveWatch(validateWatch({ model: 'm1', webhookUrl: 'https://a.example/hook' }).watch);
  await saveWatch(validateWatch({ model: 'm1', webhookUrl: 'https://b.example/hook' }).watch);
  await saveWatch(validateWatch({ model: 'm1' }).watch); // RSS-only vs webhooks
  assert.equal((await listWatches()).length, 3);
});

test('different combos are unaffected by the dedupe guard (#1027)', async () => {
  await freshStore();
  await saveWatch(validateWatch({ model: 'a' }).watch);
  await saveWatch(validateWatch({ hardware: 'b' }).watch);
  assert.equal((await listWatches()).length, 2);
});

// ---------- #1029 webhook redirect hardening ----------

const WATCH = { webhookUrl: 'https://example.com/hook', secret: 's3cret' };

function res(status, location) {
  return { ok: status < 400, status, headers: { get: k => (k.toLowerCase() === 'location' ? location : null) } };
}

test('deliverWebhook follows an https→https redirect and delivers to the final URL (#1029)', async () => {
  const calls = [];
  const out = await deliverWebhook(WATCH, [RUN()], {
    fetchImpl: async (url, opts) => {
      calls.push({ url, opts });
      return calls.length === 1
        ? res(301, 'https://forwarder.example/hook2')
        : { ok: true, status: 200 };
    }
  });
  assert.deepEqual(out, { ok: true, status: 200 });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, 'https://example.com/hook');
  assert.equal(calls[1].url, 'https://forwarder.example/hook2');
  assert.equal(calls[1].opts.headers['x-watch-secret'], 's3cret');
  assert.ok(JSON.parse(calls[1].opts.body).type === 'watch.new_runs');
  assert.equal(calls[1].opts.redirect, 'manual');
});

test('deliverWebhook BLOCKS an https→http redirect downgrade (#1029)', async () => {
  const calls = [];
  const out = await deliverWebhook(WATCH, [RUN()], {
    fetchImpl: async (url) => {
      calls.push(url);
      return res(302, 'http://127.0.0.1:9/internal');
    }
  });
  assert.equal(out.ok, false);
  assert.match(out.error, /non-https/);
  assert.deepEqual(calls, ['https://example.com/hook'], 'must never fetch the http target');
});

test('deliverWebhook blocks a non-https initial URL even if stored (#1029)', async () => {
  const out = await deliverWebhook({ ...WATCH, webhookUrl: 'http://example.com/hook' }, [RUN()], {
    fetchImpl: async () => { throw new Error('must not be called'); }
  });
  assert.equal(out.ok, false);
  assert.match(out.error, /non-https/);
});

test('deliverWebhook gives up after MAX_WEBHOOK_REDIRECTS hops (#1029)', async () => {
  let calls = 0;
  const out = await deliverWebhook(WATCH, [RUN()], {
    fetchImpl: async () => { calls++; return res(302, 'https://example.com/loop'); }
  });
  assert.equal(out.ok, false);
  assert.match(out.error, /too many webhook redirects/);
  assert.ok(calls <= MAX_WEBHOOK_REDIRECTS + 1);
});

test('deliverWebhook treats 303 as GET without a body (#1029)', async () => {
  const calls = [];
  await deliverWebhook(WATCH, [RUN()], {
    fetchImpl: async (url, opts) => {
      calls.push({ url, opts });
      return calls.length === 1 ? res(303, 'https://example.com/poll') : { ok: true, status: 200 };
    }
  });
  assert.equal(calls[1].opts.method, 'GET');
  assert.equal(calls[1].opts.body, undefined);
  assert.equal(calls[1].opts.headers['content-type'], undefined);
});

test('deliverWebhook still handles mocks/responses without headers (back-compat)', async () => {
  const seen = [];
  const ok = await deliverWebhook(WATCH, [RUN()], {
    fetchImpl: async (url, opts) => { seen.push({ url, opts }); return { ok: true, status: 200 }; }
  });
  assert.deepEqual(ok, { ok: true, status: 200 });
  assert.equal(seen[0].opts.headers['x-watch-secret'], 's3cret');
});
