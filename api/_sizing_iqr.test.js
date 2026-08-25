// Regression tests for issue #763: /api/sizing expected.ttftIqr / tpotIqrMs
// must be ascending [p25, p75] time bounds (conventional IQR order), matching
// the spec x-example — not the descending arrays produced when raw speed
// quartiles [q1, q3] are inverted into times without reordering.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import handler from './_handlers/sizing.js';

// One page of upstream-shaped rows (< PAGE=200 stops the crawl after page 0).
// Prefill speeds [800..1300], decode speeds [40..65]: quartiles via the
// lower/upper-halves rule on 6 sorted values → prefill q1=900, q3=1200;
// decode q1=45, q3=60.
const ROWS = [
  { tokSPrefill: 800, tokSOut: 40 }, { tokSPrefill: 1300, tokSOut: 65 },
  { tokSPrefill: 900, tokSOut: 45 }, { tokSPrefill: 1200, tokSOut: 60 },
  { tokSPrefill: 1000, tokSOut: 50 }, { tokSPrefill: 1100, tokSOut: 55 }
].map((speeds, i) => ({
  id: `run_${i}`,
  createdAt: '2026-08-01T00:00:00Z',
  batchSize: 1,
  tokSPrefill: speeds.tokSPrefill,
  tokSOut: speeds.tokSOut,
  promptTokens: 2048,
  outputTokens: 512,
  contextLength: 8192,
  model: { hfId: 'org/MiniTest-9B', displayName: 'MiniTest 9B', params: 9e9 },
  hardwareGroupKey: 'rtx4090',
  hardwareGroupLabel: 'RTX 4090',
  hardware: { hwClass: 'discrete_gpu', gpuName: 'RTX 4090', gpuCount: 1, vramGb: 24 },
  engine: { engineName: 'llama.cpp', quantization: 'q4_k_m' }
}));

globalThis.fetch = async (url) => {
  if (String(url).includes('/leaderboard')) {
    return { ok: true, status: 200, json: async () => ({ rows: ROWS }) };
  }
  return { ok: false, status: 500, json: async () => ({}) };
};

function call(query = {}) {
  const req = { method: 'GET', query };
  const res = {
    statusCode: 200, headers: {}, bodyText: undefined,
    setHeader(k, v) { this.headers[k] = v; },
    getHeader(k) { return this.headers[k]; },
    status(c) { this.statusCode = c; return this; },
    end(p) { if (p !== undefined) this.bodyText = p; }
  };
  return handler(req, res).then(() => ({ status: res.statusCode, json: JSON.parse(res.bodyText) }));
}

test('#763 expected.ttftIqr / tpotIqrMs are ascending [p25, p75]', async () => {
  const { status, json } = await call({ model: 'MiniTest', promptTokens: '2048', concurrency: '1' });
  assert.equal(status, 200);
  assert.ok(json.recommendations.length >= 1);
  const rec = json.recommendations[0];

  // ttft = promptTokens / prefillSpeed: q3-speed (fast) → lo bound, q1 → hi.
  assert.deepEqual(rec.expected.ttftIqr, [
    Math.round((2048 / 1200) * 1e4) / 1e4,   // 1.7067
    Math.round((2048 / 900) * 1e4) / 1e4     // 2.2756
  ]);
  // tpot = 1000 / decodeSpeed at b=1: q3 → lo, q1 → hi.
  assert.deepEqual(rec.expected.tpotIqrMs, [
    Math.round((1000 / 60) * 100) / 100,     // 16.67
    Math.round((1000 / 45) * 100) / 100      // 22.22
  ]);
});

test('#763 IQR bounds always satisfy lo <= hi', async () => {
  const { status, json } = await call({ model: 'MiniTest', promptTokens: '2048', concurrency: '4' });
  assert.equal(status, 200);
  for (const rec of json.recommendations) {
    const [ttftLo, ttftHi] = rec.expected.ttftIqr;
    const [tpotLo, tpotHi] = rec.expected.tpotIqrMs;
    assert.ok(ttftLo != null && ttftHi != null && ttftLo <= ttftHi, 'ttftIqr ascending');
    assert.ok(tpotLo != null && tpotHi != null && tpotLo <= tpotHi, 'tpotIqrMs ascending');
  }
});
