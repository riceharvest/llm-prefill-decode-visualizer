import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  validateWatch, matchesWatch, runsForWatch, unseenRunsForWatch,
  markRunsSeen, buildRssFeed, webhookPayload, deliverWebhook,
  watchLabel, rssPathFor, saveWatch, listWatches, findWatch,
  removeWatch, updateWatch, MAX_WATCHES, MAX_SEEN_RUN_IDS, RSS_MAX_ITEMS
} from './_watch.js';

const RUN = (over = {}) => ({
  runId: 'r1',
  createdAt: '2026-08-20T00:00:00Z',
  modelFamily: 'qwen3-32b',
  modelId: 'Qwen/Qwen3-32B-GGUF',
  modelName: 'Qwen3 32B',
  hardwareKey: 'rtx-4090',
  hardware: 'RTX 4090 (24GB)',
  hwClass: 'discrete_gpu',
  quantization: 'q4_k_m',
  engine: 'llama.cpp',
  prefillTokPerSec: 3000,
  decodeTokPerSec: 60,
  contextBand: '8k-32k',
  source: 'https://localmaxxing.com/en/runs/r1',
  ...over
});

test('validateWatch requires at least one of model/hardware', () => {
  const bad = validateWatch({ quant: 'q4_k_m' });
  assert.equal(bad.ok, false);
  assert.ok(bad.errors.some(e => e.field === 'combo' && e.code === 'required'));

  const ok = validateWatch({ model: 'Qwen3 32B', hardware: 'RTX 4090' });
  assert.equal(ok.ok, true, JSON.stringify(ok.errors));
  assert.equal(ok.watch.modelFamily, 'qwen3 32b');
  assert.equal(ok.watch.quant, null);
  assert.equal(ok.watch.webhookUrl, null);
});

test('validateWatch normalizes quant and validates webhookUrl', () => {
  const { ok, watch } = validateWatch({ model: 'qwen3', quant: 'Q4_K_M', webhookUrl: 'https://example.com/hook' });
  assert.equal(ok, true);
  assert.equal(watch.quant, 'q4_k_m');
  assert.equal(watch.webhookUrl, 'https://example.com/hook');

  assert.equal(validateWatch({ model: 'x', webhookUrl: 'http://example.com/hook' }).ok, false);
  assert.equal(validateWatch({ model: 'x', webhookUrl: 'not a url' }).ok, false);
  assert.ok(validateWatch({ model: 'x'.repeat(200) }).errors.some(e => e.code === 'too_long'));
  assert.equal(validateWatch('nope').ok, false);
});

test('matchesWatch mirrors the /api/localmaxxing GET filters', () => {
  const run = RUN();
  assert.equal(matchesWatch(run, { model: 'Qwen3 32B', hardware: null, quant: null }), true, 'display spelling matches via family');
  assert.equal(matchesWatch(run, { model: 'qwen3-32b', hardware: '4090', quant: 'q4_k_m' }), true);
  assert.equal(matchesWatch(run, { model: null, hardware: 'RTX 4090', quant: null }), true);
  assert.equal(matchesWatch(run, { model: 'llama', hardware: null, quant: null }), false);
  assert.equal(matchesWatch(run, { model: null, hardware: '5090', quant: null }), false);
  assert.equal(matchesWatch(run, { model: null, hardware: null, quant: 'q5_k_m' }), false);
  // Empty watch matches everything
  assert.equal(matchesWatch(run, {}), true);
});

test('runsForWatch sorts newest first and undated runs last', () => {
  const runs = [
    RUN({ runId: 'a', createdAt: '2026-08-01T00:00:00Z' }),
    RUN({ runId: 'b', createdAt: '2026-08-10T00:00:00Z' }),
    RUN({ runId: 'c', createdAt: null })
  ];
  const sorted = runsForWatch(runs, {});
  assert.deepEqual(sorted.map(r => r.runId), ['b', 'a', 'c']);
});

test('unseenRunsForWatch skips pre-watch runs and the seen-set', () => {
  const watch = {
    model: null, hardware: '4090', quant: null,
    createdAt: '2026-08-05T00:00:00Z',
    lastSeenRunIds: ['b']
  };
  const runs = [
    RUN({ runId: 'old', createdAt: '2026-08-01T00:00:00Z' }),
    RUN({ runId: 'b', createdAt: '2026-08-10T00:00:00Z' }),
    RUN({ runId: 'new', createdAt: '2026-08-20T00:00:00Z' }),
    RUN({ runId: 'undated', createdAt: null })
  ];
  const unseen = unseenRunsForWatch(runs, watch);
  assert.deepEqual(unseen.map(r => r.runId), ['new', 'undated']);
});

test('markRunsSeen keeps the seen-set bounded and stamps lastDispatchAt', () => {
  const watch = { lastSeenRunIds: [] };
  const runs = Array.from({ length: MAX_SEEN_RUN_IDS + 10 }, (_, i) => RUN({ runId: `r${i}` }));
  markRunsSeen(watch, runs, 1_700_000_000_000);
  assert.equal(watch.lastSeenRunIds.length, MAX_SEEN_RUN_IDS);
  assert.ok(watch.lastSeenRunIds.includes('r0')); // newest first
  assert.equal(watch.lastDispatchAt, new Date(1_700_000_000_000).toISOString());
});

test('buildRssFeed emits valid RSS with escaped titles and capped items', () => {
  const runs = Array.from({ length: RSS_MAX_ITEMS + 5 }, (_, i) =>
    RUN({ runId: `r${i}`, modelFamily: i === 0 ? 'a<b>&"x"' : 'qwen3-32b' }));
  const xml = buildRssFeed({ runs, title: 'RTX 4090 + Qwen3 32B', origin: 'https://example.com' });
  assert.ok(xml.startsWith('<?xml version="1.0"'));
  assert.ok(xml.includes('<rss version="2.0"'));
  assert.ok(xml.includes('a&lt;b&gt;&amp;&quot;x&quot;'));
  assert.equal((xml.match(/<item>/g) || []).length, RSS_MAX_ITEMS);
  assert.ok(xml.includes('urn:llm-prefill-decode-visualizer:run:r0'));
  assert.ok(xml.includes('<pubDate>'));

  const empty = buildRssFeed({ runs: [], title: 'x' });
  assert.ok(!empty.includes('<item>'));
});

test('webhookPayload carries watch identity + normalized runs', () => {
  const watch = { watchId: 'w1', model: 'Qwen3 32B', hardware: 'RTX 4090', quant: 'q4_k_m' };
  const payload = webhookPayload(watch, [RUN()]);
  assert.equal(payload.type, 'watch.new_runs');
  assert.equal(payload.totalNew, 1);
  assert.equal(payload.watch.watchId, 'w1');
  assert.equal(payload.runs[0].decodeTokPerSec, 60);
  assert.equal(payload.runs[0].hardware, 'RTX 4090 (24GB)');
});

test('deliverWebhook posts with the secret header and never throws', async () => {
  const watch = { webhookUrl: 'https://example.com/hook', secret: 's3cret' };
  const seen = [];
  const ok = await deliverWebhook(watch, [RUN()], {
    fetchImpl: async (url, opts) => { seen.push({ url, opts }); return { ok: true, status: 200 }; }
  });
  assert.deepEqual(ok, { ok: true, status: 200 });
  assert.equal(seen[0].url, 'https://example.com/hook');
  assert.equal(seen[0].opts.headers['x-watch-secret'], 's3cret');
  assert.ok(JSON.parse(seen[0].opts.body).type === 'watch.new_runs');

  const fail = await deliverWebhook(watch, [RUN()], {
    fetchImpl: async () => { throw new Error('boom'); }
  });
  assert.equal(fail.ok, false);
  assert.match(fail.error, /boom/);

  const skip = await deliverWebhook({ ...watch, webhookUrl: null }, [RUN()]);
  assert.equal(skip.skipped, true);
});

test('watchLabel + rssPathFor round-trip a combo', () => {
  const watch = { model: 'Qwen3 32B', hardware: 'RTX 4090', quant: 'Q4_K_M' };
  assert.equal(watchLabel(watch), 'RTX 4090 + Qwen3 32B');
  assert.equal(rssPathFor(watch), '/api/watch/rss.xml?model=Qwen3+32B&hardware=RTX+4090&quant=Q4_K_M');
});

// ---------- Store (JSONL in WATCHES_DIR) ----------

let tmpStore;
async function freshStore() {
  tmpStore = await mkdtemp(join(tmpdir(), 'watches-'));
  process.env.WATCHES_DIR = tmpStore;
}

test('store: save/list/find/remove round-trip with secrets enforced', async () => {
  await freshStore();
  const { ok, watch } = validateWatch({ model: 'Qwen3 32B', hardware: 'RTX 4090' });
  const record = await saveWatch(watch);
  assert.match(record.watchId, /^watch_/);
  assert.ok(record.secret.length >= 20);

  assert.equal((await listWatches()).length, 1);
  assert.deepEqual((await findWatch(record.watchId)).watchId, record.watchId);

  // Wrong secret must not delete.
  await assert.rejects(removeWatch(record.watchId, 'wrong'), /secret/i);
  await assert.rejects(removeWatch(record.watchId, null), /secret/i);
  assert.equal((await listWatches()).length, 1);

  assert.equal(await removeWatch(record.watchId, record.secret), true);
  assert.equal(await removeWatch(record.watchId, record.secret), false, 'second delete = not found');
  assert.equal((await listWatches()).length, 0);
});

test('store: updateWatch rewrites one record and listWatches tolerates junk lines', async () => {
  await freshStore();
  const a = await saveWatch(validateWatch({ model: 'a' }).watch);
  const b = await saveWatch(validateWatch({ hardware: 'b' }).watch);
  assert.ok(a.watchId && b.watchId);

  const { appendFile } = await import('node:fs/promises');
  await appendFile(join(tmpStore, 'watches.jsonl'), 'NOT JSON\n', 'utf8');

  b.lastSeenRunIds = ['r9'];
  await updateWatch(b);
  const all = await listWatches();
  assert.equal(all.length, 2, 'junk line dropped');
  assert.deepEqual(all.find(w => w.watchId === b.watchId).lastSeenRunIds, ['r9']);
  assert.ok(all.find(w => w.watchId === a.watchId));
});

test('store: enforces MAX_WATCHES', async () => {
  await freshStore();
  for (let i = 0; i < MAX_WATCHES; i++) {
    await saveWatch(validateWatch({ model: `m${i}` }).watch);
  }
  await assert.rejects(() => saveWatch(validateWatch({ model: 'overflow' }).watch), /limit reached/);
});
