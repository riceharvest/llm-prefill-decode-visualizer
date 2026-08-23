// Tests for /api/agent/compute.json (api/_handlers/agent_compute.js) — the
// agent-friendly wrapper around the existing compute_inference math
// (/api/compute). Asserts status 200, JSON content-type, the expected agent
// envelope fields, and that the math matches a direct computeBody() call
// (wrap-not-duplicate contract).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import agentComputeHandler, { buildAgentComputeBody } from '../api/_handlers/agent_compute.js';
import { computeBody } from '../api/_handlers/compute.js';

async function callHandler(query = {}, method = 'GET', body = undefined) {
  const captured = {};
  const res = {
    statusCode: 0,
    headers: {},
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
    getHeader(k) { return this.headers[k.toLowerCase()]; },
    end(bodyText) {
      captured.status = this.statusCode;
      captured.contentType = this.headers['content-type'];
      captured.body = JSON.parse(bodyText);
    }
  };
  const req = { query, method, headers: {} };
  if (method === 'POST') req.body = body ?? {};
  await agentComputeHandler(req, res);
  return captured;
}

test('POST accepts a JSON parameter set like GET', async () => {
  const { status, body } = await callHandler({}, 'POST', {
    model: 'singleTurn', promptTokens: 4096
  });
  assert.equal(status, 200);
  assert.equal(body.scenario, 'singleTurn');
  assert.deepEqual(body.inputs.promptTokens, 4096);
});

test('returns status 200 with JSON content-type and schema_version', async () => {
  const { status, contentType, body } = await callHandler({ model: 'singleTurn' });
  assert.equal(status, 200);
  assert.match(contentType, /^application\/json/);
  assert.equal(body.schema_version, '1');
});

test('singleTurn call carries the flat agent envelope with resolved inputs and math fields', async () => {
  const { status, body } = await callHandler({
    model: 'singleTurn', promptTokens: '4096', outputTokens: '512',
    prefillSpeed: '3800', decodeSpeed: '105'
  });
  assert.equal(status, 200);

  // Envelope fields.
  for (const field of ['description', 'endpoint', 'generatedAt', 'scenario', 'inputs', 'id', 'caveats', 'relatedEndpoints']) {
    assert.ok(field in body, `missing envelope field: ${field}`);
  }
  assert.equal(body.endpoint, '/api/agent/compute.json');
  assert.equal(body.scenario, 'singleTurn');
  assert.ok(Array.isArray(body.caveats) && body.caveats.length > 0);

  // Resolved inputs + deterministic calc id (same as /api/compute).
  assert.deepEqual(body.inputs, {
    promptTokens: 4096, outputTokens: 512, prefillSpeed: 3800, decodeSpeed: 105
  });
  assert.match(body.id, /^calc_/);

  // Math fields flattened to the top level, matching the shared math exactly.
  const direct = computeBody({
    model: 'singleTurn', promptTokens: 4096, outputTokens: 512,
    prefillSpeed: 3800, decodeSpeed: 105
  });
  for (const field of ['ttftSeconds', 'tpotMs', 'decodeSeconds', 'totalWalltimeSeconds',
    'effectiveThroughputTokPerSec', 'prefillSharePct', 'decodeSharePct', 'warnings']) {
    assert.ok(field in body, `missing math field: ${field}`);
    assert.deepEqual(body[field], direct.body[field], `${field} diverges from /api/compute`);
  }
});

test('kvCache call resolves architecture presets and returns VRAM numbers', async () => {
  const { status, body } = await callHandler({
    model: 'kvCache', architecture: 'llama70b', contextLength: '65536'
  });
  assert.equal(status, 200);
  assert.equal(body.scenario, 'kvCache');
  assert.equal(body.inputs.contextLength, 65536);
  assert.equal(typeof body.totalGb, 'number');
  assert.ok(body.totalGb > 0);
  assert.match(body.id, /^calc_/);
});

test('bare call returns the self-describing capability catalog', async () => {
  const { status, body } = await callHandler({});
  assert.equal(status, 200);
  assert.equal(body.endpoint, '/api/agent/compute.json');
  for (const scenario of ['singleTurn', 'speculative', 'batched', 'agentic', 'kvCache', 'flagged', 'cost']) {
    assert.ok(body.models[scenario], `capability catalog missing ${scenario}`);
  }
  assert.ok('batch' in body);
  assert.ok('dryRun' in body);
});

test('batch requests pass through with per-item ok/error entries', async () => {
  const batch = JSON.stringify([
    { model: 'singleTurn', promptTokens: 2048 },
    { model: 'nope' }
  ]);
  const { status, body } = await callHandler({ batch });
  assert.equal(status, 200);
  assert.equal(body.count, 2);
  assert.equal(body.okCount, 1);
  assert.equal(body.errorCount, 1);
  assert.equal(body.results[0].ok, true);
  assert.equal(body.results[1].ok, false);
  // Envelope still present around the batch payload.
  assert.equal(body.endpoint, '/api/agent/compute.json');
  assert.ok(Array.isArray(body.caveats));
});

test('unknown model returns problem+json INVALID_PARAMS (same as /api/compute)', async () => {
  const { status, contentType, body } = await callHandler({ model: 'bogus' });
  assert.equal(status, 400);
  assert.match(contentType, /^application\/problem\+json/);
  assert.equal(body.code, 'INVALID_PARAMS');
  assert.ok(Array.isArray(body.available));
});

test('buildAgentComputeBody is deterministic apart from generatedAt', () => {
  const params = { model: 'agentic', numTurns: 6 };
  const a = buildAgentComputeBody(params, new Date(0));
  const b = buildAgentComputeBody(params, new Date(0));
  delete a.body.generatedAt;
  delete b.body.generatedAt;
  assert.deepEqual(a, b);
});
