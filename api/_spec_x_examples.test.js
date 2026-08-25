// OpenAPI x-examples coverage.
//
// Every operation in the spec served by GET /api/spec must carry an
// `x-examples` extension with a curl-style request and a realistic response,
// so agents can copy-paste without reading handler code. Responses default to
// the inline example already on the 2xx response; X_EXAMPLES in spec.js adds
// what is missing. See api/_handlers/spec.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const chunks = [];
const headers = {};
const res = {
  statusCode: 200,
  setHeader(k, v) { headers[k.toLowerCase()] = v; },
  getHeader(k) { return headers[String(k).toLowerCase()]; },
  end(body) { chunks.push(String(body)); },
};

const specModule = await import('./_handlers/spec.js');
const X_EXAMPLES = specModule.X_EXAMPLES;
specModule.default({ method: 'GET', url: '/api/spec' }, res);

const spec = JSON.parse(chunks.join(''));

test('spec served by /api/spec is a valid OpenAPI 3.1 document', () => {
  assert.equal(spec.openapi, '3.1.0');
  assert.ok(spec.info?.version);
});

const HTTP_OPS = ['get', 'post', 'put', 'delete', 'patch'];

for (const [p, item] of Object.entries(spec.paths)) {
  test(`x-examples present on every operation of ${p}`, () => {
    const ops = HTTP_OPS.filter(m => item[m]);
    assert.ok(ops.length > 0, `${p} documents no operations`);
    for (const m of ops) {
      const ex = item[m]['x-examples'];
      assert.ok(ex, `${p} ${m} is missing x-examples`);
      assert.equal(typeof ex.request, 'string', `${p} ${m} x-examples.request should be a curl-style string`);
      assert.match(ex.request, /curl/, `${p} ${m} x-examples.request should be curl-style`);
      assert.ok(
        ex.response !== undefined && ex.response !== null,
        `${p} ${m} x-examples.response should carry an example response (object/string)`
      );
      if (item[m].requestBody) {
        assert.ok(ex.requestBody !== undefined, `${p} ${m} declares requestBody but x-examples lacks one`);
      }
    }
  });
}

// Truthfulness spot-checks: an x-example claims to be "derived from handler
// code … (no invented fields)", so its documented values must match what the
// handlers actually return for the documented call (#1115).
// These guards fail when handler math changes and leaves a stale example
// behind — exactly the drift the batch example had accumulated.

function mockRes() {
  const chunks = [];
  const headers = {};
  return {
    headers,
    statusCode: 0,
    setHeader(k, v) { headers[String(k).toLowerCase()] = v; },
    getHeader(k) { return headers[String(k).toLowerCase()]; },
    end(body) { chunks.push(String(body)); },
    body: () => chunks.join('')
  };
}

async function runHandler(handlerMod, req) {
  const res = mockRes();
  await handlerMod(req, res);
  return JSON.parse(res.body());
}

test('/api/compute POST batch x-example result ids match the real deterministic calc ids', async () => {
  // The POST batch entry lives in the X_EXAMPLES table (module-scope export);
  // it documents the POST batch dialect even though /api/compute currently
  // declares only a GET operation (#1057 tracks adding the POST op).
  const ex = X_EXAMPLES['/api/compute'].post;
  const items = ex.requestBody?.batch;
  assert.ok(Array.isArray(items) && items.length > 0, 'batch x-example lost its requestBody.batch items');
  const { default: computeHandler } = await import('./_handlers/compute.js');

  for (let i = 0; i < items.length; i++) {
    const expectedId = ex.response.results[i]?.result?.id;
    assert.ok(expectedId, `batch item ${i} has no id in the example`);
    // The same params via GET mint the same content-hash id as the batch item.
    const actual = await runHandler(computeHandler, { method: 'GET', query: { ...items[i] } });
    assert.equal(actual.id, expectedId,
      `batch item ${i}: example id ${expectedId} is not the real calc id (${actual.id}) for ${JSON.stringify(items[i])}`);
  }
});
