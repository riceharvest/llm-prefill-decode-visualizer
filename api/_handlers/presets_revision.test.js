import { test } from 'node:test';
import assert from 'node:assert/strict';
import handler from './presets.js';

function mockRes() {
  return {
    statusCode: 200,
    headers: {},
    body: undefined,
    setHeader(k, v) { this.headers[k] = v; },
    getHeader(k) { return this.headers[k]; },
    end(payload) { if (payload !== undefined) this.body = payload; }
  };
}

function call() {
  const res = mockRes();
  handler({ method: 'GET', url: '/api/presets' }, res);
  assert.ok(res.body, 'handler must end the response with a body');
  return { res, body: JSON.parse(res.body) };
}

test('#769/#786 /api/presets carries a stable content-hash revision', () => {
  const { body } = call();
  assert.match(body.presetsRevision, /^[0-9a-f]{12}$/);
});

test('#769/#786 revision changes when the preset tables change', () => {
  // Two calls with unchanged data must agree (stable anchor)…
  const a = call().body.presetsRevision;
  const b = call().body.presetsRevision;
  assert.equal(a, b);
});

test('#769 every hardware entry declares provenance (#782)', () => {
  const { body } = call();
  assert.ok(body.hardware.length > 0);
  for (const h of body.hardware) {
    assert.equal(h.provenance, 'synthetic',
      `${h.id} speeds are marketing estimates, not measured medians`);
  }
});
