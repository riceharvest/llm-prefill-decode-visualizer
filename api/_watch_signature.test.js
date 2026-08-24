import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { deliverWebhook } from './_watch.js';

// #935: outbound deliveries carried only the static bearer (x-watch-secret —
// the same value as the DELETE credential, disclosed to every receiver on
// every delivery and replayable forever). deliverWebhook now also stamps an
// HMAC-SHA256 signature over "<unix-seconds>.<body>" so receivers can verify
// integrity + freshness. The legacy bearer header is kept for back-compat.

function captureDelivery() {
  const state = {};
  const fetchImpl = async (_url, opts) => {
    state.opts = opts;
    return { ok: true, status: 200 };
  };
  return { fetchImpl, state };
}

const WATCH = {
  watchId: 'watch_test',
  webhookUrl: 'https://example.test/hook',
  secret: 's3cret-base64url-value',
  model: 'qwen3.6-27b'
};

test('delivery carries x-watch-signature with t=<unix-seconds>,v1=<hex hmac>', async () => {
  const { fetchImpl, state } = captureDelivery();
  const res = await deliverWebhook(WATCH, [], { fetchImpl });
  assert.ok(res.ok);
  const sig = state.opts.headers['x-watch-signature'];
  const m = /^t=(\d+),v1=([0-9a-f]{64})$/.exec(sig);
  assert.ok(m, `signature header shape: ${sig}`);
  const ts = Number(m[1]);
  assert.ok(Math.abs(Date.now() / 1000 - ts) < 60, 'timestamp is current unix seconds');
});

test('signature verifies over "<t>.<body>" with the watch secret', async () => {
  const { fetchImpl, state } = captureDelivery();
  await deliverWebhook(WATCH, [{ runId: 'abc123' }], { fetchImpl });
  const m = /^t=(\d+),v1=([0-9a-f]{64})$/.exec(state.opts.headers['x-watch-signature']);
  const expected = createHmac('sha256', WATCH.secret).update(`${m[1]}.${state.opts.body}`).digest('hex');
  assert.equal(m[2], expected);
});

test('signature changes when the payload changes (integrity, not a static bearer)', async () => {
  const sigs = [];
  for (const runs of [[{ runId: 'r1' }], [{ runId: 'r2' }]]) {
    const { fetchImpl, state } = captureDelivery();
    await deliverWebhook(WATCH, runs, { fetchImpl });
    sigs.push(state.opts.headers['x-watch-signature']);
  }
  assert.notEqual(sigs[0], sigs[1]);
});

test('legacy x-watch-secret bearer preserved alongside the signature', async () => {
  const { fetchImpl, state } = captureDelivery();
  await deliverWebhook(WATCH, [], { fetchImpl });
  assert.equal(state.opts.headers['x-watch-secret'], WATCH.secret);
});
