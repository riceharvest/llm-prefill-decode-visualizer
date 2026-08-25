import { test } from 'node:test';
import assert from 'node:assert/strict';
import handler from '../../api/_handlers/presets.js';
import { HARDWARE_PRESETS } from '../../src/utils/presets.js';

function call() {
  const res = {
    statusCode: 200,
    headers: {},
    body: undefined,
    setHeader(k, v) { this.headers[k] = v; },
    getHeader(k) { return this.headers?.[k]; },
    hasHeader(k) { return Object.hasOwn(this.headers || {}, k); },
    status(code) { this.statusCode = code; return this; },
    end(payload) { if (payload !== undefined) this.body = payload; }
  };
  handler({ method: 'GET', query: {}, headers: {} }, res);
  return JSON.parse(res.body);
}

test('/api/presets hardware entries carry machine-readable vramGb/gpuCount (#483)', () => {
  const body = call();
  const byId = Object.fromEntries(body.hardware.map(h => [h.id, h]));

  assert.equal(byId.dual_rtx3090.gpuCount, 2);
  assert.equal(byId.dual_rtx3090.vramGbTotal, 48);
  assert.equal(byId.dual_rtx3090.vramGbPerGpu, 24);
  assert.equal(byId.rtx4090_exl2.gpuCount, 1);
  assert.equal(byId.rtx4090_exl2.vramGbTotal, 24);
  // Numbers, not strings parsed out of the name.
  for (const h of body.hardware) {
    if (h.vramGbTotal !== null) assert.equal(typeof h.vramGbTotal, 'number');
    if (h.gpuCount !== null) assert.equal(typeof h.gpuCount, 'number');
  }
});

test('cloud/custom presets expose null fit fields instead of fabricated numbers (#483)', () => {
  const body = call();
  const groq = body.hardware.find(h => h.id === 'groq');
  const custom = body.hardware.find(h => h.id === 'custom');
  assert.equal(groq.vramGbTotal, null);
  assert.equal(groq.gpuCount, null);
  assert.equal(custom.vramGbTotal, null);
});

test('every preset defines the four fit-math keys (#483)', () => {
  for (const p of HARDWARE_PRESETS) {
    assert.ok(Object.hasOwn(p, 'gpuModel'), `${p.id}.gpuModel missing`);
    assert.ok(Object.hasOwn(p, 'gpuCount'), `${p.id}.gpuCount missing`);
    assert.ok(Object.hasOwn(p, 'vramGbPerGpu'), `${p.id}.vramGbPerGpu missing`);
    assert.ok(Object.hasOwn(p, 'vramGbTotal'), `${p.id}.vramGbTotal missing`);
  }
});
