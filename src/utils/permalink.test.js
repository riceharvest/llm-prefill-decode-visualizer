import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  shortModelName, shortQuant, formatTokenCountShort,
  describeConfig, buildShareLink, TRANSIENT_SHARE_PARAMS,
  permalinkHref, readPermalinkTitle, documentTitleFor
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

// The canonical share-link builder (#875): every emitter routes through it,
// so its output shape is pinned here.
test('buildShareLink pins tab, strips transient params and sorts keys', () => {
  const href = buildShareLink({
    origin: 'https://example.com',
    pathname: '/',
    search: '?tab=agentic&preset=rtx4090_exl2&prefill=3800&decode=105&autoplay=1&title=RTX%203090'
  });
  // Transient session keys never survive an emit…
  assert.ok(!href.includes('autoplay='));
  assert.ok(!href.includes('title='));
  // …tab is always present…
  assert.ok(href.startsWith('https://example.com/?'));
  const p = new URLSearchParams(href.slice(href.indexOf('?')));
  assert.equal(p.get('tab'), 'agentic');
  assert.equal(p.get('preset'), 'rtx4090_exl2');
  // …and keys are sorted so equal configs serialize identically.
  const qs = href.slice(href.indexOf('?') + 1);
  assert.deepEqual(qs.split('&').map(kv => kv.split('=')[0]), [...qs.split('&').map(kv => kv.split('=')[0])].sort());
});

test('buildShareLink overrides the input tab with the pinned one', () => {
  const href = buildShareLink({
    origin: 'https://example.com',
    pathname: '/',
    search: '?tab=single&preset=h100',
    tab: 'compare'
  });
  assert.equal(new URLSearchParams(href.slice(href.indexOf('?'))).get('tab'), 'compare');
});

test('buildShareLink can re-add autoplay for demo-style links', () => {
  const href = buildShareLink({
    origin: 'https://example.com',
    pathname: '/x',
    params: { tab: 'single', preset: 'h100', prompt: 8192, autoplay: '0' },
    autoplay: true
  });
  assert.ok(!href.includes('autoplay=0'));
  const p = new URLSearchParams(href.slice(href.indexOf('?')));
  assert.equal(p.get('autoplay'), '1');
  assert.equal(p.get('prompt'), '8192');
});

test('buildShareLink omits empty/blank params and the ? when nothing remains', () => {
  assert.equal(
    buildShareLink({ origin: 'https://example.com', pathname: '/', params: { prompt: '', preset: null, title: 'x' } }),
    'https://example.com/'
  );
});

// Issue #630: the Find HW tab's title must describe the constraint set the
// recipient lands on (?sd=&sv=&sm=&sq=), not simulator globals.
test('describeConfig describes shortlist constraints instead of sim state (#630)', () => {
  assert.equal(
    describeConfig({
      presetId: 'rtx4090_exl2',
      modelId: 'Qwen/Qwen3-32B',
      quantization: 'Q4_K_M',
      promptTokens: 8192,
      activeTab: 'shortlist',
      shortlist: { minDecode: '100', maxVramGb: '', model: '', quant: 'Q4_K_M' }
    }),
    'Q4 · ≥100 tok/s · hardware finder'
  );
});

test('shortlist title includes model + vram cap when constrained', () => {
  assert.equal(
    describeConfig({
      activeTab: 'shortlist',
      shortlist: { minDecode: '2500', maxVramGb: '24', model: 'meta-llama/Llama-3.3-70B-Instruct', quant: '' }
    }),
    'Llama 3.3 70B Instruct · ≥2500 tok/s · ≤24 GB · hardware finder'
  );
});

test('empty shortlist constraints still avoid naming unrelated sim state (#630)', () => {
  const title = describeConfig({
    presetId: 'rtx4090_exl2',
    promptTokens: 8192,
    activeTab: 'shortlist',
    shortlist: { minDecode: '', maxVramGb: '', model: '', quant: '' }
  });
  assert.equal(title, 'hardware finder');
  assert.ok(!title.includes('RTX'));
});

test('non-shortlist tabs ignore the shortlist constraints (back-compat)', () => {
  assert.equal(
    describeConfig({
      presetId: 'rtx4090_exl2',
      modelId: 'Qwen/Qwen3-32B',
      quantization: 'Q4_K_M',
      promptTokens: 8192,
      activeTab: 'agentic',
      shortlist: { minDecode: '100' }
    }),
    'Qwen3 32B Q4 on RTX 4090 24GB, 8K agentic loop'
  );
});

test('slugifyTitle produces readable slugs', () => {
  assert.equal(
    buildShareLink({ origin: 'https://example.com', pathname: '/', params: { prompt: '', preset: null, title: 'x' } }),
    'https://example.com/'
  );
});

test('permalinkHref appends the title param, slug hash and integrity signature', async () => {
  const loc = { origin: 'https://example.com', pathname: '/', search: '?tab=agentic&preset=rtx4090_exl2&prefill=3800&decode=105' };
  const href = await permalinkHref(loc, 'Qwen3 32B on RTX 4090 24GB, 8K agentic loop');
  assert.ok(href.startsWith('https://example.com/?tab=agentic&preset=rtx4090_exl2&prefill=3800&decode=105&title='));
  assert.ok(href.endsWith('#s/qwen3-32b-on-rtx-4090-24gb-8k-agentic-loop'));
  // The existing state params survive untouched.
  assert.ok(href.includes('decode=105'));
  // #917: a fresh link carries an integrity signature over its params.
  assert.match(href, /[?&]h=[0-9a-f]{12}#/);
});

test('permalinkHref signs deterministically and covers the title', async () => {
  const loc = { origin: 'https://example.com', pathname: '/x', search: '?preset=rtx3090_llamacpp' };
  const a = await permalinkHref(loc, 'RTX 3090, 2K single turn');
  const b = await permalinkHref(loc, 'RTX 3090, 2K single turn');
  const sig = h => h.match(/[?&]h=([0-9a-f]{12})#/)[1];
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
  const title = readPermalinkTitle(search);
  assert.equal(title, 'RTX 3090, 2K single turn');
});

test('buildShareLink is byte-identical for equal configs across emitters', () => {
  // Same state arriving as a query string (share/export) vs an explicit
  // object (demo links) must produce the same URL.
  const fromSearch = buildShareLink({
    origin: 'https://example.com', pathname: '/', search: '?preset=h100&tab=single&prefill=3900'
  });
  const fromParams = buildShareLink({
    origin: 'https://example.com', pathname: '/', params: { preset: 'h100', prefill: 3900, tab: 'single' }
  });
  assert.equal(fromSearch, fromParams);
  assert.equal(fromSearch, 'https://example.com/?prefill=3900&preset=h100&tab=single');
});

test('transient share params are exactly autoplay and title', () => {
  assert.deepEqual(TRANSIENT_SHARE_PARAMS, ['autoplay', 'title']);
});

test('readPermalinkTitle still decodes legacy title= links', () => {
  // Links minted before #875 carried a free-text `title` param; the reader
  // keeps those old URLs rendering their own document title.
  const search = '?preset=h100&title=' + encodeURIComponent('RTX 3090, 2K single turn');
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
