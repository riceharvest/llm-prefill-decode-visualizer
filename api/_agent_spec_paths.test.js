// Issue #543: /api/agent/index.json and llms.txt advertise endpoints the
// OpenAPI spec omits. PR #1245 (#571) covers /api/diff, /api/export,
// /api/version, /api/mcp and /api/og; THIS branch adds the remaining sliver —
// the spec itself plus all six /api/agent/*.json wrapper docs — so an agent
// that derives its client from /api/spec can discover every advertised route.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');

function fetchSpec() {
  let mod;
  return import('./_handlers/spec.js').then(m => {
    mod = m.default;
    const headers = {};
    const res = {
      statusCode: 200,
      body: undefined,
      setHeader(k, v) { headers[k.toLowerCase()] = v; },
      getHeader(k) { return headers[k.toLowerCase()]; },
      hasHeader(k) { return Object.prototype.hasOwnProperty.call(headers, k.toLowerCase()); },
      end(payload) { if (payload !== undefined) this.body = payload; }
    };
    mod({ method: 'GET', query: {}, headers: {}, url: '/api/spec' }, res);
    assert.equal(res.statusCode, 200);
    return JSON.parse(res.body);
  });
}

const NEW_PATHS = [
  '/api/spec',
  '/api/agent/capabilities.json',
  '/api/agent/compute.json',
  '/api/agent/benchmarks.json',
  '/api/agent/scenario.json',
  '/api/agent/freshness.json',
  '/api/agent/confidence.json'
];

test('#543: the seven previously-omitted paths are documented in /api/spec', async () => {
  const spec = await fetchSpec();
  for (const p of NEW_PATHS) {
    const item = spec.paths[p];
    assert.ok(item, `${p} missing from spec.paths`);
    assert.ok(item.get, `${p} missing a GET operation`);
    assert.match(item.get.operationId, /^[a-z][A-Za-z0-9]*$/, `${p}: operationId must be camelCase`);
    assert.ok(item.get.description && item.get.description.length > 20, `${p}: needs a real description`);
  }
});

test('#543: every /api/agent/*.json endpoint advertised by index.json is in the spec', async () => {
  const spec = await fetchSpec();
  const index = JSON.parse(readFileSync(path.join(root, 'public/api/agent/index.json'), 'utf8'));
  const agentPaths = index.endpoints.map(e => e.path).filter(p => p.startsWith('/api/agent/') && p !== '/api/agent/index.json');
  assert.ok(agentPaths.length >= 6, `expected the six agent doc endpoints, got ${agentPaths}`);
  for (const p of agentPaths) {
    assert.ok(spec.paths[p]?.get, `index.json advertises ${p} but /api/spec omits it`);
  }
});

test('#543: new operations carry x-examples + x-rate-limit like every other op', async () => {
  const spec = await fetchSpec();
  for (const p of NEW_PATHS) {
    const op = spec.paths[p].get;
    assert.ok(op['x-examples'], `${p} missing x-examples`);
    assert.match(op['x-examples'].request, /curl/, `${p} x-examples.request should be curl-style`);
    assert.ok(op['x-examples'].response !== undefined && op['x-examples'].response !== null, `${p} x-examples.response required`);
    assert.equal(typeof op['x-rate-limit'].enforced, 'boolean', `${p} missing x-rate-limit stamp`);
  }
});
