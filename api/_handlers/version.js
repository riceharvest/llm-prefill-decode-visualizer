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

/** App version from package.json; 'unknown' if unreadable (e.g. a deploy
 *  bundle without it) so the endpoint never 500s over metadata. */
function appVersion() {
  try {
    const pkg = JSON.parse(
      readFileSync(new URL('../../package.json', import.meta.url), 'utf8')
    );
    return pkg.version || 'unknown';
  } catch {
    return 'unknown';
  }
}

export default function handler(req, res) {
  return sendJson(res, {
    description: 'Version report: app release version plus the wire schema_version stamped on every /api/* JSON response (single spelling — see /api/versions for per-prefix discovery). Breaking schema changes bump schema_version (see CHANGELOG-API.md policy).',
    service: 'llm-prefill-decode-visualizer',
    version: appVersion(),
    generatedAt: new Date().toISOString(),
    links: {
      spec: '/api/spec',
      versions: '/api/versions',
      changelogMarkdown: '/CHANGELOG-API.md',
      changelogJson: '/CHANGELOG.json'
    }
  }, { cacheTtl: 300 });
}
