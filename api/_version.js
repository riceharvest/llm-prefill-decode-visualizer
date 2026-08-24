/**
 * Single source of truth for the API *release* version (issue #880).
 *
 * Three surfaces used to self-report three different release versions:
 *   - /api/spec  info.version        → hardcoded "2.6.0"
 *   - MCP initialize serverInfo.version → hardcoded "1.0.0"
 *   - /api/version app version       → package.json "0.0.0" (#544)
 *
 * This constant is consumed by /api/spec (info.version) and the MCP
 * handshake (serverInfo.version) so the reported release version can no
 * longer drift per transport.
 *
 * Do NOT compare across version spaces: RELEASE_VERSION is the API release
 * version, independent from the wire contract version SCHEMA_VERSION
 * (api/_schema.js) and from the MCP protocol version ("2025-06-18").
 */
export const RELEASE_VERSION = '2.6.0';
