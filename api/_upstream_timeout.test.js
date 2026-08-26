// Outbound-fetch timeout contract (#901).
//
// Every server-side outbound fetch runs under a hard AbortSignal deadline and
// maps a missed deadline onto the machine-readable UPSTREAM_TIMEOUT problem
// code (504) instead of hanging until the invisible platform ceiling.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  UPSTREAM_TIMEOUTS,
  fetchWithTimeout,
  isAbortTimeout
} from './_upstream_timeout.js';
import { ApiError, ERROR_CODES } from './_errors.js';
import specHandler from './_handlers/spec.js';

function mockRes() {
  return {
    statusCode: 200,
    headers: {},
    body: undefined,
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
    getHeader(k) { return this.headers[k.toLowerCase()]; },
    end(payload) { if (payload !== undefined) this.body = payload; }
  };
}

test('UPSTREAM_TIMEOUT is a registered 504 error code mirrored into /api/spec', () => {
  assert.equal(ERROR_CODES.UPSTREAM_TIMEOUT.status, 504);
  const res = mockRes();
  specHandler({ method: 'GET', query: {}, headers: {}, url: '/api/spec' }, res);
  const spec = JSON.parse(res.body);
  const entry = spec['x-error-codes'].find(c => c.code === 'UPSTREAM_TIMEOUT');
  assert.ok(entry, 'spec x-error-codes must include UPSTREAM_TIMEOUT');
  assert.equal(entry.httpStatus, 504);
});

test('fetchWithTimeout passes url/options through and arms an AbortSignal', async () => {
  let seen;
  const fakeFetch = async (url, opts) => {
    seen = { url, opts };
    return { ok: true, status: 200 };
  };
  const original = globalThis.fetch;
  globalThis.fetch = fakeFetch;
  try {
    await fetchWithTimeout('https://upstream.test/y', { headers: { accept: 'text/plain' } }, 1234);
  } finally {
    globalThis.fetch = original;
  }
  assert.equal(seen.url, 'https://upstream.test/y');
  assert.deepEqual(seen.opts.headers, { accept: 'text/plain' });
  assert.ok(seen.opts.signal instanceof AbortSignal, 'options must carry an AbortSignal');
});

test('a stalled upstream throws ApiError UPSTREAM_TIMEOUT (504) with problem body', async () => {
  const original = globalThis.fetch;
  // A fetch that never settles but honors its abort signal, like real undici.
  globalThis.fetch = (url, opts = {}) => new Promise((resolve, reject) => {
    if (opts.signal) opts.signal.addEventListener('abort', () => reject(opts.signal.reason));
  });
  try {
    // AbortSignal.timeout()'s timer is unref'd — hold the loop open while we wait.
    const keepAlive = setTimeout(() => {}, 1000);
    await assert.rejects(
      fetchWithTimeout('https://upstream.test/hang', {}, 25),
      (err) => {
        assert.ok(err instanceof ApiError);
        assert.equal(err.code, 'UPSTREAM_TIMEOUT');
        assert.equal(err.status, 504);
        const problem = err.toProblem('/api/vram?hfId=x');
        assert.equal(problem.status, 504);
        assert.equal(problem.code, 'UPSTREAM_TIMEOUT');
        assert.equal(problem.upstreamTimeoutMs, 25);
        return true;
      }
    );
    clearTimeout(keepAlive);
  } finally {
    globalThis.fetch = original;
  }
});

test('non-timeout network errors propagate unchanged', async () => {
  const original = globalThis.fetch;
  const boom = new Error('ECONNREFUSED');
  globalThis.fetch = () => Promise.reject(boom);
  try {
    await assert.rejects(fetchWithTimeout('https://upstream.test/refused', {}, 1000), (err) => err === boom);
  } finally {
    globalThis.fetch = original;
  }
});

test('isAbortTimeout recognizes both TimeoutError and AbortError names only', () => {
  assert.ok(isAbortTimeout(Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' })));
  assert.ok(isAbortTimeout(Object.assign(new Error('This operation was aborted'), { name: 'AbortError' })));
  assert.equal(isAbortTimeout(new Error('ECONNRESET')), false);
  assert.equal(isAbortTimeout(null), false);
});

test('per-upstream budgets are declared for every unprotected outbound site', () => {
  for (const key of ['hfConfig', 'ggufChunk', 'leaderboardPage', 'mcpSelfFetch']) {
    assert.ok(Number.isFinite(UPSTREAM_TIMEOUTS[key]) && UPSTREAM_TIMEOUTS[key] > 0, `${key} budget missing`);
  }
});
