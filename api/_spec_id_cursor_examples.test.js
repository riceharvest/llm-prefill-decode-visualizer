// Regression tests for spec-vs-wire id/cursor example drift (#965, #966).
//
// #965: every runId in the OpenAPI document is typed string and every runId
//        example is a CUID-shaped string — the live API only ever serves
//        25-char CUID strings, and /api/diff's missing-param hint now shows
//        CUID placeholders instead of numeric ids that can never resolve.
// #966: the spec's next_cursor examples are minted with the real encodeCursor()
//        keyset encoder, so they decode cleanly and replay against the live API
//        instead of teaching a dead `offset|key` pipe grammar (400 INVALID_CURSOR).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const { default: handler } = await import(path.join(here, '[...path].js'));
const { decodeCursor, encodeCursor } = await import(path.join(here, '_pagination.js'));
const { default: diffHandler } = await import(path.join(here, '_handlers', 'diff.js'));

function makeMockRes() {
  const chunks = [];
  const headers = {};
  const res = {
    statusCode: 200,
    setHeader(k, v) { headers[String(k).toLowerCase()] = v; },
    getHeader(k) { return headers[String(k).toLowerCase()]; },
    // [...path].js middleware probes this; plain mocks return false (#1170 note)
    hasHeader() { return false; },
    end(body) { chunks.push(String(body)); }
  };
  return { res, chunks };
}

async function fetchSpec() {
  const { res, chunks } = makeMockRes();
  const done = new Promise(resolve => { res.end = body => { chunks.push(String(body)); resolve(); }; });
  await handler({ method: 'GET', url: '/api/spec', query: {} }, res);
  await done;
  assert.equal(res.statusCode, 200);
  return JSON.parse(chunks.join(''));
}

/** Walk a value collecting {path, node} for every object under a key name. */
function collectByKey(node, key, path = '', out = []) {
  if (Array.isArray(node)) {
    node.forEach((item, i) => collectByKey(item, key, `${path}[${i}]`, out));
  } else if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) {
      if (k === key) out.push({ path: `${path}.${k}`, node: v });
      collectByKey(v, key, `${path}.${k}`, out);
    }
  }
  return out;
}

test('#965: no runId property anywhere in the spec is typed integer', async () => {
  const spec = await fetchSpec();
  const runIdProps = collectByKey(spec, 'runId');
  assert.ok(runIdProps.length >= 4, `expected several runId schemas, found ${runIdProps.length}`);
  const bad = runIdProps.filter(({ node }) => node && typeof node === 'object' && node.type === 'integer');
  assert.deepEqual(bad.map(b => b.path), [], `integer-typed runId schemas remain: ${bad.map(b => b.path).join(', ')}`);
});

test('#965: no fabricated 58213 remains; all runId examples are CUID strings', async () => {
  const spec = await fetchSpec();
  const raw = JSON.stringify(spec);
  assert.ok(!raw.includes('58213'), 'fabricated numeric example 58213 still present in the spec');
  const scalarRunIds = [];
  (function walk(node) {
    if (Array.isArray(node)) node.forEach(walk);
    else if (node && typeof node === 'object') Object.entries(node).forEach(([k, v]) => {
      if (k === 'runId') scalarRunIds.push(v);
      walk(v);
    });
  })(spec);
  assert.ok(scalarRunIds.length >= 3, 'expected runId example values in examples');
  for (const v of scalarRunIds) {
    if (v && typeof v === 'object') continue; // schema definitions checked by the type test
    assert.equal(typeof v, 'string', `runId example must be a string, got ${JSON.stringify(v)}`);
    assert.match(v, /^[a-z0-9]{25}$/, `runId example must be CUID-shaped, got ${v}`);
  }
});

test('#965: example source URLs point at the same CUID-shaped run page', async () => {
  const raw = JSON.stringify(await fetchSpec());
  const urls = [...raw.matchAll(/localmaxxing\.com\/en\/runs\/([a-z0-9]+)/g)].map(m => m[1]);
  assert.ok(urls.length > 0, 'expected localmaxxing run source URLs in examples');
  for (const id of urls) assert.match(id, /^[a-z0-9]{25}$/, `source URL run id must be CUID-shaped, got ${id}`);
});

test('#966: next_cursor examples decode as real keyset cursors and round-trip', async () => {
  const spec = await fetchSpec();
  const examples = [];
  (function walk(node) {
    if (Array.isArray(node)) node.forEach(walk);
    else if (node && typeof node === 'object') Object.entries(node).forEach(([k, v]) => {
      if (k === 'next_cursor' && typeof v === 'string') examples.push(v);
      walk(v);
    });
  })(spec);
  assert.ok(examples.length >= 2, `expected >=2 next_cursor examples, found ${examples.length}`);
  const expectedKeys = [
    [108, 'cmsxu9zyi0ck7ms01v41wipnd'],   // run-page sort key: [decodeTokPerSec, String(runId)]
    [105, 'rtx4090|qwen3.6-27b']          // group-page sort key: [medianDecode, groupKey]
  ];
  const decodedKeys = examples.map(c => {
    const k = decodeCursor(c);
    assert.ok(Array.isArray(k), `next_cursor example does not decode to a {k:[num,str]} keyset cursor: ${c}`);
    assert.equal(typeof k[0], 'number');
    assert.equal(typeof k[1], 'string');
    assert.equal(c, encodeCursor(k), 'cursor example must round-trip byte-identically through encode/decode');
    return k;
  });
  for (const key of expectedKeys) {
    assert.ok(
      decodedKeys.some(k => k[0] === key[0] && k[1] === key[1]),
      `no next_cursor example carries the documented sort key ${JSON.stringify(key)}`
    );
  }
});

test('#965: /api/diff missing-params hint uses CUID-shaped placeholder ids', async () => {
  const chunks = [];
  let status = 0;
  const headers = {};
  const res = {
    set statusCode(v) { status = v; },
    get statusCode() { return status; },
    setHeader(k, v) { headers[k.toLowerCase()] = v; },
    getHeader(k) { return headers[k.toLowerCase()]; },
    end(body) { chunks.push(String(body)); }
  };
  await diffHandler({ method: 'GET', url: '/api/diff', query: {} }, res);
  assert.equal(status, 400);
  const body = JSON.parse(chunks.join(''));
  const m = /\/api\/diff\?runA=([^&]+)&runB=(\S+)/.exec(body.example || '');
  assert.ok(m, `diff hint should embed an example URL, got: ${body.example}`);
  assert.match(m[1], /^[a-z0-9]{25}$/, `runA placeholder must be CUID-shaped, got ${m[1]}`);
  assert.match(m[2], /^[a-z0-9]{25}$/, `runB placeholder must be CUID-shaped, got ${m[2]}`);
});
