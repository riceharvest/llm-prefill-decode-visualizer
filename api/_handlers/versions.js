// GET /api/versions — machine-readable version discovery for agents (#685).
// Answers "which contract versions/prefixes are currently served, and is my
// pinned prefix still frozen?" programmatically. Mirrors the promise made in
// /api/spec info.description that breaking changes ship under a new prefix
// with the previous one kept ≥90 days, announced via Deprecation/Sunset.
// Additive endpoint; see api/_versions.js for the underlying registry.
import { sendJson } from '../_schema.js';
import { API_VERSIONS } from '../_versions.js';

export const config = { runtime: 'nodejs' };

export default function handler(req, res) {
  return sendJson(res, {
    description:
      'Version discovery: every served URL prefix with its wire schemaVersion and lifecycle status. Hardening guidance: pin a prefix whose status is "current"; when a prefix turns "deprecated", migrate before its Sunset date (responses on that prefix also carry Deprecation/Sunset headers).',
    generatedAt: new Date().toISOString(),
    current: '/api',
    // NOTE: field spelling is deliberately `schema_version` (snake_case) to
    // match the universal stamp sendJson() puts on every response body —
    // exactly one spelling per body (#700 class of bug).
    versions: API_VERSIONS.map((v) => ({
      prefix: v.prefix,
      schema_version: v.schemaVersion,
      status: v.status,
      canonical: !!v.canonical,
      deprecatedAt: v.deprecatedAt,
      sunset: v.sunset
    })),
    links: {
      spec: '/api/spec',
      changelogMarkdown: '/CHANGELOG-API.md',
      changelogJson: '/CHANGELOG.json'
    }
  }, { cacheTtl: 300 });
}
