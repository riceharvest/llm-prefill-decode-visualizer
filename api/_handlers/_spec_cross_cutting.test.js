// Contract tests for the spec-completeness fixes #752 + #754:
//   #752 — /api/best query params implemented by best.js (engine, max_age,
//           scenario, sort_by, limit cap, canonical cost spellings) are
//           declared in /api/spec.
//   #754 — cross-cutting Accept: text/markdown negotiation and the
//           X-Request-Id echo are documented in /api/spec (info.description
//           + machine-readable root extensions).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import specHandler from './spec.js';
import { _resetRateLimits } from '../_ratelimit.js';

function fetchSpec() {
  _resetRateLimits();
  const headers = {};
  const res = {
    statusCode: 200,
    setHeader(k, v) { headers[k] = v; },
    getHeader(k) { return headers[k]; },
    end(body) { res.body = body; }
  };
  specHandler({ headers: {}, url: '/api/spec' }, res);
  assert.equal(res.statusCode, 200, 'spec handler should return 200');
  return JSON.parse(res.body);
}

const spec = fetchSpec();
const bestParams = () => spec.paths['/api/best'].get.parameters;
const paramNames = () => bestParams().map(p => p.name);

test('#752 spec declares engine, max_age, scenario and sort_by for /api/best', () => {
  const names = paramNames();
  for (const name of ['engine', 'max_age', 'scenario', 'sort_by']) {
    assert.ok(names.includes(name), `missing documented param: ${name}`);
  }
  const scenario = bestParams().find(p => p.name === 'scenario');
  assert.deepEqual(scenario.schema.enum, ['chat', 'rag', 'longdoc', 'codegen', 'reasoning']);
});

test('#752 limit documents its hard cap of 50', () => {
  const limit = bestParams().find(p => p.name === 'limit');
  assert.equal(limit.schema.maximum, 50);
  assert.match(limit.description, /50/);
});

test('#752 cost-mode canonical spellings declared alongside legacy aliases', () => {
  const names = paramNames();
  for (const name of ['price', 'hardwarePriceUsd', 'electricityRate', 'electricityRatePerKwh']) {
    assert.ok(names.includes(name), `missing cost param: ${name}`);
  }
});

test('#754 markdown content negotiation is documented (root extension + info prose)', () => {
  const neg = spec['x-content-negotiation'];
  assert.ok(neg, 'missing x-content-negotiation root extension');
  assert.equal(neg.mediaTypes.markdown, 'text/markdown');
  assert.match(spec.info.description, /text\/markdown/);
  assert.match(spec.info.description, /Vary/);
});

test('#754 X-Request-Id echo is documented (root extension + info prose)', () => {
  const rid = spec['x-request-id'];
  assert.ok(rid, 'missing x-request-id root extension');
  assert.equal(rid.header, 'X-Request-Id');
  assert.equal(rid.echo, true);
  assert.equal(rid.maxLength, 200);
  assert.match(spec.info.description, /X-Request-Id/);
});
