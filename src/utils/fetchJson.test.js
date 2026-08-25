// Tests for the shared client fetch helper (#723): timeout policy and
// non-JSON response guarding. Uses a stubbed global fetch.
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { fetchJsonWithTimeout, FetchJsonError } from './fetchJson.js';

function jsonResponse(body, { status = 200, contentType = 'application/json' } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (k) => (k.toLowerCase() === 'content-type' ? contentType : null) },
    json: async () => body
  };
}

function stubFetch(impl) {
  const original = globalThis.fetch;
  globalThis.fetch = impl;
  return () => { globalThis.fetch = original; };
}

test('returns parsed JSON for a normal ok response', async () => {
  const restore = stubFetch(async () => jsonResponse({ hello: 'world' }));
  try {
    assert.deepEqual(await fetchJsonWithTimeout('/api/x'), { hello: 'world' });
  } finally { restore(); }
});

test('non-JSON response (WAF challenge HTML) throws typed bad_response, never SyntaxError prose', async () => {
  const restore = stubFetch(async () => jsonResponse('<!DOCTYPE html>', { status: 403, contentType: 'text/html' }));
  try {
    await assert.rejects(
      fetchJsonWithTimeout('/api/diff'),
      (e) => e instanceof FetchJsonError && e.kind === 'bad_response' && e.status === 403 &&
        !/Unexpected token/.test(e.message)
    );
  } finally { restore(); }
});

test('stalled request aborts via the timer and throws kind timeout', async () => {
  const restore = stubFetch((_path, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
  }));
  const t = mock.timers;
  t.enable({ apis: ['setTimeout'] });
  try {
    const p = fetchJsonWithTimeout('/api/slow', { timeoutMs: 5000 });
    t.tick(5000);
    await assert.rejects(p, (e) => e instanceof FetchJsonError && e.kind === 'timeout');
  } finally {
    t.reset();
    restore();
  }
});

test('HTTP error carries problem+json code detail and status as kind http', async () => {
  const restore = stubFetch(async () => jsonResponse(
    { type: 'https://example.com/problems/not-found', title: 'Not found', status: 404, code: 'NOT_FOUND', detail: 'no such run' },
    { status: 404 }
  ));
  try {
    await assert.rejects(
      fetchJsonWithTimeout('/api/nope'),
      (e) => e instanceof FetchJsonError && e.kind === 'http' && e.status === 404 && e.message.includes('no such run')
    );
  } finally { restore(); }
});
