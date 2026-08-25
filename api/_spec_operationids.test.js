// Agentic contract test: OpenAPI operationId stability.
//
// Generated SDKs and agent integrations key off `operationId` (the sdk.yml
// workflow regenerates /clients from this spec). Renaming or dropping one is a
// breaking change for every consumer — this test locks the full
// path+method -> operationId map so any rename fails CI.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import handler from './_handlers/spec.js';

function fetchSpec() {
  const headers = {};
  const res = {
    statusCode: 200,
    body: undefined,
    setHeader(k, v) { headers[k.toLowerCase()] = v; },
    getHeader(k) { return headers[k.toLowerCase()]; },
    end(payload) { if (payload !== undefined) this.body = payload; }
  };
  handler({ method: 'GET', query: {}, headers: {}, url: '/api/spec' }, res);
  assert.equal(res.statusCode, 200, 'GET /api/spec should return 200');
  return JSON.parse(res.body);
}

const HTTP_METHODS = new Set(['get', 'put', 'post', 'delete', 'patch', 'options', 'head', 'trace']);

/** Flatten spec.paths into ['<METHOD> <path>', operationId] entries. */
function operationIdMap(spec) {
  const map = {};
  for (const [path, pathItem] of Object.entries(spec.paths)) {
    for (const method of Object.keys(pathItem)) {
      if (!HTTP_METHODS.has(method)) continue;
      const op = pathItem[method];
      if (op && op.operationId !== undefined) {
        map[`${method.toUpperCase()} ${path}`] = op.operationId;
      }
    }
  }
  return map;
}

// The locked contract. Adding an endpoint means adding a line here;
// renaming a value here must fail CI (update it deliberately in the same
// commit as a changelog note in CHANGELOG-API.md).
const LOCKED_OPERATION_IDS = {
  'GET /api/compute': 'computeInference',
  'POST /api/compute': 'computeInferenceBatch',
  'GET /api/vram': 'estimateVram',
  'POST /api/vram': 'estimateVramFromBody',
  'GET /api/calc/{id}': 'replayCalculation',
  'POST /api/calc/{id}': 'replayCalculationFromBody',
  'GET /api/presets': 'listPresets',
  'GET /api/localmaxxing': 'listBenchmarkRuns',
  'POST /api/localmaxxing': 'submitBenchmarkRun',
  'GET /api/runs': 'dumpRunIndex',
  'GET /api/watch': 'listWatches',
  'POST /api/watch': 'createWatch',
  'DELETE /api/watch': 'deleteWatch',
  'GET /api/watch/rss.xml': 'getWatchRssFeed',
  'GET /api/watch/dispatch': 'dispatchWatchWebhooks',
  'GET /api/benchmarks': 'getBenchmarkAggregates',
  'GET /api/best': 'getBestConfigs',
  'GET /api/health': 'getHealth',
  'GET /api/sizing': 'getSizingRecommendation',
  'POST /api/sizing': 'createSizingRecommendation',
  'GET /api/parse-constraints': 'parseConstraints',
  'GET /api/snapshots': 'listDatasetSnapshots'
};

test('every operation in the spec carries an operationId', () => {
  const spec = fetchSpec();
  const ids = operationIdMap(spec);
  const totalOps = Object.entries(spec.paths)
    .flatMap(([, p]) => Object.keys(p).filter(m => HTTP_METHODS.has(m)))
    .length;
  assert.equal(Object.keys(ids).length, totalOps,
    `found ${totalOps} operations but only ${Object.keys(ids).length} with operationId`);
});

test('operationIds are unique across the whole spec', () => {
  const values = Object.values(operationIdMap(fetchSpec()));
  assert.equal(new Set(values).size, values.length, 'duplicate operationId detected');
});

test('operationIds follow camelCase (no spaces, dashes, underscores)', () => {
  for (const id of Object.values(operationIdMap(fetchSpec()))) {
    assert.match(id, /^[a-z][A-Za-z0-9]*$/, `operationId "${id}" is not camelCase`);
  }
});

test('operationId map matches the locked snapshot exactly (renames fail CI)', () => {
  assert.deepEqual(operationIdMap(fetchSpec()), LOCKED_OPERATION_IDS);
});
