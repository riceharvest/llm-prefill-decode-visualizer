// Contract tests for GET /api/agent/scenario.json — the agent-friendly
// loader for the built-in workload scenario presets. Mirrors the flat,
// self-describing response style of /api/agent/benchmarks.json.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import scenarioHandler, {
  isValidScenario,
  findScenario,
  toAgentScenario
} from './_handlers/agent_scenario.js';
import { SCENARIO_PRESETS } from '../src/utils/presets.js';

function mockRes() {
  return {
    statusCode: 0,
    headers: {},
    body: null,
    ended: false,
    setHeader(k, v) { this.headers[k] = v; },
    getHeader(k) { return this.headers[k]; },
    end(b) { this.ended = true; this.body = b ? JSON.parse(b) : null; }
  };
}

async function call(query = {}) {
  const res = mockRes();
  await scenarioHandler({ method: 'GET', query }, res);
  return { status: res.statusCode, body: res.body };
}

test('directory mode (no ?id=) lists every valid preset with derived counts', async () => {
  const { status, body } = await call();
  assert.equal(status, 200);
  assert.equal(body.endpoint, '/api/agent/scenario.json');
  assert.equal(body.count, SCENARIO_PRESETS.length);
  assert.equal(body.scenarios.length, body.count);
  for (const s of body.scenarios) {
    assert.ok(s.id && s.label);
    assert.equal(s.totalTokens, s.promptTokens + s.outputTokens);
    assert.ok(s.prefillShare > 0 && s.prefillShare < 1);
    // prefillShare must be rounded to 3 decimals
    assert.equal(s.prefillShare, Math.round(s.prefillShare * 1000) / 1000);
  }
  assert.ok(Array.isArray(body.nextSteps) && body.nextSteps.length > 0);
});

test('?id= load mode returns exactly one scenario with echoed requestedId', async () => {
  const { status, body } = await call({ id: 'codegen' });
  assert.equal(status, 200);
  assert.equal(body.requestedId, 'codegen');
  assert.equal(body.scenario.id, 'codegen');
  assert.ok(body.scenario.promptTokens > 0 && body.scenario.outputTokens > 0);
});

test('id lookup is case-insensitive and whitespace-tolerant', () => {
  const hit = findScenario('  CodeGen ');
  assert.ok(hit);
  assert.equal(hit.id, 'codegen');
  assert.equal(findScenario(null), null);
  assert.equal(findScenario('   '), null);
  assert.equal(findScenario('nope'), null);
});

test('unknown ?id= → 400 with error code, requestedId and availableIds', async () => {
  const { status, body } = await call({ id: 'bogus' });
  assert.equal(status, 400);
  assert.equal(body.error, 'unknown_scenario');
  assert.equal(body.requestedId, 'bogus');
  assert.deepEqual(
    new Set(body.availableIds),
    new Set(SCENARIO_PRESETS.map((s) => s.id))
  );
});

test('isValidScenario rejects drift in the shared preset source', () => {
  assert.ok(isValidScenario({ id: 'x', label: 'X', promptTokens: 10, outputTokens: 20 }));
  assert.ok(!isValidScenario(null));
  assert.ok(!isValidScenario({ id: '', label: 'X', promptTokens: 10, outputTokens: 20 }));
  assert.ok(!isValidScenario({ id: 'x', label: 'X', promptTokens: 1.5, outputTokens: 20 }));
  assert.ok(!isValidScenario({ id: 'x', label: 'X', promptTokens: 0, outputTokens: 20 }));
  assert.ok(!isValidScenario({ id: 'x', label: '', promptTokens: 10, outputTokens: 20 }));
  // every real preset must pass the guard — keeps /api/contract safe if presets drift
  for (const s of SCENARIO_PRESETS) assert.ok(isValidScenario(s), `preset ${s?.id} failed guard`);
});

test('toAgentScenario bakes token math into field names (no nested objects)', () => {
  const out = toAgentScenario({ id: 'chat', label: 'Standard chat', promptTokens: 2048, outputTokens: 512 });
  assert.deepEqual(Object.keys(out).sort(), ['id', 'label', 'outputTokens', 'prefillShare', 'promptTokens', 'totalTokens']);
  assert.equal(out.totalTokens, 2560);
  assert.equal(out.prefillShare, 0.8);
});

test('router serves /api/agent/scenario.json', async () => {
  const { readFileSync } = await import('node:fs');
  const routerSrc = readFileSync(new URL('./[...path].js', import.meta.url), 'utf8');
  assert.match(routerSrc, /case '\/agent\/scenario\.json'/);
});
