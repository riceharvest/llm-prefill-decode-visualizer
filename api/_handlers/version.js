// GET /api/version — machine-readable version report for agents and clients.
// Answers "what am I talking to?" in one cheap, cache-friendly call:
//   - service name + app `version` (from package.json),
//   - the wire `schema_version` stamped on every JSON response by sendJson()
//     (SCHEMA_VERSION in api/_schema.js — the number that actually matters
//     for API compatibility). Exactly ONE spelling of the field (#700): the
//     universal snake_case stamp; this handler adds no alias.
//   - links to version discovery (/api/versions), the OpenAPI spec and both
//     changelog surfaces (markdown + JSON).
// Additive endpoint; no existing fields changed. See CHANGELOG.json.
import { readFileSync } from 'node:fs';
import { sendJson } from '../_schema.js';

export const config = { runtime: 'nodejs' };

/** Resolve the app release version with a fallback chain (#575): package.json
 *  first, then clients/VERSION, then 'unknown'. Exported so the version test
 *  can pin the exact resolution contract. Never throws. */
export function resolveAppVersion(repoRoot = new URL('../../', import.meta.url)) {
  let packageVersion = null;
  try {
    packageVersion = JSON.parse(readFileSync(new URL('package.json', repoRoot), 'utf8')).version || null;
  } catch { /* keep null */ }
  if (packageVersion && packageVersion !== '0.0.0') {
    return { version: packageVersion, packageVersion };
  }
  try {
    const clientsVersion = readFileSync(new URL('clients/VERSION', repoRoot), 'utf8').split('\n')[0].trim();
    if (clientsVersion) return { version: clientsVersion, packageVersion };
  } catch { /* keep fallback */ }
  return { version: packageVersion || 'unknown', packageVersion };
}

/** App version; 'unknown' if unreadable so the endpoint never 500s over metadata. */
function appVersion() {
  return resolveAppVersion().version;
}

export default function handler(req, res) {
  const { version, packageVersion } = resolveAppVersion();
  return sendJson(res, {
    description: 'Version report: app release version plus the wire schema_version stamped on every /api/* JSON response (single spelling — see /api/versions for per-prefix discovery). Breaking schema changes bump schema_version (see CHANGELOG-API.md policy). `version` falls back to the API release version (clients/VERSION) when package.json carries an unset placeholder; packageVersion echoes the raw package.json field (#575).',
    service: 'llm-prefill-decode-visualizer',
    version,
    ...(packageVersion && packageVersion !== version ? { packageVersion } : {}),
    generatedAt: new Date().toISOString(),
    links: {
      spec: '/api/spec',
      versions: '/api/versions',
      changelogMarkdown: '/CHANGELOG-API.md',
      changelogJson: '/CHANGELOG.json'
    }
  }, { cacheTtl: 300 });
}
