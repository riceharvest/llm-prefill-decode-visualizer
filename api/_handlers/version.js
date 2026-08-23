// GET /api/version — machine-readable version report for agents and clients.
// Answers "what am I talking to?" in one cheap, cache-friendly call:
//   - service name + app `version` (from package.json),
//   - `schemaVersion`: the wire schema_version stamped on every JSON response
//     (SCHEMA_VERSION in api/_schema.js — the number that actually matters
//     for API compatibility),
//   - links to the OpenAPI spec and both changelog surfaces (markdown + JSON).
// Additive endpoint; no existing fields changed. See CHANGELOG.json.
import { readFileSync } from 'node:fs';
import { sendJson, SCHEMA_VERSION } from '../_schema.js';

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
    description: 'Version report: app release version plus the wire schema_version stamped on every /api/* JSON response. Breaking schema changes bump schemaVersion (see CHANGELOG-API.md policy).',
    service: 'llm-prefill-decode-visualizer',
    version: appVersion(),
    schemaVersion: SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    links: {
      spec: '/api/spec',
      changelogMarkdown: '/CHANGELOG-API.md',
      changelogJson: '/CHANGELOG.json'
    }
  }, { cacheTtl: 300 });
}
