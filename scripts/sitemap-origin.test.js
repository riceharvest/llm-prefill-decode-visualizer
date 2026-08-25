import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveSiteUrl, withSitemapDirective } from './site-origin.mjs';

const PROD = 'https://llm-prefill-decode-visualizer.vercel.app';

test('resolveSiteUrl: SITE_URL override wins, trailing slashes stripped (#925)', () => {
  assert.equal(
    resolveSiteUrl({ SITE_URL: 'https://example.com/', VERCEL_PROJECT_PRODUCTION_URL: 'prod.vercel.app' }),
    'https://example.com'
  );
});

test('resolveSiteUrl: falls back to Vercel-provided hosts without https prefix', () => {
  assert.equal(resolveSiteUrl({ VERCEL_PROJECT_PRODUCTION_URL: 'my-site.vercel.app' }), 'https://my-site.vercel.app');
  assert.equal(resolveSiteUrl({ VERCEL_URL: 'preview-abc123.vercel.app' }), 'https://preview-abc123.vercel.app');
  assert.equal(
    resolveSiteUrl({ VERCEL_PROJECT_PRODUCTION_URL: 'prod.vercel.app', VERCEL_URL: 'preview.vercel.app' }),
    'https://prod.vercel.app',
    'production host beats per-deployment host'
  );
});

test('resolveSiteUrl: defaults to the production origin when nothing set', () => {
  assert.equal(resolveSiteUrl({}), PROD);
});

test('withSitemapDirective replaces a hardcoded Sitemap line in place', () => {
  const robots = [
    'User-agent: *',
    'Allow: /',
    '',
    'Agent-Endpoints: /api/spec',
    '',
    `Sitemap: ${PROD}/sitemap.xml`,
    ''
  ].join('\n');
  const out = withSitemapDirective(robots, 'https://selfhost.example');
  assert.match(out, /^Sitemap: https:\/\/selfhost\.example\/sitemap\.xml$/m);
  assert.doesNotMatch(out, new RegExp(PROD.replace(/\./g, '\\.')));
  assert.match(out, /^Agent-Endpoints: \/api\/spec$/m, 'other directives untouched');
});

test('withSitemapDirective appends when the directive is missing', () => {
  const out = withSitemapDirective('User-agent: *\nAllow: /\n', 'https://selfhost.example');
  assert.match(out, /Sitemap: https:\/\/selfhost\.example\/sitemap\.xml$/);
});
