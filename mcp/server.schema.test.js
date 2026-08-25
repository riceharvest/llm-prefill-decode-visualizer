import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// #614: the repo stdio MCP server's compute_inference input schema must accept
// every /api/compute workload family. The module starts a stdio transport at
// import time (and zod lives in the package's own node_modules), so these are
// source-contract tests over server.js instead of a runtime import.
const SOURCE = readFileSync(
  fileURLToPath(new URL('./server.js', import.meta.url)),
  'utf8'
);

/** Extract the compute_inference tool's schema block from the source. */
function computeInferenceBlock() {
  const start = SOURCE.indexOf("'compute_inference'");
  assert.ok(start > 0, 'compute_inference tool registered');
  const end = SOURCE.indexOf('search_runs', start);
  return SOURCE.slice(start, end);
}

test('#614: model enum includes flagged and cost', () => {
  const m = computeInferenceBlock().match(/model:\s*z\.enum\(\[([^\]]+)\]\)/);
  assert.ok(m, 'model enum found');
  const values = m[1].split(',').map(s => s.trim().replace(/'/g, ''));
  for (const required of ['singleTurn', 'speculative', 'batched', 'agentic', 'kvCache', 'flagged', 'cost']) {
    assert.ok(values.includes(required), `enum should include ${required}, got ${values.join('|')}`);
  }
});

test('#614: agentic workload params are declared (not silently ignored)', () => {
  const block = computeInferenceBlock();
  for (const param of ['numTurns', 'basePromptTokens', 'toolOutputTokensPerTurn', 'decodeTokensPerTurn', 'enablePrefixCaching']) {
    assert.ok(block.includes(`${param}:`), `schema should declare ${param}`);
  }
});

test('#614: cost-model inputs are declared', () => {
  const block = computeInferenceBlock();
  for (const param of ['hardwarePriceUsd', 'electricityRatePerKwh', 'powerDrawWatts', 'amortizationMonths']) {
    assert.ok(block.includes(`${param}:`), `schema should declare ${param}`);
  }
});

test('#614: flagged engine-flags param is declared and forwarded to /api/compute', () => {
  const block = computeInferenceBlock();
  assert.match(block, /flags:\s*z\.string\(\)/);
  // The handler passes args straight through to the REST endpoint.
  assert.match(block, /apiGet\('\/api\/compute', args\)/);
});
