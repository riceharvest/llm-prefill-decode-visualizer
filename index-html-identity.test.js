// #702 — index.html head identity script rewrites canonical/og:url to the
// actual deep-link URL and ?title= into the titles. Evaluates the inline
// script from index.html against a minimal mock DOM.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(root, 'index.html'), 'utf8');

function makeEnv(href) {
  const elements = {
    canonical: { attrs: { href: 'https://llm-prefill-decode-visualizer.vercel.app/' }, setAttribute(k, v) { this.attrs[k] = v; } },
    ogUrl: { attrs: { content: 'https://llm-prefill-decode-visualizer.vercel.app/' }, setAttribute(k, v) { this.attrs[k] = v; } },
    ogTitle: { attrs: { content: 'LLM Prefill & Decode Speed Visualizer' }, setAttribute(k, v) { this.attrs[k] = v; } }
  };
  const document = {
    title: 'static',
    querySelector(sel) {
      if (sel === 'link[rel="canonical"]') return elements.canonical;
      if (sel === 'meta[property="og:url"]') return elements.ogUrl;
      if (sel === 'meta[property="og:title"]') return elements.ogTitle;
      return null;
    }
  };
  const location = new URL(href);
  const fn = new Function('document', 'location', scriptSource());
  return { document, run: () => fn(document, location), el: elements };
}

function scriptSource() {
  // Extract the identity-rewrite IIFE (the plain <script> block that rewrites
  // the canonical/og:url tags; the #702 marker sits in its HTML comment).
  const blocks = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
  const src = blocks.find(s => s.includes('rel="canonical"'));
  assert.ok(src, 'identity script not found in index.html');
  return src;
}

test('canonical + og:url follow the actual deep-link URL (#702)', () => {
  const env = makeEnv('https://llm-prefill-decode-visualizer.vercel.app/?tab=agentic&preset=rtx4090_exl2&prompt=8192');
  env.run();
  const want = 'https://llm-prefill-decode-visualizer.vercel.app/?tab=agentic&preset=rtx4090_exl2&prompt=8192';
  assert.equal(env.el.canonical.attrs.href, want);
  assert.equal(env.el.ogUrl.attrs.content, want);
});

test('?title= reaches document.title and og:title', () => {
  const env = makeEnv('https://llm-prefill-decode-visualizer.vercel.app/?tab=single&title=My+Share+Title');
  env.run();
  assert.match(env.document.title, /^My Share Title — /);
  assert.equal(env.el.ogTitle.attrs.content, 'My Share Title');
});

test('root URL without title keeps the static defaults', () => {
  const env = makeEnv('https://llm-prefill-decode-visualizer.vercel.app/');
  env.run();
  assert.equal(env.document.title, 'static');
  assert.equal(env.el.canonical.attrs.href, 'https://llm-prefill-decode-visualizer.vercel.app/');
});

test('the static fallback tags still exist for no-JS crawlers', () => {
  assert.match(html, /<link rel="canonical" href=/);
  assert.match(html, /<meta property="og:url" content=/);
});
