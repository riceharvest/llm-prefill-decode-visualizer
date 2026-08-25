import { test } from 'node:test';
import assert from 'node:assert/strict';
import diffHandler, {
  parseConstraintSet,
  parseWhatIfQuery,
  ignoredConstraintKeys
} from './_handlers/diff.js';
import { bestBody } from './_handlers/best.js';
import { invalidateCache } from './_localmaxxing.js';

// ---- mock dataset ---------------------------------------------------------

function row(id, rig, hfId, prefill, decode, paramsB, vramGb) {
  return {
    id,
    tokSPrefill: prefill,
    tokSOut: decode,
    promptTokens: 2048,
    outputTokens: 512,
    contextLength: 4096,
    hardwareGroupKey: rig,
    hardwareGroupLabel: rig.toUpperCase(),
    hardware: { hwClass: 'discrete_gpu', gpuName: rig, gpuCount: 1, vramGb },
    model: { hfId, displayName: hfId, params: paramsB },
    engine: { engineName: 'llama.cpp', quantization: 'Q4_K_M' },
    batchSize: 1
  };
}

const ROWS = [
  // big rig: fits at every tested context
  ...Array.from({ length: 5 }, (_, i) =>
    row(`big${i}`, 'rtx4090', 'org/qwen-7b', 3000 + i, 100 + i, 7, 24)),
  // small rig: only fits short contexts
  ...Array.from({ length: 5 }, (_, i) =>
    row(`small${i}`, 'rtx3050', 'org/qwen-7b', 1500 + i, 50 + i, 7, 8))
];

async function withDataset(fn) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ rows: ROWS }) });
  invalidateCache();
  try {
    return await fn();
  } finally {
    globalThis.fetch = originalFetch;
    invalidateCache();
  }
}

async function callDiff(req) {
  const captured = {};
  const res = {
    statusCode: 0,
    setHeader() {},
    getHeader() { return undefined; },
    end(body) {
      captured.status = this.statusCode;
      captured.body = JSON.parse(body);
    }
  };
  await diffHandler(req, res);
  return captured;
}

// Simulate how the platform hands a request to the handler: req.url is the
// raw target, req.query is the ALREADY-FLATTENED query object.
function getReq(url) {
  const u = new URL(`https://x.test${url}`);
  const query = {};
  for (const [k, v] of u.searchParams) query[k] = v;
  return { method: 'GET', url, query };
}

// ---- #556: documented ?a=k=v&…&b=k=v format loses keys --------------------

test('parseWhatIfQuery recovers both sets from the documented k=v format (#556)', () => {
  const sets = parseWhatIfQuery(
    'mode=whatif&a=fitCheck=true&contextLength=8192&model=qwen&b=fitCheck=true&contextLength=65536&model=qwen');
  assert.equal(sets.a.fitCheck, 'true');
  assert.equal(sets.a.contextLength, '8192');
  assert.equal(sets.a.model, 'qwen');
  assert.equal(sets.b.contextLength, '65536');
  assert.equal(sets.b.model, 'qwen');
});

test('parseWhatIfQuery keeps JSON-encoded values and stops segments at reserved keys', () => {
  const sets = parseWhatIfQuery(
    'mode=whatif&limit=10&a=%7B%22model%22%3A%22qwen%22%2C%22contextLength%22%3A8192%7D&b=%7B%22contextLength%22%3A65536%7D');
  assert.deepEqual(sets.a, { model: 'qwen', contextLength: 8192 });
  assert.deepEqual(sets.b, { contextLength: 65536 });
});

test('parseWhatIfQuery handles b before a and returns null without sides', () => {
  const swapped = parseWhatIfQuery('a=x=1&y=2&b=z=3');
  assert.equal(swapped.a.x, '1');
  assert.equal(swapped.b.z, '3');
  assert.equal(parseWhatIfQuery('mode=whatif'), null);
  assert.equal(parseWhatIfQuery(null), null);
});

test('documented query-string what-if sets resolve differently per side (#556, e2e)', async () => {
  await withDataset(async () => {
    const r = await callDiff(getReq(
      '/api/diff?mode=whatif&a=fitCheck=true&contextLength=8192&model=qwen&b=fitCheck=true&contextLength=65536&model=qwen'));
    assert.equal(r.status, 200);
    // Both sides must carry their own keys — not collapse to fitCheck alone.
    assert.equal(r.body.a.constraints.model, 'qwen');
    assert.equal(r.body.a.constraints.contextLength, '8192');
    assert.equal(r.body.b.constraints.contextLength, '65536');
    assert.notEqual(String(r.body.a.matchedRuns), String(r.body.b.matchedRuns),
      'different contexts must match different run pools');
    assert.ok(!/no what-if deltas/.test(r.body.delta.summary));
  });
});

// ---- #557: identical ids for different constraint sets --------------------

test('best ids bind the full resolved constraint set (#557)', async () => {
  await withDataset(async () => {
    const shortCtx = await bestBody({ by: 'decode', contextLength: 8192 });
    const longCtx = await bestBody({ by: 'decode', contextLength: 65536 });
    assert.equal(shortCtx.status, 200);
    assert.notEqual(shortCtx.body.id, longCtx.body.id,
      'sets differing only in contextLength must mint distinct calc ids');
  });
});

test('what-if sides report distinct round-trippable ids (#557, e2e)', async () => {
  await withDataset(async () => {
    const r = await callDiff(getReq(
      '/api/diff?mode=whatif&a=fitCheck=true&contextLength=8192&model=qwen&b=fitCheck=true&contextLength=65536&model=qwen'));
    assert.equal(r.status, 200);
    assert.notEqual(r.body.a.id, r.body.b.id, 'side A and side B ids must differ');
    assert.match(r.body.a.id, /^calc_[0-9a-f]{12}$/);
    assert.match(r.body.b.id, /^calc_[0-9a-f]{12}$/);
    // Identical inputs still mint identical ids (replayability intact).
    const again = await bestBody({ by: 'decode', fitCheck: 'true', contextLength: '8192', model: 'qwen', limit: 50 });
    assert.equal(again.body.id, r.body.a.id);
  });
});

// ---- #558: unknown constraint keys silently dropped -----------------------

test('ignoredConstraintKeys flags unsupported keys only (#558)', () => {
  assert.deepEqual(ignoredConstraintKeys({ model: 'qwen', preset: 'nope', foo: 'bar' }), ['preset', 'foo']);
  assert.deepEqual(ignoredConstraintKeys({ model: 'qwen', contextLength: 8192 }), []);
  assert.deepEqual(ignoredConstraintKeys(null), []);
});

test('unknown constraint keys are surfaced as ignoredKeys + warnings (#558, e2e)', async () => {
  await withDataset(async () => {
    const r = await callDiff(getReq(
      '/api/diff?mode=whatif&a=preset=gptoss-20b&model=qwen&b=model=qwen&minDecode=10'));
    assert.equal(r.status, 200);
    assert.ok(Array.isArray(r.body.warnings) && r.body.warnings.length >= 1);
    assert.match(r.body.warnings.join(' '), /preset/);
    assert.deepEqual(r.body.a.ignoredKeys, ['preset']);
    assert.equal(r.body.b.ignoredKeys, undefined);
  });
});

// ---- regression: existing input dialects unchanged -------------------------

test('parseConstraintSet still accepts objects and JSON strings', () => {
  assert.deepEqual(parseConstraintSet({ model: 'qwen' }), { model: 'qwen' });
  assert.deepEqual(parseConstraintSet('{"model":"qwen"}'), { model: 'qwen' });
  assert.deepEqual(parseConstraintSet('model=qwen&limit=5'), { model: 'qwen', limit: '5' });
  assert.equal(parseConstraintSet(null), null);
});
