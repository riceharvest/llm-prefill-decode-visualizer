import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  shortModelName, shortQuant, formatTokenCountShort,
  describeConfig, slugifyTitle, permalinkHref,
  readPermalinkTitle, documentTitleFor
} from './permalink.js';
import { verifyShareLink } from './shareIntegrity.js';

test('shortModelName strips the org namespace and hyphens', () => {
  assert.equal(shortModelName('Qwen/Qwen3-32B'), 'Qwen3 32B');
  assert.equal(shortModelName('meta-llama/Llama-3.3-70B-Instruct'), 'Llama 3.3 70B Instruct');
  assert.equal(shortModelName('Mistral-7B'), 'Mistral 7B');
  assert.equal(shortModelName(''), '');
  assert.equal(shortModelName(undefined), '');
});

test('shortQuant keeps just the headline quant family', () => {
  assert.equal(shortQuant('Q4_K_M'), 'Q4');
  assert.equal(shortQuant('iq3_xs'), 'IQ3');
  assert.equal(shortQuant('EXL2 4.0bpw'), 'EXL2');
  assert.equal(shortQuant('FP8'), 'FP8');
  assert.equal(shortQuant(''), '');
});

test('formatTokenCountShort uses K notation above 1000', () => {
  assert.equal(formatTokenCountShort(8192), '8K');
  assert.equal(formatTokenCountShort(2048), '2K');
  assert.equal(formatTokenCountShort(1500), '1.5K');
  assert.equal(formatTokenCountShort(512), '512');
  assert.equal(formatTokenCountShort(NaN), '');
});

test('describeConfig builds a LocalMaxxing-style title', () => {
  assert.equal(
    describeConfig({
      presetId: 'rtx4090_exl2',
      modelId: 'Qwen/Qwen3-32B',
      quantization: 'Q4_K_M',
      promptTokens: 8192,
      activeTab: 'agentic'
    }),
    'Qwen3 32B Q4 on RTX 4090 24GB, 8K agentic loop'
  );
});

test('describeConfig falls back to preset hardware without a model', () => {
  assert.equal(
    describeConfig({ presetId: 'rtx3090_llamacpp', promptTokens: 2048, activeTab: 'single' }),
    'RTX 3090 24GB, 2K single turn'
  );
});

test('describeConfig trims engine suffixes and handles unknown tabs', () => {
  assert.equal(
    describeConfig({ presetId: 'dual_rtx3090', activeTab: 'kvcache' }),
    'Dual RTX 3090 48GB, KV cache sizing'
  );
  assert.equal(
    describeConfig({ hardwareLabel: 'Mac Studio M3 Ultra 192GB', activeTab: 'theory' }),
    'Mac Studio M3 Ultra 192GB, theory walkthrough'
  );
});

test('slugifyTitle produces readable slugs', () => {
  assert.equal(
    slugifyTitle('Qwen3 32B Q4 on RTX 4090, 8K agentic loop'),
    'qwen3-32b-q4-on-rtx-4090-8k-agentic-loop'
  );
  assert.equal(slugifyTitle('Groq LPU & H100 compare'), 'groq-lpu-and-h100-compare');
  assert.equal(slugifyTitle('---'), '');
  assert.ok(slugifyTitle('x'.repeat(200)).length <= 80);
});

test('permalinkHref appends the title param and integrity signature, with no dead hash fragment', async () => {
  const loc = { origin: 'https://example.com', pathname: '/', search: '?tab=agentic&preset=rtx4090_exl2&prefill=3800&decode=105' };
  const href = await permalinkHref(loc, 'Qwen3 32B on RTX 4090 24GB, 8K agentic loop');
  assert.ok(href.startsWith('https://example.com/?tab=agentic&preset=rtx4090_exl2&prefill=3800&decode=105&title='));
  // Issue #534: the app never resolves an element id under #s/, so share
  // links must not carry a #s/<slug> fragment — same computation must yield
  // byte-identical URLs for caching/dedup.
  assert.ok(!href.includes('#'));
  // The existing state params survive untouched.
  assert.ok(href.includes('decode=105'));
  // #917: a fresh link carries an integrity signature over its params.
  assert.match(href, /[?&]h=[0-9a-f]{12}(?!&)/);
});

test('permalinkHref signs deterministically and covers the title', async () => {
  const loc = { origin: 'https://example.com', pathname: '/x', search: '?preset=rtx3090_llamacpp' };
  const a = await permalinkHref(loc, 'RTX 3090, 2K single turn');
  const b = await permalinkHref(loc, 'RTX 3090, 2K single turn');
  const sig = h => h.match(/[?&]h=([0-9a-f]{12})/)[1];
  assert.equal(sig(a), sig(b)); // same params → same signature
  const c = await permalinkHref(loc, 'RTX 4090, 2K single turn'); // different title → different signature
  assert.notEqual(sig(a), sig(c));
});

test('permalinkHref replaces any stale signature from the source query', async () => {
  const loc = { origin: 'https://example.com', pathname: '/', search: '?tab=single&h=deadbeefdead' };
  const href = await permalinkHref(loc, 'Fresh title');
  const sigs = [...href.matchAll(/[?&]h=([0-9a-f]{12})/g)].map(m => m[1]);
  assert.equal(sigs.length, 1); // old `h` overwritten, not duplicated
  const search = '?' + href.slice(href.indexOf('?') + 1).split('#')[0];
  assert.equal((await verifyShareLink(search)).status, 'ok');
});

test('permalink round-trips through readPermalinkTitle', async () => {
  const loc = { origin: 'https://example.com', pathname: '/x', search: '' };
  const href = await permalinkHref(loc, 'RTX 3090, 2K single turn');
  const search = href.slice(href.indexOf('?')).split('#')[0];
  assert.equal(readPermalinkTitle(search), 'RTX 3090, 2K single turn');
  assert.equal(readPermalinkTitle(''), null);
});

test('document.title prefers shared titles over derived ones', () => {
  const brand = 'LLM Prefill & Decode Speed Visualizer';
  assert.equal(documentTitleFor('Shared run', 'Derived run', brand), 'Shared run');
  assert.equal(documentTitleFor(null, 'Derived run', brand), 'Derived run · ' + brand);
  assert.equal(documentTitleFor(null, '', brand), brand);
});

test('document.title ignores shared titles on tampered links (#917)', () => {
  const brand = 'LLM Prefill & Decode Speed Visualizer';
  assert.equal(documentTitleFor('Forged claim', 'Derived run', brand, true), 'Derived run · ' + brand);
  assert.equal(documentTitleFor('Shared run', 'Derived run', brand, false), 'Shared run');
});
