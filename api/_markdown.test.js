import { test } from 'node:test';
import assert from 'node:assert/strict';
import { wantsMarkdown, jsonToMarkdown, withMarkdownNegotiation } from './_markdown.js';

const fakeReq = accept => ({ headers: { accept } });

const fakeRes = () => {
  const headers = {};
  const res = {
    headers,
    statusCode: 200,
    setHeader(k, v) { headers[k] = v; },
    getHeader(k) { return headers[k]; }
  };
  res.end = function end(chunk) { this.body = chunk; };
  return res;
};

test('wantsMarkdown detects text/markdown in Accept', () => {
  assert.equal(wantsMarkdown(fakeReq('text/markdown')), true);
  assert.equal(wantsMarkdown(fakeReq('application/json')), false);
  assert.equal(wantsMarkdown(fakeReq('*/*')), false);
  assert.equal(wantsMarkdown(fakeReq(undefined)), false);
});

// #604: AGENT-QUICKSTART advertises ?format=md — it must negotiate like the
// Accept header instead of being silently ignored.
test('#604: wantsMarkdown honors ?format=md and ?format=markdown', () => {
  const reqWith = (url, accept) => ({ url, headers: { accept } });
  assert.equal(wantsMarkdown(reqWith('/api/best?by=cost&format=md', 'application/json')), true);
  assert.equal(wantsMarkdown(reqWith('/api/best?format=markdown', '')), true);
  assert.equal(wantsMarkdown(reqWith('/api/best?format=MD', '')), true);
  // format=json / junk values never trigger markdown…
  assert.equal(wantsMarkdown(reqWith('/api/best?format=json', 'application/json')), false);
  assert.equal(wantsMarkdown(reqWith('/api/best?format=csv', '*/*')), false);
  // …and neither does an unrelated query param.
  assert.equal(wantsMarkdown(reqWith('/api/best?by=efficiency', '*/*')), false);
  // Accept header still wins even alongside ?format=json.
  assert.equal(wantsMarkdown(reqWith('/api/best?format=json', 'text/markdown')), true);
});

test('jsonToMarkdown renders scalars as key: value list', () => {
  const md = jsonToMarkdown({ ok: true, ttftSeconds: 1.08 }, { title: 'GET compute' });
  assert.match(md, /## GET compute/);
  assert.match(md, /\*\*ok:\*\* true/);
  assert.match(md, /\*\*ttftSeconds:\*\* 1\.08/);
});

test('jsonToMarkdown renders uniform object arrays as tables', () => {
  const md = jsonToMarkdown({
    results: [
      { name: 'rtx4090', decode: 138 },
      { name: 'a100', decode: 210 }
    ]
  });
  assert.match(md, /\| name \| decode \|/);
  assert.match(md, /\| --- \| --- \|/);
  assert.match(md, /\| rtx4090 \| 138 \|/);
});

test('jsonToMarkdown handles nested objects and empty arrays', () => {
  const md = jsonToMarkdown({ meta: { version: '2' }, rows: [], nested: { a: { b: 1 } } });
  assert.match(md, /### meta/);
  assert.match(md, /_\(empty\)_|_\(empty array\)_/);
  assert.match(md, /\*\*b:\*\* 1/);
});

test('withMarkdownNegotiation sets Vary always and converts JSON when asked', () => {
  // JSON request → Vary set, body untouched
  let res = fakeRes();
  withMarkdownNegotiation(fakeReq('application/json'), res);
  res.end('{"a":1}');
  assert.equal(res.headers['Vary'], 'Accept, Accept-Encoding');
  assert.equal(res.body, '{"a":1}');
  assert.equal(res.headers['Content-Type'], undefined);

  // Markdown request → converted
  res = fakeRes();
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  withMarkdownNegotiation(fakeReq('text/markdown'), res);
  res.end(JSON.stringify({ ok: true }));
  assert.equal(res.headers['Vary'], 'Accept, Accept-Encoding');
  assert.equal(res.headers['Content-Type'], 'text/markdown; charset=utf-8');
  assert.match(res.body, /\*\*ok:\*\* true/);

  // Markdown request but non-JSON chunk (e.g. PNG) → untouched
  res = fakeRes();
  withMarkdownNegotiation(fakeReq('text/markdown'), res);
  res.end(Buffer.from([0x89, 0x50]));
  assert.notEqual(res.headers['Content-Type'], 'text/markdown; charset=utf-8');
});
