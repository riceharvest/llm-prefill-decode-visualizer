// Generates public/sitemap.xml listing /compare/:a-vs-:b URLs (issue #107),
// plus the agent-facing discovery surfaces (issue #363) so crawlers/agents that
// read the sitemap learn the full API surface, not just the human pages.
//
// Live mode: pulls the current hardware groups from /api/benchmarks and emits
// every pairwise combination of the top-N hardware by median decode speed.
// Offline/failure mode: falls back to a curated seed list of high-intent
// pairs so `npm run build` never fails just because the API is unreachable.
//
// Base URL comes from SITE_URL; defaults to the Vercel project URL — override
// in CI/prod (e.g. SITE_URL=https://example.com npm run build) once the real
// domain is pinned down. Sitemap URLs must be absolute.
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

export const DEFAULT_SITE_URL = 'https://llm-prefill-decode-visualizer.vercel.app';
const SITE_URL = resolveSiteUrl(process.env);

/**
 * Base origin for sitemap/robots URLs (#925). Env-overridable so self-hosted
 * deployments regenerate discovery artifacts bound to THEIR host instead of
 * funnelling crawlers at production. Exported pure for tests.
 */
export function resolveSiteUrl(env = process.env) {
  return String(env.SITE_URL || DEFAULT_SITE_URL).replace(/\/+$/, '');
}

/**
 * The robots.txt `Sitemap:` line for a given base origin (#925). The rest of
 * robots.txt is static; only this directive bakes in the host.
 */
export function robotsSitemapLine(siteUrl = SITE_URL) {
  return `Sitemap: ${siteUrl}/sitemap.xml`;
}

/** Rewrite only the `Sitemap:` line of public/robots.txt to match SITE_URL. */
export function syncRobotsSitemapLine(siteUrl = SITE_URL, {
  read = (f) => readFileSync(f, 'utf8'),
  write = (f, c) => writeFileSync(f, c),
  robotsPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'robots.txt'),
} = {}) {
  const content = read(robotsPath);
  const line = robotsSitemapLine(siteUrl);
  if (/^Sitemap: /m.test(content)) {
    write(robotsPath, content.replace(/^Sitemap: .*$/m, line));
  } else {
    write(robotsPath, content.replace(/\n*$/, `\n\n${line}\n`));
  }
}

const TOP_N = 10;
const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'sitemap.xml');

// High-intent fallback pairs when the benchmarks API can't be reached at
// build time (CI sandboxes, local offline builds).
const SEED_SLUGS = [
  'rtx-3090', 'rtx-4090', 'rtx-5090', 'rtx-3060', 'rtx-4060',
  'm3-max', 'm4-pro', 'h100', 'a100', '4070-ti-super',
];

function slugify(text) {
  return String(text ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

async function fetchTopSlugs() {
  const url = `${SITE_URL}/api/benchmarks?groupBy=hardware&limit=200`;
  const res = await fetch(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  const items = data.items || [];
  return [...items]
    .sort((a, b) => (b.decode?.median || 0) - (a.decode?.median || 0))
    .map(g => slugify(g.bestRun?.hardware || g.key))
    .filter(Boolean)
    .slice(0, TOP_N);
}

async function main() {
  let slugs = [];
  let source = 'live';
  try {
    slugs = await fetchTopSlugs();
    if (slugs.length < 2) throw new Error('not enough hardware groups returned');
  } catch (err) {
    source = 'seed-fallback';
    console.warn(`[sitemap] live fetch failed (${err.message}); using curated seed pairs`);
    slugs = SEED_SLUGS;
  }

  const pairs = [];
  for (let i = 0; i < slugs.length; i++) {
    for (let j = i + 1; j < slugs.length; j++) {
      pairs.push(`/compare/${slugs[i]}-vs-${slugs[j]}`);
    }
  }

  // Agent-facing discovery surfaces (issue #363). Kept in sync with
  // api/_route_table.js and the <head> links in index.html. These are
  // static/always-on; the dynamic /compare pairs are computed below.
  const AGENT_PATHS = [
    '/llms.txt',
    '/agents.json',
    '/api/spec',
    '/api/agent/index.json',
    '/.well-known/mcp.json',
  ];

  const paths = ['/', ...AGENT_PATHS, ...pairs];
  const lastmod = new Date().toISOString().slice(0, 10);
  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...paths.map(p => `  <url><loc>${SITE_URL}${p === '/' ? '/' : p}</loc><lastmod>${lastmod}</lastmod></url>`),
    '</urlset>',
    '',
  ].join('\n');

  writeFileSync(OUT, xml);
  syncRobotsSitemapLine();
  console.log(`[sitemap] wrote ${paths.length} URLs (${source}) -> ${OUT}`);
}

// Run only when executed directly (node scripts/generate-sitemap.mjs), so
// tests can import the pure helpers without triggering a build.
const isDirectRun = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isDirectRun) {
  main().catch(err => {
    // Never break the build over SEO niceties.
    console.warn(`[sitemap] skipped: ${err.message}`);
  });
}
