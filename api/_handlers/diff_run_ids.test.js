import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import handler from './diff.js';
import { invalidateCache } from '../_localmaxxing.js';

// Issue #395: run-id lookup must tolerate case-normalized ids and report
// BOTH unknown ids in one response instead of failing sequentially.

const RUNS = [
  {
    id: 'cmsxs31hf0chsms0121zih53z',
    createdAt: '2026-08-01T00:00:00.000Z',
    batchSize: 1,
    engineFlags: { concurrency: 1 },
    tokSPrefill: 18000,
    tokSOut: 105,
    promptTokens: 2048,
    outputTokens: 512,
    contextLength: 8192,
    model: { hfId: 'org/model-a', displayName: 'Model A', params: 8 },
    hardwareGroupKey: 'rtx-4090',
    hardwareGroupLabel: 'RTX 4090',
    hardware: { hwClass: 'discrete_gpu', gpuName: 'RTX 4090', gpuCount: 1 },
    engine: { engineName: 'llama.cpp', engineVersion: 'b1' }
  },
  {
    id: 'cmotherid0chsms0000000000',
    createdAt: '2026-08-02T00:00:00.000Z',
    batchSize: 1,
    engineFlags: { concurrency: 1 },
    tokSPrefill: 3800,
    tokSOut: 60,
    promptTokens: 2048,
    outputTokens: 512,
    contextLength: 8192,
    model: { hfId: 'org/model-b', displayName: 'Model B', params: 70 },
    hardwareGroupKey: 'groq',
    hardwareGroupLabel: 'Groq',
    hardware: { hwClass: 'discrete_gpu', gpuName: 'Groq LPU', gpuCount: 1 },
    engine: { engineName: 'vLLM' }
  }
];

let realFetch;

beforeEach(() => {
  realFetch = globalThis.fetch;
  invalidateCache();
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({ rows: RUNS.map(r => ({ ...r })) })
  });
});

function mockReq(query) {
  return { url: '/api/diff', method: 'GET', query, headers: {}, socket: { remoteAddress: '10.0.0.1' } };
}

function mockRes() {
  const chunks = [];
  return {
    statusCode: null,
    bodyText: '',
    status(c) { this.statusCode = c; return this; },
    setHeader() {},
    getHeader() { return undefined; },
    write(c) { chunks.push(String(c)); },
    end(c) { if (c != null) chunks.push(String(c)); this.bodyText = chunks.join(''); }
  };
}

test('uppercase-cased valid ids still resolve (case-insensitive fallback)', async () => {
  try {
    const res = mockRes();
    await handler(mockReq({ runA: 'CMSXS31HF0CHSMS0121ZIH53Z', runB: 'cmotherid0chsms0000000000' }), res);
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.bodyText);
    assert.equal(body.runA.runId, 'cmsxs31hf0chsms0121zih53z');
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('a single unknown id keeps the original singular error message', async () => {
  try {
    const res = mockRes();
    await handler(mockReq({ runA: 'nope-a', runB: 'cmotherid0chsms0000000000' }), res);
    assert.equal(res.statusCode, 404);
    const body = JSON.parse(res.bodyText);
    assert.equal(body.error, 'run nope-a not found');
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('two unknown ids are reported together in one round-trip (#395)', async () => {
  try {
    const res = mockRes();
    await handler(mockReq({ runA: 'nope-a', runB: 'NOPE-B' }), res);
    assert.equal(res.statusCode, 404);
    const body = JSON.parse(res.bodyText);
    assert.match(body.error, /runs nope-a and NOPE-B not found/);
    assert.equal(body.hint, 'browse ids via /api/localmaxxing');
  } finally {
    globalThis.fetch = realFetch;
  }
});
