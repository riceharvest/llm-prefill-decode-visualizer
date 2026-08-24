import { test } from 'node:test';
import assert from 'node:assert/strict';
import handler from './sizing.js';

// #731 regression: present-but-invalid SLO caps must fail closed with 400,
// not silently weaken the ranking to unconstrained. The validation runs
// before dataset access, so these cases need no network/data.

function call(query) {
  let body;
  const res = {
    statusCode: 200,
    headers: {},
    setHeader(k, v) { this.headers[k] = v; },
    end(payload) { body = payload; }
  };
  handler({ method: 'GET', query }, res);
  assert.ok(body !== undefined || res.statusCode >= 400, 'handler must end the response');
  return { status: res.statusCode, body: body ? JSON.parse(body) : null };
}

test('#731: maxTtftSeconds=0 is rejected with 400 instead of dropping the cap', () => {
  const { status, body } = call({ model: 'qwen', maxTtftSeconds: '0' });
  assert.equal(status, 400);
  assert.match(body.error, /maxTtftSeconds/);
  assert.equal(body.param, 'maxTtftSeconds');
});

test('#731: negative maxTpotMs is rejected with 400', () => {
  const { status, body } = call({ model: 'qwen', maxTpotMs: '-5' });
  assert.equal(status, 400);
  assert.equal(body.param, 'maxTpotMs');
});

test('#731: non-numeric SLO garbage is rejected instead of ignored', () => {
  const { status, body } = call({ model: 'qwen', maxTtftSeconds: 'soon-ish' });
  assert.equal(status, 400);
  assert.match(body.error, /positive numbers/);
});

test('#731: absent SLO caps are still treated as unconstrained (no new 400)', () => {
  // Missing model still produces the pre-existing model error, proving the
  // request passed the (new) SLO validation untouched.
  const { status, body } = call({});
  assert.equal(status, 400);
  assert.match(body.error, /Missing required 'model'/);
});
