// Wire-vs-schema drift guard (#319 follow-up).
//
// components.schemas claims to mirror the shapes the endpoints actually emit.
// This test generates REAL wire responses offline (upstream fetch stubbed with
// synthetic rows) and fails if any endpoint emits a field its schema doesn't
// declare, or a Caveat severity outside the documented enum. Additive wire
// fields without a matching schema property = generated clients silently miss
// them — that's the drift this guards against.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const { default: handler } = await import(path.join(here, '..', '[...path].js'));
const lm = await import(path.join(here, '..', '_localmaxxing.js'));

// Synthetic upstream rows shaped like localmaxxing.com/leaderboard entries,
// covering discrete/multi-GPU/cpu_only rigs, mixed engines + context bands.
function upRow(id, over = {}) {
  return {
    id,
    createdAt: '2026-08-01T12:00:00.000Z',
    model: { hfId: 'unsloth/Qwen3.6-27B-MTP-GGUF', displayName: 'Qwen3.6 27B', params: 27 },
    hardwareGroupKey: 'rtx4090',
    hardwareGroupLabel: 'RTX 4090 24GB',
    hardware: { hwClass: 'discrete_gpu', gpuName: 'RTX 4090', gpuCount: 1, vramGb: 24 },
    engine: { engineName: id % 2 ? 'llama.cpp' : 'vLLM', engineVersion: 'b6123', quantization: 'q4_k_m' },
    tokSPrefill: 3800 + (id % 7) * 50,
    tokSOut: 100 + (id % 11) * 3,
    promptTokens: 2048,
    outputTokens: 512,
    contextLength: id % 3 ? 8192 : 131072,
    batchSize: 1,
    ...over
  };
}

const ROWS = [
  ...Array.from({ length: 10 }, (_, i) => upRow(100 + i)),
  upRow(300, {
    hardwareGroupKey: 'cpu', hardwareGroupLabel: null,
    hardware: { hwClass: 'cpu_only', gpuName: null, vramGb: null, cpu: 'Ryzen 9950X' },
    engine: { engineName: 'llama.cpp', engineVersion: null, quantization: null }
  })
];

// Stub ONLY the upstream leaderboard fetch before any handler runs.
const realFetch = globalThis.fetch;
globalThis.fetch = async (url) => {
  const u = String(url);
  assert.ok(u.includes('localmaxxing.com'), `unexpected fetch target: ${u}`);
  const offset = Number(new URL(u).searchParams.get('offset') || 0);
  return { ok: true, status: 200, json: async () => ({ rows: ROWS.slice(offset, offset + 200) }) };
};

async function call(url) {
  const chunks = [];
  const res = {
    statusCode: 200,
    setHeader() {}, getHeader() { return undefined; }, hasHeader() { return false; }, removeHeader() {},
    end(b) { chunks.push(String(b)); }
  };
  const u = new URL(url, 'https://unit.test');
  await handler({ method: 'GET', url, query: Object.fromEntries(u.searchParams.entries()) }, res);
  assert.equal(res.statusCode, 200, `${url} -> ${res.statusCode}`);
  return JSON.parse(chunks.join(''));
}

/** Every object key on the wire at any depth (for reporting). */
function deepKeys(value, out = new Set(), prefix = '') {
  if (Array.isArray(value)) {
    for (const item of value.slice(0, 5)) deepKeys(item, out, prefix);
  } else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      out.add(prefix + k);
      deepKeys(v, out, `${prefix}${k}.`);
    }
  }
  return out;
}

const spec = await call('/api/spec');
const schemas = spec.components.schemas;
lm.invalidateCache();

test('wire drift: every emitted BenchmarkGroupListEnvelope field is declared in the schema', async () => {
  const body = await call('/api/benchmarks?limit=10');
  const declared = new Set(Object.keys(schemas.BenchmarkGroupListEnvelope.properties));
  const undeclared = [...deepKeys(body)].filter(k => !k.includes('.') && k !== 'schema_version' && !declared.has(k));
  assert.deepEqual(undeclared, [], `envelope fields on the wire but missing from BenchmarkGroupListEnvelope`);
});

test('wire drift: every emitted BenchmarkGroup field is declared in the schema', async () => {
  const body = await call('/api/benchmarks?limit=10');
  assert.ok(body.items.length > 0);
  const declared = new Set(Object.keys(schemas.BenchmarkGroup.properties));
  const undeclared = [...deepKeys(body.items[0])].filter(k => !k.includes('.') && !declared.has(k));
  assert.deepEqual(undeclared, [], `group fields on the wire but missing from BenchmarkGroup`);
});

test('wire drift: every emitted BestListEnvelope + BestResult field is declared in the schema', async () => {
  const body = await call('/api/best?by=decode&limit=5');
  const envDeclared = new Set(Object.keys(schemas.BestListEnvelope.properties));
  const envUndeclared = [...deepKeys(body)].filter(k => !k.includes('.') && k !== 'schema_version' && !envDeclared.has(k));
  assert.deepEqual(envUndeclared, [], `envelope fields on the wire but missing from BestListEnvelope`);

  assert.ok(body.results.length > 0);
  const resDeclared = new Set(Object.keys(schemas.BestResult.properties));
  const resUndeclared = [...deepKeys(body.results[0])].filter(k => !k.includes('.') && !resDeclared.has(k));
  assert.deepEqual(resUndeclared, [], `result fields on the wire but missing from BestResult`);
});

test('wire drift: every emitted RunListEnvelope / Run field is declared in the schema', async () => {
  const body = await call('/api/localmaxxing?model=qwen&limit=5');
  const envDeclared = new Set(Object.keys(schemas.RunListEnvelope.properties));
  const envUndeclared = [...deepKeys(body)].filter(k => !k.includes('.') && k !== 'schema_version' && !envDeclared.has(k));
  assert.deepEqual(envUndeclared, [], `envelope fields on the wire but missing from RunListEnvelope`);

  assert.ok(body.items.length > 0);
  const runDeclared = new Set(Object.keys(schemas.Run.properties));
  const runUndeclared = [...deepKeys(body.items[0])].filter(k => !k.includes('.') && !runDeclared.has(k));
  assert.deepEqual(runUndeclared, [], `run fields on the wire but missing from Run`);
});

test('wire drift: no caveat severity value falls outside the documented enum', async () => {
  const severities = new Set();
  const collect = (node) => {
    if (Array.isArray(node)) node.forEach(collect);
    else if (node && typeof node === 'object') {
      for (const [k, v] of Object.entries(node)) {
        if (k === 'severity') severities.add(v);
        else collect(v);
      }
    }
  };
  collect(await call('/api/benchmarks?limit=10'));
  collect(await call('/api/best?by=decode&limit=5'));
  collect(await call('/api/localmaxxing?hardware=rtx&limit=5'));
  const allowed = schemas.Caveat.properties.severity.enum;
  const bad = [...severities].filter(s => !allowed.includes(s));
  assert.deepEqual(bad, [], `severity values on the wire but not in Caveat enum: ${bad.join(', ')}`);
});
