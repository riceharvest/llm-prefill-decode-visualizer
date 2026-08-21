import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

// Mock the upstream leaderboard BEFORE importing the handler so
// getAllRuns() never touches the network during tests.
const ROWS = [
  // RigA: fastest decode, slow prefill — wins raw decode rankings.
  {
    id: 'a1', batchSize: 1,
    tokSPrefill: 2000, tokSOut: 100,
    model: { hfId: 'meta-llama/Llama-3.1-8B-Instruct', displayName: 'Llama 3.1 8B', params: 8 },
    hardwareGroupKey: 'riga', hardwareGroupLabel: 'Rig A',
    hardware: { hwClass: 'discrete_gpu', gpuName: 'TestGPU A', gpuCount: 1, vramGb: 24 },
    engine: { engineName: 'llama.cpp', quantization: 'q4_k_m' }
  },
  // RigB: ~15% slower decode but 2x faster prefill — wins walltime for
  // prompt-heavy workloads (the exact trade-off issue #6 is about).
  {
    id: 'b1', batchSize: 1,
    tokSPrefill: 4000, tokSOut: 85,
    model: { hfId: 'meta-llama/Llama-3.1-8B-Instruct', displayName: 'Llama 3.1 8B', params: 8 },
    hardwareGroupKey: 'rigb', hardwareGroupLabel: 'Rig B',
    hardware: { hwClass: 'discrete_gpu', gpuName: 'TestGPU B', gpuCount: 2, vramGb: 48 },
    engine: { engineName: 'llama.cpp', quantization: 'q4_k_m' }
  }
];

let realFetch;
beforeEach(() => {
  realFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ rows: ROWS }) });
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

const { default: handler, resolveWorkload, projectWalltime } = await import('./best.js');

function mockRes() {
  const res = {
    statusCode: 200,
    headers: {},
    body: undefined,
    setHeader(k, v) { this.headers[k] = v; },
    getHeader(k) { return this.headers[k]; },
    status(code) { this.statusCode = code; return this; },
    end(payload) { if (payload !== undefined) this.body = payload; }
  };
  return res;
}

async function call(query = {}) {
  const req = { method: 'GET', query };
  const res = mockRes();
  await handler(req, res);
  assert.ok(res.body, 'handler should write a JSON body');
  return { status: res.statusCode, json: JSON.parse(res.body) };
}

test('by=decode still ranks by median decode speed (back-compat)', async () => {
  const { status, json } = await call({ by: 'decode' });
  assert.equal(status, 200);
  assert.equal(json.rankedBy, 'decode');
  assert.equal(json.results[0].hardwareKey, 'riga'); // 100 > 85 tok/s decode
});

test('default ranking (no by param) is still decode', async () => {
  const { json } = await call({});
  assert.equal(json.rankedBy, 'decode');
  assert.equal(json.results[0].hardwareKey, 'riga');
});

test('by=prefill still works', async () => {
  const { json } = await call({ by: 'prefill' });
  assert.equal(json.rankedBy, 'prefill');
  assert.equal(json.results[0].hardwareKey, 'rigb'); // 4000 > 2000 tok/s prefill
});

test('by=walltime ranks by projected end-to-end walltime, not raw speed', async () => {
  // RAG-shaped workload: big prompt, small output → fast-prefill rig wins.
  const { status, json } = await call({
    by: 'walltime', scenario: 'rag' // 4096 in / 512 out
  });
  assert.equal(status, 200);
  assert.equal(json.rankedBy, 'walltime');
  assert.equal(json.workload.promptTokens, 4096);
  assert.equal(json.workload.outputTokens, 512);
  assert.equal(json.workload.source, 'scenario:rag');

  const [first, second] = json.results;
  assert.equal(first.hardwareKey, 'rigb', 'fast-prefill rig should win RAG walltime');
  // Ascending walltime order, and projections must be internally consistent:
  // ttft + decode ≈ total.
  assert.ok(first.projectedWalltimeSeconds < second.projectedWalltimeSeconds);
  assert.ok(
    Math.abs((first.ttftSeconds + first.decodeSeconds) - first.projectedWalltimeSeconds) < 1e-4
  );
});

test('explicit promptTokens/outputTokens override scenario and defaults', async () => {
  const explicit = await call({ by: 'walltime', promptTokens: '8192', outputTokens: '128' });
  assert.equal(explicit.json.workload.source, 'query');
  assert.equal(explicit.json.workload.promptTokens, 8192);
  assert.equal(explicit.json.workload.outputTokens, 128);

  // Same numbers through the handler must match singleTurn math directly.
  const direct = projectWalltime(4000, 85, { promptTokens: 8192, outputTokens: 128 });
  assert.equal(
    explicit.json.results.find(r => r.hardwareKey === 'rigb').projectedWalltimeSeconds,
    direct.totalWalltimeSeconds
  );
});

test('unknown scenario or invalid tokens fall back to chat defaults', () => {
  assert.deepEqual(
    { p: resolveWorkload({ scenario: 'nope' }).promptTokens, o: resolveWorkload({ scenario: 'nope' }).outputTokens },
    { p: 2048, o: 512 }
  );
  const bad = resolveWorkload({ promptTokens: '-5', outputTokens: 'abc' });
  assert.equal(bad.promptTokens, 2048);
  assert.equal(bad.outputTokens, 512);

  const known = resolveWorkload({ scenario: 'codegen' });
  assert.equal(known.promptTokens, 2048);
  assert.equal(known.outputTokens, 4096); // codegen = long outputs
});

test('decode-heavy workload flips the winner back to the decode king', async () => {
  // Long outputs make decode dominate: riga (100 tok/s) should beat rigb.
  const { json } = await call({ by: 'walltime', scenario: 'codegen' }); // 2048 in / 4096 out
  assert.equal(json.results[0].hardwareKey, 'riga');
});

test('walltime results carry share-of-time breakdown', async () => {
  const { json } = await call({ by: 'walltime', scenario: 'longdoc' });
  const r = json.results[0];
  assert.ok(r.prefillSharePct > 0 && r.decodeSharePct > 0);
  assert.ok(Math.abs(r.prefillSharePct + r.decodeSharePct - 100) < 0.01);
  assert.ok(r.effectiveThroughputTokPerSec > 0);
});

test('every result carries a one-sentence explain string (#73)', async () => {
  const { json } = await call({ by: 'decode', contextLength: '32768' });
  for (const r of json.results) {
    assert.equal(typeof r.explain, 'string', `explain missing on ${r.hardwareKey}`);
    assert.match(r.explain, /tok\/s decode from run #/);
    assert.ok(!r.explain.includes('\n'), 'explanation must stay one line');
  }
  // Fit math + measured source in the same sentence (riga: 24GB card).
  const first = json.results[0];
  assert.match(first.explain, /24GB fits /);
  assert.match(first.explain, /weights ~\d+GB \+ 32k KV ~\d+GB with \d+GB headroom/);
});

test('explain reflects fitCheck context and verdict (#73)', async () => {
  const { json } = await call({ by: 'decode', fitCheck: 'true', contextLength: '131072' });
  for (const r of json.results) {
    assert.equal(typeof r.explain, 'string');
    assert.match(r.explain, /128k KV/); // context echoed in the sentence
  }
});

test('by=cost results also carry explain (#73)', async () => {
  const { status, json } = await call({ by: 'cost', price: '700' });
  assert.equal(status, 200);
  for (const r of json.results) assert.equal(typeof r.explain, 'string');
});
