// Regression tests for conditional-request support on cacheable generated
// bodies (#615) and the corrected caching documentation (#616).
//
// Contract pinned here:
//   1. GET /api/spec + /api/presets ship a strong ETag + Last-Modified.
//   2. If-None-Match with the current ETag (incl. W/ weak form, list form)
//      answers 304 with no body; an unknown ETag answers 200 full.
//   3. If-Modified-Since at/after instance boot answers 304; before it, 200.
//   4. 304 responses keep Cache-Control / ETag / X-Schema-Version headers.
//   5. llms.txt no longer claims "10 min on data endpoints" for everything
//      and documents the validators (#616).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = pathDir();
function pathDir() {
  return dirname(fileURLToPath(import.meta.url));
}

const { default: handler } = await import(join(here, '[...path].js'));

function call(url, headers = {}) {
  const chunks = [];
  const resHeaders = {};
  const res = {
    statusCode: 200,
    setHeader(k, v) { resHeaders[String(k).toLowerCase()] = v; },
    getHeader(k) { return resHeaders[String(k).toLowerCase()]; },
    hasHeader(k) { return String(k).toLowerCase() in resHeaders; },
    end(body) { if (body !== undefined) chunks.push(String(body)); }
  };
  handler({ method: 'GET', url, query: {}, headers }, res);
  return {
    status: res.statusCode,
    headers: resHeaders,
    body: chunks.join('')
  };
}

for (const url of ['/api/spec', '/api/presets']) {
  test(`${url}: stamps strong ETag + Last-Modified + Cache-Control`, () => {
    const r = call(url);
    assert.equal(r.status, 200);
    assert.match(r.headers.etag, /^"[0-9a-f]{32}"$/, 'strong quoted ETag expected');
    assert.ok(r.headers['last-modified'], 'Last-Modified expected');
    assert.equal(r.headers['cache-control'], 'public, max-age=3600');
    // Two calls agree: the validator is content-derived, not per-call random.
    assert.equal(call(url).headers.etag, r.headers.etag);
  });

  test(`${url}: If-None-Match match -> bare 304 keeping cache headers`, () => {
    const first = call(url);
    const etag = first.headers.etag;
    const r = call(url, { 'if-none-match': etag });
    assert.equal(r.status, 304, 'matching If-None-Match must be answered 304');
    assert.equal(r.body, '', '304 responses carry no body');
    assert.equal(r.headers.etag, etag, '304 keeps the current ETag');
    assert.equal(r.headers['cache-control'], 'public, max-age=3600');
    assert.ok(r.headers['x-schema-version'], '304 still stamps X-Schema-Version');
  });

  test(`${url}: weak/list If-None-Match forms accepted; unknown validator -> 200`, () => {
    const etag = call(url).headers.etag;
    assert.equal(call(url, { 'if-none-match': `W/${etag}` }).status, 304, 'weak W/ prefix honored');
    assert.equal(call(url, { 'if-none-match': `"deadbeef", ${etag}` }).status, 304, 'list form honored');
    const miss = call(url, { 'if-none-match': '"00000000000000000000000000000000"' });
    assert.equal(miss.status, 200);
    assert.ok(miss.body.length > 0, 'non-matching validator re-serves the full body');
  });

  test(`${url}: If-Modified-Since after boot -> 304, stale date -> 200`, () => {
    const lastMod = new Date(call(url).headers['last-modified']);
    // One second AFTER boot: fresh per Last-Modified comparison.
    const future = new Date(lastMod.getTime() + 1000).toUTCString();
    const past = new Date(lastMod.getTime() - 86400000).toUTCString();
    assert.equal(call(url, { 'if-modified-since': future }).status, 304);
    assert.equal(call(url, { 'if-modified-since': past }).status, 200);
    // If-None-Match takes precedence over If-Modified-Since (RFC 9110).
    assert.equal(
      call(url, { 'if-none-match': '"stale"', 'if-modified-since': future }).status,
      200,
      'mismatched INM overrides fresh IMS'
    );
  });
}

test('#616: llms.txt documents real cache policy instead of the "10 min" claim', () => {
  const llms = readFileSync(join(here, '..', 'public', 'llms.txt'), 'utf8');
  assert.doesNotMatch(
    llms,
    /set cache headers \(10 min on data endpoints\)/,
    'the false blanket "10 min on data endpoints" claim must stay gone'
  );
  assert.match(llms, /### Caching and revalidation/, 'caching section expected');
  for (const fragment of ['max-age=0, must-revalidate', 'max-age=600', 'max-age=3600', 'no-store', 'ETag', '304']) {
    assert.ok(llms.includes(fragment), `llms.txt caching section should mention ${fragment}`);
  }
});
