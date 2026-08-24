import { test } from 'node:test';
import assert from 'node:assert/strict';
import { requestBaseUrl, PROD_BASE } from '../_base_url.js';
import specHandler from './spec.js';
import capabilitiesHandler from './capabilities.js';

function mockRes() {
  return {
    statusCode: 200,
    headers: {},
    body: undefined,
    setHeader(k, v) { this.headers[k] = v; },
    getHeader(k) { return this.headers[String(k).toLowerCase()]; },
    end(payload) { if (payload !== undefined) this.body = payload; }
  };
}

test('derives base from x-forwarded-host/proto (first hop)', () => {
  const url = requestBaseUrl({
    headers: {
      'x-forwarded-host': 'preview-abc.vercel.app, llm-prefill-decode-visualizer.vercel.app',
      'x-forwarded-proto': 'https, http',
      host: 'internal:3000'
    }
  });
  assert.equal(url, 'https://preview-abc.vercel.app');
});

test('falls back to plain Host header with http when no proxy headers', () => {
  const url = requestBaseUrl({ headers: { host: 'my-llmviz.internal' } });
  assert.equal(url, 'http://my-llmviz.internal');
});

test('headerless requests fall back to the production host', () => {
  assert.equal(requestBaseUrl({ headers: {} }), PROD_BASE);
});

test('VISUALIZER_API_URL overrides everything and strips trailing slashes', () => {
  const prev = process.env.VISUALIZER_API_URL;
  process.env.VISUALIZER_API_URL = 'https://pinned.example.com/';
  try {
    assert.equal(requestBaseUrl({ headers: { host: 'other.example.com' } }), 'https://pinned.example.com');
  } finally {
    if (prev === undefined) delete process.env.VISUALIZER_API_URL; else process.env.VISUALIZER_API_URL = prev;
  }
});

function callSpec(headers) {
  const res = mockRes();
  specHandler({ method: 'GET', url: '/api/spec', query: {}, headers }, res);
  return JSON.parse(res.body);
}

test('/api/spec servers[] reflect the serving host (#928)', () => {
  const body = callSpec({ host: 'preview-pr-42.vercel.app', 'x-forwarded-proto': 'https' });
  const urls = body.servers.map(s => s.url);
  assert.deepEqual(urls, ['https://preview-pr-42.vercel.app', 'https://preview-pr-42.vercel.app/v1']);
});

function callCapabilities(headers) {
  const res = mockRes();
  capabilitiesHandler({ method: 'GET', url: '/api/agent/capabilities.json', headers }, res);
  return JSON.parse(res.body);
}

test('capabilities base_url reflects the serving host (#833)', () => {
  const body = callCapabilities({ host: 'selfhosted.lan:8080' });
  assert.equal(body.base_url, 'http://selfhosted.lan:8080');
});
