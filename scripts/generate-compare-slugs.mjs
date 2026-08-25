// Generates public/compare-hardware-slugs.json — the authoritative set of
// hardware slugs for which /compare/:a-vs-:b pages exist (issues #757/#759).
//
// Consumers:
//   - middleware.js reads it at request time to answer invalid compare pairs
//     with a real HTTP 404 instead of a 200 soft-404 shell;
//   - agents can fetch /compare-hardware-slugs.json to enumerate/validate the
//     whole comparison URL space without executing JS (companion to the
//     `slug` field now exposed by /api/benchmarks?groupBy=hardware).
//
// Live mode pulls every hardware group from /api/benchmarks?groupBy=hardware
// (same source of truth as the compare page itself); on failure falls back to
// the same curated seed list as generate-sitemap.mjs so `npm run build` never
// breaks just because the API is unreachable.
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { slugify } from '../src/utils/compareSlug.js';

const SITE_URL = (process.env.SITE_URL || 'https://llm-prefill-decode-visualizer.vercel.app').replace(/\/+$/, '');
const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'compare-hardware-slugs.json');

// High-intent fallback when the benchmarks API can't be reached at build time.
const SEED_SLUGS = [
  'rtx-3090', 'rtx-4090', 'rtx-5090', 'rtx-3060', 'rtx-4060',
  'm3-max', 'm4-pro', 'h100', 'a100', '4070-ti-super',
];

async function fetchAllHardwareSlugs() {
  const url = `${SITE_URL}/api/benchmarks?groupBy=hardware&limit=200`;
  const res = await fetch(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  const items = data.items || [];
  if (!items.length) throw new Error('no hardware groups returned');
  // Prefer the API's own slug fields (#757); fall back to recomputing them
  // exactly the way the compare page does (slugify of bestRun label/key).
  return items
    .map(g => g.slug || slugify(g.bestRun?.hardware || g.key))
    .filter(Boolean);
}

async function main() {
  let slugs = [];
  let source = 'live';
  try {
    slugs = await fetchAllHardwareSlugs();
  } catch (err) {
    source = 'seed-fallback';
    console.warn(`[compare-slugs] live fetch failed (${err.message}); using curated seed list`);
    slugs = SEED_SLUGS;
  }
  slugs = [...new Set(slugs)].sort();

  const manifest = {
    description: 'Hardware slugs for which /compare/:slugA-vs-:slugB pages exist. Any pair of these slugs joined with -vs- is a valid comparison URL; anything else returns HTTP 404. Regenerated at build time from /api/benchmarks?groupBy=hardware.',
    generatedAt: new Date().toISOString(),
    source,
    count: slugs.length,
    slugs,
  };
  writeFileSync(OUT, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`[compare-slugs] wrote ${slugs.length} slugs (${source}) -> ${OUT}`);
}

main().catch(err => {
  // Never break the build over SEO niceties — but keep any previous manifest.
  console.warn(`[compare-slugs] skipped: ${err.message}`);
});
