// #563: the ready-made sizingQuery used to 404 on its own canonical example —
// a bare "Q4" became ?quant=q4, which exact-matches zero stored tags
// (q4_k_m / iq4_xs / …). The query now omits coarse quants (flagged via an
// extra ambiguity) and carries a path-free `sizingQueryString` companion.
//
// Run: node --test api/_handlers/_parse_constraints_sizing.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseConstraints, constraintsToSizingQuery, isCoarseQuantLabel
} from '../_parse_constraints.js';
import parseConstraintsHandler from './parse-constraints.js';

const CANONICAL = 'self-hosted Qwen 27B at Q4 for 10 users under $1500';

function mockRes() {
  const headers = new Map();
  let statusCode = 200;
  let endedBody = null;
  return {
    get statusCode() { return statusCode; },
    set statusCode(v) { statusCode = v; },
    setHeader(k, v) { headers.set(k.toLowerCase(), v); },
    getHeader(k) { return headers.get(String(k).toLowerCase()); },
    end(body) { endedBody = body ?? ''; },
    get parsed() { try { return JSON.parse(endedBody); } catch { return null; } }
  };
}

test('bare quant levels are detected as coarse', () => {
  for (const ok of ['q4', 'Q8', 'iq3', 'q1']) assert.ok(isCoarseQuantLabel(ok), ok);
  for (const no of ['q4_k_m', 'iq4_xs', 'q8_0', 'fp16', 'nvfp4', '']) assert.equal(isCoarseQuantLabel(no), false, no);
});

test('constraintsToSizingQuery omits bare-level quants but keeps full tags', () => {
  const coarse = constraintsToSizingQuery(parseConstraints(CANONICAL).constraints);
  assert.ok(!coarse.has('quant'), 'coarse quant must not reach the sizing query');
  assert.equal(coarse.get('model'), 'qwen');
  assert.equal(coarse.get('concurrency'), '10');

  const precise = constraintsToSizingQuery(parseConstraints('llama at q4_k_m').constraints);
  assert.equal(precise.get('quant'), 'q4_k_m');
});

test('handler: canonical example emits a quant-free sizingQuery + ambiguity note', async () => {
  const res = mockRes();
  await parseConstraintsHandler({ method: 'GET', query: { q: CANONICAL } }, res);
  assert.equal(res.statusCode, 200);
  const body = res.parsed;

  // The documented pipeline now survives its own example.
  assert.ok(body.sizingQuery.startsWith('/api/sizing?'));
  assert.ok(!body.sizingQuery.includes('quant=q4'), body.sizingQuery);

  // Path-free companion field appends cleanly to a base URL (#563 secondary).
  assert.equal(body.sizingQueryString, body.sizingQuery.slice('/api/sizing?'.length));
  assert.ok(!body.sizingQueryString.startsWith('/'));

  const quantNotes = body.ambiguities.filter(a => a.field === 'quantization' && /omitted from sizingQuery/.test(a.message));
  assert.equal(quantNotes.length, 1, 'omission must be flagged as an ambiguity');
});

test('handler: full quant tag still flows through with no omission note', async () => {
  const res = mockRes();
  await parseConstraintsHandler({ method: 'GET', query: { q: 'self-hosted Qwen 27B at q4_k_m for 10 users under $1500' } }, res);
  assert.equal(res.statusCode, 200);
  const body = res.parsed;
  assert.ok(body.sizingQuery.includes('quant=q4_k_m'));
  assert.ok(!body.ambiguities.some(a => /omitted from sizingQuery/.test(a.message)));
});

test('handler: empty mapping keeps sizingQuery and sizingQueryString null', async () => {
  const res = mockRes();
  await parseConstraintsHandler({ method: 'GET', query: { q: 'hello world' } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.parsed.sizingQuery, null);
  assert.equal(res.parsed.sizingQueryString, null);
});
