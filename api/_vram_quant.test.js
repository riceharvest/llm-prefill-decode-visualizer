// Quant-vocabulary + MoE name-parsing correctness (#882, #1073) and a
// spec-x-example vs live-wire drift guard for /api/vram (#1113).
//
// #882 — the old /^q4[_ ]?1?$/ row could never match the advertised 'q4_0'
//        tag and mislabeled every q4_1 request as 'q4_0'.
// #1073 — guessArchFromName had no notion of MoE naming: "Mixtral-8x7B"
//         parsed as 7B (6.7× low) and "Qwen1.5-MoE-A2.7B" took its ACTIVE
//         params tag as total size (~5× low).
// #1113 — /api/spec's /api/vram x-example documented values ~13% below what
//        the endpoint actually returns; this test now pins example ≡ wire.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const { resolveQuant, QUANT_ENUM } = await import(path.join(here, '_quant.js'));
const { guessArchFromName } = await import(path.join(here, '_hflookup.js'));

// ---- #882: quant vocabulary resolves advertised tags exactly ---------------

test('resolveQuant matches the advertised q4_0 tag at 4.55 bpw', () => {
  const r = resolveQuant('q4_0');
  assert.equal(r.key, 'q4_0');
  assert.equal(r.bpw, 4.55);
  assert.equal(r.assumed, false);
});

test('resolveQuant keeps q4_1 as its own canonical key (not q4_0)', () => {
  const r = resolveQuant('q4_1');
  assert.equal(r.key, 'q4_1');
  assert.equal(r.bpw, 4.55);
  assert.equal(r.assumed, false);
});

test('resolveQuant still accepts loose q4 spellings and known tags', () => {
  assert.equal(resolveQuant('q4').key, 'q4_0');
  assert.equal(resolveQuant('q4 k m').key, 'q4_k_m');
  assert.equal(resolveQuant('q4_k_m').bpw, 4.85);
});

test('unknown tags stay flagged as assumed', () => {
  const r = resolveQuant('garbage123');
  assert.equal(r.assumed, true);
  assert.equal(r.bpw, 4.85);
});

test('QUANT_ENUM enumerates the resolvable vocabulary for discovery', () => {
  assert.ok(QUANT_ENUM.includes('q4_0'));
  assert.ok(QUANT_ENUM.includes('q4_1'));
  assert.ok(QUANT_ENUM.includes('q4_k_m'));
  for (const key of QUANT_ENUM) {
    assert.equal(resolveQuant(key).key, key, `${key} should resolve to itself`);
    assert.equal(resolveQuant(key).assumed, false, `${key} should not be flagged assumed`);
  }
});

// ---- #1073: MoE-aware name parsing -----------------------------------------

test('expert-count x expert-size ids estimate TOTAL params (product)', () => {
  const g = guessArchFromName('mistralai/Mixtral-8x7B-Instruct-v0.1');
  assert.ok(g, 'should parse');
  assert.equal(g.paramsTotal, 56_000_000_000); // 8 × 7B, not 7B
  assert.equal(g.moe, true);
  assert.match(g.weightsSource, /≈ 56B total/);
});

test('active-params-only MoE ids are reported as an explicit LOWER bound', () => {
  const g = guessArchFromName('Qwen/Qwen1.5-MoE-A2.7B');
  assert.ok(g, 'should parse');
  assert.equal(g.paramsTotal, 2_700_000_000); // active tag, but flagged
  assert.equal(g.moe, true);
  assert.match(g.notes[0], /LOWER bound/i);
  assert.match(g.weightsSource, /LOWER BOUND/i);
});

test('dense-first tags win over later active tags (Qwen3-30B-A3B stays 30B)', () => {
  const g = guessArchFromName('org/Foo-30B-A3B');
  assert.equal(g.paramsTotal, 30_000_000_000);
  assert.equal(g.moe, undefined);
});

test('dense names keep their existing behavior', () => {
  assert.equal(guessArchFromName('org/Foo-8B-chat').paramsTotal, 8_000_000_000);
  assert.equal(guessArchFromName('org/Tiny-1.5B').paramsTotal, 1_500_000_000);
  assert.equal(guessArchFromName('org/no-size-here'), null);
  assert.equal(guessArchFromName('org/v2-final'), null);
});

// ---- #1113: spec x-example must equal the live wire response ---------------

async function call(url) {
  const chunks = [];
  const res = {
    statusCode: 200,
    setHeader() {}, getHeader() { return undefined; }, removeHeader() {},
    hasHeader() { return false; },
    end(b) { chunks.push(String(b)); }
  };
  const { default: handler } = await import(path.join(here, '[...path].js'));
  const u = new URL(url, 'https://unit.test');
  await handler({ method: 'GET', url, query: Object.fromEntries(u.searchParams.entries()) }, res);
  return JSON.parse(chunks.join(''));
}

test('/api/spec vram x-example is byte-faithful to the live response (#1113)', async () => {
  const spec = await call('/api/spec');
  const example = spec.paths['/api/vram']?.get?.['x-examples']?.response;
  assert.ok(example, 'x-examples.response present for GET /api/vram');

  // The documented call must be executable and produce exactly the documented body.
  assert.match(
    spec.paths['/api/vram'].get['x-examples'].request,
    /hfId=meta-llama\/Llama-3\.1-8B-Instruct&context=65536&quant=q4_k_m&vramGb=24/
  );
  const live = await call('/api/vram?hfId=meta-llama/Llama-3.1-8B-Instruct&context=65536&quant=q4_k_m&vramGb=24');
  assert.deepEqual(live, example);
});

test('/api/spec exposes the machine-readable quant enum on /api/vram (#882)', async () => {
  const spec = await call('/api/spec');
  const param = spec.paths['/api/vram'].get.parameters.find((p) => p.name === 'quant');
  assert.ok(param, 'quant param documented');
  assert.deepEqual(param.schema.enum, QUANT_ENUM);
  assert.ok(param.schema.enum.includes('q4_0'), 'advertised q4_0 in enum');
});
