// #597 + #603 — watch hardening:
// #597: webhookUrl must not target loopback/private/link-local addresses
//       (registration-time stored-SSRF guard).
// #603: when the watch store is the default ephemeral /tmp JSONL, POST and
//       DELETE-404 responses carry a machine-readable ephemerality warning.

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { validateWatch, isPrivateWebhookHost, watchStoreWarning } from './_watch.js';

test('#597: isPrivateWebhookHost blocks loopback, RFC1918, link-local, CGNAT, internal names', () => {
  for (const host of [
    'localhost', 'foo.localhost', 'metadata.local', 'svc.internal',
    '127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255',
    '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0',
    '::1', 'fe80::1', 'fd00::1'
  ]) {
    assert.ok(isPrivateWebhookHost(host), `${host} should be blocked`);
  }
});

test('#597: public https hosts are allowed through', () => {
  for (const host of ['example.com', 'hooks.example.org', '8.8.8.8', '172.32.0.1']) {
    assert.equal(isPrivateWebhookHost(host), false, `${host} should be allowed`);
  }
});

test('#597: validateWatch rejects private-address webhookUrls with a typed error', () => {
  const loopback = validateWatch({ model: 'Qwen3 32B', webhookUrl: 'https://127.0.0.1:9/hook' });
  assert.equal(loopback.ok, false);
  assert.equal(loopback.errors[0].code, 'private_address');

  const metadata = validateWatch({ hardware: 'RTX 4090', webhookUrl: 'https://169.254.169.254/latest/meta-data' });
  assert.equal(metadata.ok, false);
  assert.equal(metadata.errors[0].field, 'webhookUrl');

  // Public https still fine.
  const ok = validateWatch({ model: 'Qwen3 32B', webhookUrl: 'https://example.com/hook' });
  assert.equal(ok.ok, true);
});

test('#603: watchStoreWarning fires only when WATCHES_DIR is unset (ephemeral /tmp)', () => {
  const had = process.env.WATCHES_DIR;
  try {
    delete process.env.WATCHES_DIR;
    const w = watchStoreWarning();
    assert.ok(w);
    assert.equal(w.code, 'ephemeral_watch_store');
    assert.ok(w.message.includes('WATCHES_DIR'));

    process.env.WATCHES_DIR = '/mnt/durable';
    assert.equal(watchStoreWarning(), null);
  } finally {
    if (had === undefined) delete process.env.WATCHES_DIR;
    else process.env.WATCHES_DIR = had;
  }
});

// ---------- Handler-level: warnings surface on POST 201 and DELETE 404 ----------

let realFetch603;
beforeEach(() => {
  realFetch603 = globalThis.fetch;
  // getAllRuns() preview fetch — empty dataset is fine.
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ rows: [] }) });
});
afterEach(() => {
  globalThis.fetch = realFetch603;
});

const { default: watchHandler } = await import('./_watch_impl.js');

function mockRes() {
  return {
    statusCode: 0, headers: {}, body: null,
    setHeader(k, v) { this.headers[k] = v; },
    getHeader(k) { return this.headers[k]; },
    hasHeader(k) { return k.toLowerCase() in this.headers; },
    status(c) { this.statusCode = c; return this; },
    end(b) { this.body = b ? JSON.parse(b) : null; }
  };
}

async function callWatch(method, { query, body } = {}) {
  const res = mockRes();
  await watchHandler({ method, query: query || {}, body }, res);
  return { status: res.statusCode, json: res.body };
}

test('#603: POST carries an ephemeral-store warning when WATCHES_DIR is unset', async () => {
  const had = process.env.WATCHES_DIR;
  try {
    delete process.env.WATCHES_DIR;
    const { status, json } = await callWatch('POST', { body: { model: 'Qwen3 32B' } });
    assert.equal(status, 201);
    const w = (json.warnings || []).find(x => x.code === 'ephemeral_watch_store');
    assert.ok(w, 'POST should warn about the ephemeral store');
  } finally {
    if (had === undefined) delete process.env.WATCHES_DIR;
    else process.env.WATCHES_DIR = had;
  }
});

test('#603: DELETE watch_not_found explains ephemerality when ephemeral', async () => {
  const had = process.env.WATCHES_DIR;
  try {
    delete process.env.WATCHES_DIR; // nothing stored anywhere → guaranteed 404
    const { status, json } = await callWatch('DELETE', { query: { id: 'watch_x', secret: 's' } });
    assert.equal(status, 404);
    assert.equal(json.error, 'watch_not_found');
    const w = (json.warnings || []).find(x => x.code === 'ephemeral_watch_store');
    assert.ok(w, '404 should carry the cross-instance hint');
  } finally {
    if (had === undefined) delete process.env.WATCHES_DIR;
    else process.env.WATCHES_DIR = had;
  }
});

test('#603: durable store (WATCHES_DIR set) keeps responses warning-free', async () => {
  const { mkdtemp } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const had = process.env.WATCHES_DIR;
  process.env.WATCHES_DIR = await mkdtemp(join(tmpdir(), 'watches-durable-'));
  try {
    const created = await callWatch('POST', { body: { model: 'Qwen3 32B' } });
    assert.equal(created.status, 201);
    assert.equal(created.json.warnings, undefined);

    const gone = await callWatch('DELETE', { query: { id: 'watch_absent', secret: 's' } });
    assert.equal(gone.status, 404);
    assert.equal(gone.json.warnings, undefined);
  } finally {
    if (had === undefined) delete process.env.WATCHES_DIR;
    else process.env.WATCHES_DIR = had;
  }
});
