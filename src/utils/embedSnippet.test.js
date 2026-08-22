import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildEmbedHtml,
  buildEmbedIframe,
  buildEmbedMarkdown,
  escapeHtmlAttr
} from './embedSnippet.js';

const FAKE_URI = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==';
const RUN_URL = 'https://example.app/?sprompt=1500&autoplay=1';
// In attribute position `&` is escaped to `&amp;` (valid HTML; browsers
// decode it back to `&` when reading the attribute).
const RUN_URL_ESCAPED = 'https://example.app/?sprompt=1500&amp;autoplay=1';

test('escapeHtmlAttr neutralizes attribute-breaking characters', () => {
  assert.equal(escapeHtmlAttr('a"b<c>d&e'), 'a&quot;b&lt;c&gt;d&amp;e');
});

test('buildEmbedHtml inlines the data-URI in a self-contained img', () => {
  const html = buildEmbedHtml({ dataUri: FAKE_URI, sourceUrl: RUN_URL, width: 640, height: 360, alt: 'waterfall' });
  assert.ok(html.includes(`<img src="${FAKE_URI}"`), 'img carries the data-URI');
  assert.ok(html.includes('width="640"'), 'explicit width');
  assert.ok(html.includes('height="360"'), 'explicit height');
  assert.ok(html.includes('alt="waterfall"'), 'alt text');
  assert.ok(html.includes(`href="${RUN_URL_ESCAPED}"`), 'links to the shared run URL for attribution');
  assert.ok(html.includes('rel="noopener"'), 'noopener on the outbound link');
  assert.ok(!html.includes('<script'), 'no script — paste-safe anywhere');
});

test('buildEmbedHtml without a source URL still renders the bare img', () => {
  const html = buildEmbedHtml({ dataUri: FAKE_URI });
  assert.ok(html.includes(`<img src="${FAKE_URI}"`));
  assert.ok(!html.includes('href='), 'no anchor without attribution URL');
});

test('buildEmbedHtml escapes quotes in alt text', () => {
  const html = buildEmbedHtml({ dataUri: FAKE_URI, alt: 'A "quoted" alt' });
  assert.ok(html.includes('alt="A &quot;quoted&quot; alt"'));
});

test('buildEmbedIframe points at the shared run URL, read-only', () => {
  const html = buildEmbedIframe({ sourceUrl: RUN_URL, width: 640, height: 360 });
  assert.ok(html.includes(`src="${RUN_URL_ESCAPED}"`));
  assert.ok(html.includes('width="640"'));
  assert.ok(html.includes('height="360"'));
  assert.ok(html.includes('title='), 'iframe needs a title for a11y');
  assert.ok(!html.includes('<script'), 'no script — the frame is the app itself');
});

test('buildEmbedMarkdown wraps the image in a link when a URL is given', () => {
  const md = buildEmbedMarkdown({ dataUri: FAKE_URI, sourceUrl: RUN_URL, alt: 'compare' });
  assert.equal(md, `[![compare](${FAKE_URI})](${RUN_URL})`);
});

test('buildEmbedMarkdown falls back to a bare image without a URL', () => {
  const md = buildEmbedMarkdown({ dataUri: FAKE_URI });
  assert.equal(md, `![LLM inference chart](${FAKE_URI})`);
});

test('buildEmbedMarkdown strips brackets from alt text so the link syntax survives', () => {
  const md = buildEmbedMarkdown({ dataUri: FAKE_URI, alt: 'a [b] c' });
  assert.ok(!md.includes('[b]'), 'brackets removed from alt');
});
