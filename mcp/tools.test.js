// Agentic contract tests: MCP tool metadata consistency.
//
// Agents pick tools from `description` + input schema alone, so drift between
// a tool's prose, its declared parameters, and the API endpoint backing it is
// an integration bug. These tests lock the conventions over the declarative
// registry in ./tools.js (dependency-free by design, so no MCP SDK install is
// needed to run them). mcp/server.js builds its zod schemas from the same
// registry, so what agents see and what the server validates cannot diverge.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TOOLS, toolDef } from './tools.js';
import specHandler from '../api/_handlers/spec.js';

const SNAKE_CASE = /^[a-z][a-z0-9]*(_[a-z0-9]+)*$/;

function fetchSpec() {
  const res = {
    statusCode: 200,
    body: undefined,
    setHeader() {},
    getHeader() {},
    end(payload) { if (payload !== undefined) this.body = payload; }
  };
  specHandler({ method: 'GET', query: {}, headers: {}, url: '/api/spec' }, res);
  assert.equal(res.statusCode, 200);
  return JSON.parse(res.body);
}

/** Query-parameter names documented on the spec operation for a path (GET). */
function specParamNames(spec, path) {
  const op = spec.paths[path]?.get;
  if (!op) return null;
  return new Set((op.parameters || []).map(p => p.name));
}

test('tool names are unique and snake_case', () => {
  const names = TOOLS.map(t => t.name);
  assert.equal(new Set(names).size, names.length, 'duplicate tool name');
  for (const name of names) {
    assert.match(name, SNAKE_CASE, `tool name "${name}" is not snake_case`);
  }
});

test('every tool declares a non-empty description', () => {
  for (const t of TOOLS) {
    assert.equal(typeof t.description, 'string');
    assert.ok(t.description.trim().length >= 40, `tool "${t.name}" description is too short to orient an agent`);
    assert.ok(!/\.{3}|\bTODO\b|\bTBD\b/i.test(t.description), `tool "${t.name}" description contains a placeholder`);
  }
});

test('every required parameter is named in the tool description', () => {
  for (const t of TOOLS) {
    for (const req of t.required) {
      assert.ok(
        t.description.includes(`\`${req}\``) || t.description.includes(req),
        `tool "${t.name}" description must mention its required parameter "${req}"`
      );
    }
  }
});

test('every property has a non-empty, placeholder-free description', () => {
  for (const t of TOOLS) {
    assert.ok(Object.keys(t.properties).length > 0, `tool "${t.name}" declares no properties`);
    for (const [prop, p] of Object.entries(t.properties)) {
      assert.equal(typeof p.description, 'string');
      assert.ok(p.description.trim().length > 0, `tool "${t.name}" property "${prop}" lacks a description`);
    }
  }
});

test('enum properties list at least two values; bounds are sane', () => {
  for (const t of TOOLS) {
    for (const [prop, p] of Object.entries(t.properties)) {
      if (p.type === 'enum') {
        assert.ok(Array.isArray(p.values) && p.values.length >= 2, `tool "${t.name}" enum "${prop}" needs values`);
        assert.ok(p.values.every(v => typeof v === 'string' && v.length > 0));
      }
      if (p.type === 'number') {
        assert.ok(!(p.integer && p.min !== undefined && p.min % 1 !== 0));
        if (p.min !== undefined && p.max !== undefined) assert.ok(p.min <= p.max);
      }
      assert.ok(['string', 'number', 'boolean', 'enum'].includes(p.type), `tool "${t.name}" property "${prop}" has unknown type`);
    }
  }
});

test('required lists only declared properties, with no duplicates', () => {
  for (const t of TOOLS) {
    for (const req of t.required) {
      assert.ok(Object.hasOwn(t.properties, req), `tool "${t.name}" requires undeclared property "${req}"`);
    }
    assert.equal(new Set(t.required).size, t.required.length);
  }
});

test('each tool backs onto a GET operation documented in the OpenAPI spec', () => {
  const spec = fetchSpec();
  for (const t of TOOLS) {
    assert.match(t.endpoint, /^\/api\//, `tool "${t.name}" endpoint must be an /api/ path`);
    assert.ok(spec.paths[t.endpoint]?.get, `tool "${t.name}" endpoint "${t.endpoint}" is not a documented GET operation`);
  }
});

test('tool parameters map onto documented API query parameters', () => {
  const spec = fetchSpec();
  for (const t of TOOLS) {
    const apiParams = specParamNames(spec, t.endpoint);
    const exceptions = new Set(t.apiParamExceptions || []);
    for (const prop of Object.keys(t.properties)) {
      if (exceptions.has(prop)) continue;
      assert.ok(
        apiParams.has(prop),
        `tool "${t.name}" parameter "${prop}" is not a documented query parameter of ${t.endpoint}`
      );
    }
  }
});

test('toolDef resolves known tools and rejects unknown ones', () => {
  assert.equal(toolDef('compute_inference').name, 'compute_inference');
  assert.throws(() => toolDef('nope'), /unknown MCP tool/);
});
