// Spec-completeness guards (#744 + #745).
//
// #744: /api/spec's GET /api/compute parameter list must cover every input
// the handler actually reads (computeOne() in _handlers/compute.js) and must
// NOT claim promptTokens/outputTokens feed the agentic model (it reads
// basePromptTokens/toolOutputTokensPerTurn/decodeTokensPerTurn instead).
//
// #745: three paths that implement POST server-side must declare a `post`
// operation in the spec (/api/localmaxxing run submission, /api/vram JSON
// body estimate, /api/calc/{id} JSON-body replay), with x-examples attached.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const chunks = [];
const headers = {};
const res = {
  statusCode: 200,
  setHeader(k, v) { headers[k.toLowerCase()] = v; },
  getHeader(k) { return headers[String(k).toLowerCase()]; },
  end(body) { chunks.push(String(body)); }
};

const { default: specHandler } = await import('./_handlers/spec.js');
specHandler({ method: 'GET', url: '/api/spec' }, res);
const spec = JSON.parse(chunks.join(''));

function computeParam(name) {
  return spec.paths['/api/compute'].get.parameters.find(p => p.name === name);
}

// ---------- #744 ----------

test('#744: speculative params baseDecodeSpeed + draftCostFraction are documented', () => {
  assert.ok(computeParam('baseDecodeSpeed'), 'baseDecodeSpeed missing from /api/compute parameters');
  assert.ok(computeParam('draftCostFraction'), 'draftCostFraction missing from /api/compute parameters');
  assert.match(computeParam('draftCostFraction').description, /0\.2/);
});

test('#744: batched decodeDecayExponent is documented', () => {
  const p = computeParam('decodeDecayExponent');
  assert.ok(p, 'decodeDecayExponent missing from /api/compute parameters');
  assert.match(p.description, /batched/);
  assert.match(p.description, /0\.25/);
});

test('#744: agentic workload params documented; promptTokens/outputTokens no longer labeled agentic', () => {
  for (const name of ['basePromptTokens', 'toolOutputTokensPerTurn', 'decodeTokensPerTurn']) {
    const p = computeParam(name);
    assert.ok(p, `${name} missing from /api/compute parameters`);
    assert.match(p.description, /agentic/, `${name} description should tie it to the agentic model`);
  }
  // The agentic branch never reads these — the spec must not say it does.
  for (const name of ['promptTokens', 'outputTokens']) {
    const desc = computeParam(name).description;
    assert.ok(!/\bagentic\b/.test(desc), `${name} description still claims agentic support: "${desc}"`);
  }
});

test('#744: kvCache explicit geometry overrides numLayers/kvHeads/headDim are documented', () => {
  for (const name of ['numLayers', 'kvHeads', 'headDim']) {
    const p = computeParam(name);
    assert.ok(p, `${name} missing from /api/compute parameters`);
    assert.match(p.description, /kvCache/);
  }
});

test('#744: every per-model param in the capability list appears in the spec parameter inventory', async () => {
  // Drive the bare-GET capability list through the real handler.
  const capChunks = [];
  const capRes = {
    statusCode: 200,
    setHeader() {},
    getHeader() { return undefined; },
    end(b) { capChunks.push(String(b)); }
  };
  const { default: computeHandler } = await import('./_handlers/compute.js');
  await computeHandler({ method: 'GET', query: {}, url: '/api/compute' }, capRes);
  const cap = JSON.parse(capChunks.join(''));

  const specNames = new Set(spec.paths['/api/compute'].get.parameters.map(p => p.name));
  // Composite kvCache entry lists geometry as one string; aliases handled below.
  const aliases = new Set(['m']); // ?m= alias of model
  const composite = new Set(['architecture|numLayers+kvHeads+headDim']);
  for (const [model, info] of Object.entries(cap.models)) {
    for (const raw of info.params || []) {
      if (composite.has(raw)) continue;
      for (const name of raw.split('+')) {
        assert.ok(
          specNames.has(name),
          `capabilityList model=${model} param '${name}' is absent from the spec's /api/compute parameters`
        );
      }
    }
  }
  assert.ok(aliases.size >= 0); // keep lint quiet about unused
});

// ---------- #745 ----------

const POST_PATHS = [
  ['/api/localmaxxing', 'submitBenchmarkRun'],
  ['/api/vram', 'estimateVramFromBody'],
  ['/api/calc/{id}', 'replayCalculationFromBody']
];

for (const [path, opId] of POST_PATHS) {
  test(`#745: ${path} declares its implemented POST operation (${opId})`, () => {
    const item = spec.paths[path];
    assert.ok(item, `${path} missing from spec entirely`);
    const post = item.post;
    assert.ok(post, `${path} implements POST server-side but the spec documents GET only`);
    assert.equal(post.operationId, opId);
    assert.ok(post.responses && post.responses['200'] !== undefined
      ? true : ['202'].some(code => post.responses[code]), `${path} POST documents no success response`);

    // x-examples contract (same guard as _spec_x_examples.test.js)
    const ex = post['x-examples'];
    assert.ok(ex, `${path} POST missing x-examples`);
    assert.match(ex.request, /curl/, 'x-examples.request should be curl-style');
    assert.ok(ex.response !== undefined && ex.response !== null, 'x-examples.response required');
    if (post.requestBody) {
      assert.ok(ex.requestBody !== undefined, `${path} POST declares requestBody but x-examples lacks one`);
    }
  });
}

test('#745: localmaxxing POST documents the queued-submission contract (202/400/409/503)', () => {
  const responses = spec.paths['/api/localmaxxing'].post.responses;
  assert.ok(responses['202'], 'missing 202 queued response');
  assert.ok(responses['400'], 'missing 400 validation_failed response');
  assert.ok(responses['409'], 'missing 409 duplicate_run response');
  assert.ok(responses['503'], 'missing 503 queue_unavailable response');
  assert.match(responses['400'].description, /validation_failed/);
  assert.match(responses['409'].description, /duplicate_run/);
});
