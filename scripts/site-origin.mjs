// Shared deploy-origin resolution for build-time generators (#925).
//
// robots.txt's Sitemap directive and sitemap.xml <loc>s must point at the
// deployment that serves them, not a hardcoded production origin. Priority:
//   1. SITE_URL            — explicit override (self-hosters, CI)
//   2. VERCEL_PROJECT_PRODUCTION_URL / VERCEL_URL — Vercel-provided host
//   3. Production default  — the canonical deployed site

const PROD_DEFAULT = 'https://llm-prefill-decode-visualizer.vercel.app';

/** Normalize a bare host or URL into an origin with no trailing slash. */
function normalizeOrigin(raw) {
  let v = String(raw || '').trim().replace(/\/+$/, '');
  if (!v) return '';
  if (!/^https?:\/\//i.test(v)) v = `https://${v}`;
  return v.replace(/\/+$/, '');
}

/**
 * Resolve the site origin from an env-like object. Exported pure so
 * node --test can cover the priority chain without touching process.env.
 */
export function resolveSiteUrl(env = process.env) {
  const chain = [
    env.SITE_URL,
    env.VERCEL_PROJECT_PRODUCTION_URL,
    env.VERCEL_URL,
    PROD_DEFAULT
  ];
  for (const candidate of chain) {
    const origin = normalizeOrigin(candidate);
    if (origin) return origin;
  }
  return PROD_DEFAULT;
}

/**
 * Rewrite the `Sitemap:` directive of a robots.txt body to the given
 * origin (idempotent; appends when the directive is missing). Exported
 * pure for tests.
 */
export function withSitemapDirective(robotsText, siteUrl) {
  const line = `Sitemap: ${siteUrl}/sitemap.xml`;
  const lines = String(robotsText ?? '').split('\n');
  let replaced = false;
  const out = lines.map(l => {
    if (/^sitemap:\s*/i.test(l)) {
      replaced = true;
      return line;
    }
    return l;
  });
  if (!replaced && out.length && out[out.length - 1].trim() !== '') out.push('');
  if (!replaced) out.push(line);
  return out.join('\n');
}
