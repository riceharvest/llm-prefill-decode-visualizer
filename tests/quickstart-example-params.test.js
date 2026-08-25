// #595 + #600 — AGENT-QUICKSTART.md shipped examples with nonexistent param
// names (prefillTps/decodeTps on /api/compute; model=llama3.1&contextLength=&
// precision= on /api/vram). The doc-existence test only checked route paths,
// so the drift went unnoticed. This file validates that the doc's "Inference
// math" examples use parameter names the handlers actually honor.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const doc = readFileSync(join(root, 'docs', 'AGENT-QUICKSTART.md'), 'utf8');

/** Pull query params out of every `/api/<name>?<query>` URL in the doc. */
function docParams(endpoint) {
  const re = new RegExp('GET /api/' + endpoint + '\\?([^\\s\\)\\\\`]+)', 'g');
  const out = [];
  for (const m of doc.matchAll(re)) {
    out.push(Object.fromEntries(new URLSearchParams(m[1])));
  }
  return out;
}

const { computeBody } = await import(join(root, 'api', '_handlers', 'compute.js'));

test('#595: the compute example\'s prefillSpeed/decodeSpeed are honored, not dropped', () => {
  const examples = docParams('compute').filter(p => p.model === 'singleTurn');
  assert.ok(examples.length, 'quickstart should contain a singleTurn compute example');
  for (const params of examples) {
    assert.equal(params.prefillTps, undefined, 'phantom param prefillTps still in docs');
    assert.equal(params.decodeTps, undefined, 'phantom param decodeTps still in docs');
    if (!params.dry_run && !params.dryRun) continue; // only execute echo-safe ones
    const out = computeBody(params);
    assert.equal(out.status, 200);
    // The requested speeds must reach the resolved inputs verbatim.
    assert.equal(String(out.body.inputs?.prefillSpeed), String(Number(params.prefillSpeed)));
    assert.equal(String(out.body.inputs?.decodeSpeed), String(Number(params.decodeSpeed)));
  }
});

test('#600: the vram example targets an org/model id with real param names', () => {
  const examples = docParams('vram');
  assert.ok(examples.length, 'quickstart should contain a vram example');
  for (const p of examples) {
    const hfId = p.hfId ?? p.model ?? p.repo;
    assert.match(hfId || '', /^[^/]+\/.+/, 'vram example must pass an org/model-shaped id');
    assert.equal(p.precision, undefined, 'phantom param precision= still in docs');
    assert.equal(p.contextLength, undefined, 'use context= (contextLength silently ignored)');
    assert.ok(p.context, 'vram example should set context=');
    assert.ok(p.quant ?? p.q, 'vram example should make the weight quant explicit');
  }
});

test('#600: every param name used by vram examples appears in the handler\'s accepted set', async () => {
  const { default: handler } = await import(join(root, 'api', '_handlers', 'vram.js'));
  // The bare index echoes its accepted parameter documentation.
  const res = {
    statusCode: 0, headers: {}, body: null,
    setHeader() {}, status(c) { this.statusCode = c; return this; },
    end(b) { this.body = b ? JSON.parse(b) : null; }
  };
  await handler({ method: 'GET', query: {} }, res);
  const accepted = JSON.stringify(res.body);
  for (const p of docParams('vram')) {
    for (const name of Object.keys(p)) {
      assert.ok(accepted.includes(name), `doc param '${name}' not offered by /api/vram`);
    }
  }
});
