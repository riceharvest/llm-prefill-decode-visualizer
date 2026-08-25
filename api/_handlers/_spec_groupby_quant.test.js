// Regression tests for spec-accuracy fixes (#815, #823).
//
// #823: the /api/benchmarks 200 example rendered crossCheck.relatedRigComparisons
// as [] while the same document's CrossCheck schema requires an integer —
// example-vs-schema drift that client generators preferring examples inherit.
//
// #815: ?groupBy=quant keys cohorts on `hardwareKey|quantization`
// (hardware×quant pairs), not pure-quant groups across rigs; the spec's
// groupBy parameter carried no description, so documented semantics
// contradicted the handler.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const { default: handler } = await import(path.join(here, '..', '[...path].js'));

function fetchSpec() {
  const chunks = [];
  const headers = {};
  const res = {
    statusCode: 200,
    setHeader(k, v) { headers[k.toLowerCase()] = v; },
    getHeader(k) { return headers[String(k).toLowerCase()]; },
    hasHeader(k) { return Object.prototype.hasOwnProperty.call(headers, String(k).toLowerCase()); },
    end(body) { chunks.push(String(body)); }
  };
  handler({ method: 'GET', url: '/api/spec', query: {} }, res);
  assert.equal(res.statusCode, 200);
  return JSON.parse(chunks.join(''));
}

test('#823: benchmarks example crossCheck.relatedRigComparisons is an integer per CrossCheck schema', () => {
  const spec = fetchSpec();
  const op = spec.paths['/api/benchmarks'].get;
  const example = op.responses['200'].content['application/json'].example;
  assert.ok(example && Array.isArray(example.items) && example.items.length > 0,
    'benchmarks 200 response must carry an example with items[]');

  const schema = spec.components.schemas.CrossCheck;
  assert.ok(schema, 'CrossCheck component schema must exist');
  for (const item of example.items) {
    const cc = item.crossCheck;
    assert.ok(cc && typeof cc === 'object', 'each item carries a crossCheck object');
    for (const key of schema.required) {
      assert.ok(key in cc, `crossCheck.${key} present (required by schema)`);
    }
    assert.equal(typeof cc.relatedRigComparisons, 'number',
      '#823: relatedRigComparisons must be an integer like the wire (_crosscheck.js), not []');
    assert.ok(Number.isInteger(cc.relatedRigComparisons),
      'relatedRigComparisons must be an integer');
    assert.ok(Array.isArray(cc.contradictions), 'contradictions is an array');
  }
});

test('#815: groupBy=quant is documented as hardware×quantization cohorts', () => {
  const spec = fetchSpec();
  const op = spec.paths['/api/benchmarks'].get;
  const groupBy = op.parameters.find(p => p.name === 'groupBy');
  assert.ok(groupBy, 'groupBy param declared');
  assert.deepEqual(groupBy.schema.enum, ['hardwareModel', 'hardware', 'model', 'quant']);

  const desc = groupBy.description || '';
  // Must state that quant cohorts are keyed hardware|quantization and are NOT
  // pure-quant groups across rigs.
  assert.match(desc, /<hardwareKey>\|<quantization>/,
    'param description names the actual cohort key format');
  assert.match(desc, /hardware/i, 'description says quant = hardware×quantization');
  assert.match(desc, /NOT pure-quant/i,
    'description warns against the natural pure-quant reading');
});

test('#815: endpoint description also flags the quant cohort semantics', () => {
  const spec = fetchSpec();
  const desc = spec.paths['/api/benchmarks'].get.description;
  assert.match(desc, /quant = hardware×quantization cohorts/,
    'endpoint-level Regroup note carries the same caveat');
});
