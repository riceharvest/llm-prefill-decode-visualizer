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

const { default: specHandler } = await import('./_handlers/spec.js');
specHandler({ method: 'GET', url: '/api/spec' }, res);

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

// Issue #941: x-examples.request strings used to ship a literal uninterpolated
// `$BASE` placeholder (defined nowhere in the document), so copy-pasted or
// agent-executed examples failed with an empty-URL curl error. Every request
// must now resolve against the real server base URL declared in servers[0].
test('x-examples.request contains no literal $BASE placeholder (#941)', () => {
  for (const [p, item] of Object.entries(spec.paths)) {
    for (const m of HTTP_OPS.filter(m => item[m])) {
      const ex = item[m]['x-examples'];
      assert.ok(
        !String(ex.request).includes('$BASE'),
        `${p} ${m} x-examples.request still ships the $BASE placeholder`
      );
    }
  }
});

test('x-examples.request URLs resolve against servers[0]', () => {
  const base = spec.servers[0].url;
  assert.match(base, /^https:\/\//);
  for (const [p, item] of Object.entries(spec.paths)) {
    for (const m of HTTP_OPS.filter(m => item[m])) {
      assert.ok(
        String(item[m]['x-examples'].request).includes(base),
        `${p} ${m} x-examples.request should reference the servers[0] base URL (${base})`
      );
    }
  }
});
