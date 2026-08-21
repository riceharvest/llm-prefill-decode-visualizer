// Shared JSON responder for the API endpoints: CORS, Cache-Control and
// ETag / If-None-Match conditional-request support in one place.
//
// The ETag is a content hash of the serialized body, so any change to the
// dataset version (or the query result) produces a new validator and
// clients with a stale If-None-Match get a fresh 200 instead of a stale 304.

import crypto from 'node:crypto';

export function etagFor(serialized) {
  return `"${crypto.createHash('sha256').update(serialized).digest('hex').slice(0, 32)}"`;
}

/** Client validators match when any listed ETag equals ours (weak prefixes ignored). */
export function ifNoneMatchMatches(headerValue, etag) {
  if (!headerValue) return false;
  return String(headerValue)
    .split(',')
    .map(v => v.trim().replace(/^W\//i, ''))
    .includes(etag);
}

/**
 * Serialize, stamp headers, and honor If-None-Match with a 304.
 * Returns the serialized body so callers can log/inspect it.
 */
export function sendJson(req, res, body, { status = 200, cacheTtl = 600 } = {}) {
  const serialized = JSON.stringify(body, null, 2);
  const etag = etagFor(serialized);

  res.statusCode = ifNoneMatchMatches(req?.headers?.['if-none-match'], etag) ? 304 : status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', `public, max-age=${cacheTtl}`);
  res.setHeader('ETag', etag);
  if (res.statusCode === 304) {
    res.setHeader('Content-Length', '0');
    res.end();
  } else {
    res.end(serialized);
  }
  return serialized;
}
