// Shared cursor-based pagination contract for the data endpoints
// (/api/localmaxxing, /api/benchmarks):
//
//   Request:   ?limit=N (documented default/max per endpoint) &cursor=<opaque>
//   Response:  { ..., total, items[], has_more, next_cursor }
//
// The cursor is an opaque base64url blob encoding the sort key of the last
// item on the previous page (keyset pagination). Because resumption compares
// sort keys instead of offsets, inserting new runs upstream between pages can
// never skip or duplicate rows mid-scan. Sort order is stable: every endpoint
// sorts on a unique total order (primary metric desc + unique id asc).
//
// Cursor fingerprinting (#740 #755): scoped cursors carry a second envelope
// member `s` — a short hash of "endpoint + every filter that shapes the page +
// the dataset snapshot/version they were minted against". parsePagination()
// rejects cursors whose fingerprint does not match the current query with 400
// INVALID_CURSOR, so cross-endpoint, cross-filter and cross-refresh reuse fail
// loudly instead of silently returning wrong pages.

import { createHash } from 'node:crypto';

const CURSOR_RE = /^[A-Za-z0-9_-]+$/;
// App-level cap on the cursor param — junk blobs die here instead of relying
// on platform URI limits (#740 aside).
const MAX_CURSOR_CHARS = 1024;
const FINGERPRINT_CHARS = 16;

export class InvalidCursorError extends Error {
  constructor() {
    super('invalid ?cursor= — pass the next_cursor value returned by the previous page');
    this.name = 'InvalidCursorError';
  }
}

/** A structurally valid cursor minted under a different query/snapshot. */
export class CursorScopeMismatchError extends InvalidCursorError {
  constructor(detail) {
    super(detail ?? 'cursor was minted for a different query — restart the walk with the current filters');
    this.name = 'CursorScopeMismatchError';
  }
}

/**
 * Short fingerprint of a scope string. Scope strings come from
 * paginationScope(): endpoint id + sorted filter params + snapshot id.
 */
export function cursorFingerprint(scope) {
  return createHash('sha256').update(String(scope)).digest('base64url').slice(0, FINGERPRINT_CHARS);
}

/**
 * Deterministic scope string binding a paginated walk to the query that
 * minted it: an endpoint name plus every param that changes which rows are
 * returned or how they are ordered. Nullish/empty values are omitted and the
 * remaining keys are sorted so insertion order cannot change the fingerprint.
 * Callers should include the resolved dataset snapshot id (or dataset
 * version) so walks crossing an upstream refresh fail fast (#755).
 */
export function paginationScope(endpoint, params = {}) {
  const parts = Object.keys(params)
    .filter(k => params[k] !== undefined && params[k] !== null && params[k] !== '')
    .sort()
    .map(k => `${k}=${String(params[k])}`);
  return [endpoint, ...parts].join('|');
}

function b64urlEncode(str) {
  return Buffer.from(str, 'utf8').toString('base64url');
}

function b64urlDecode(str) {
  // Node accepts base64url directly; strict charset check first so junk fails fast.
  if (typeof str !== 'string' || !CURSOR_RE.test(str)) return null;
  if (str.length > MAX_CURSOR_CHARS) return null; // app-level length cap
  try {
    const raw = Buffer.from(str, 'base64url').toString('utf8');
    const val = JSON.parse(raw);
    if (!val || typeof val !== 'object' || Array.isArray(val)) return null;
    return val;
  } catch {
    return null;
  }
}

/** Decode a cursor into its full envelope ({k, s?}), or null if malformed. */
function decodeEnvelope(cursor) {
  if (typeof cursor !== 'string') return null;
  const parsed = b64urlDecode(cursor);
  return parsed && Object.hasOwn(parsed, 'k') ? parsed : null;
}

/**
 * Opaque cursor for a sort key (plain JSON object of primitives).
 * Pass `scope` (from paginationScope) to fingerprint the cursor to its query.
 */
export function encodeCursor(key, scope = null) {
  const envelope = { k: key };
  if (scope != null) envelope.s = cursorFingerprint(scope);
  return b64urlEncode(JSON.stringify(envelope));
}

/** Decode a cursor back into its sort key, or null if malformed. */
export function decodeCursor(cursor) {
  const env = decodeEnvelope(cursor);
  return env ? env.k : null;
}

/**
 * Parse &clamp ?limit and ?cursor from a request query.
 * Throws InvalidCursorError when a cursor was supplied but cannot be decoded.
 * When `scope` is given, cursors must carry the matching fingerprint — reuse
 * under a different endpoint/filter set/snapshot throws
 * CursorScopeMismatchError (a 400 INVALID_CURSOR for callers).
 */
export function parsePagination(q, { defaultLimit, maxLimit, scope = null }) {
  const n = Number(q?.limit);
  // Raw requested page size (integer, pre-clamp) or null when absent/invalid.
  // Returned so handlers can tell a honored ?limit= from a silently clamped
  // one (#994).
  const requestedLimit = Number.isFinite(n) && n >= 1 ? Math.floor(n) : null;
  const limit = requestedLimit != null
    ? Math.min(maxLimit, requestedLimit)
    : defaultLimit;

  const raw = q?.cursor;
  let cursor = null;
  if (raw != null && raw !== '') {
    const env = decodeEnvelope(String(raw));
    if (!env) throw new InvalidCursorError();
    if (scope != null && env.s !== cursorFingerprint(scope)) {
      throw new CursorScopeMismatchError(env.s === undefined
        ? 'cursor predates query fingerprinting — restart the walk with a fresh first page'
        : 'cursor was minted for a different query (endpoint, filters or dataset snapshot changed) — restart the walk');
    }
    cursor = env.k;
  }
  return { limit, cursor, requestedLimit };
}

/**
 * Slice one page off an already-sorted array using keyset resumption.
 *
 * @param {Array} items     sorted such that cmp(keyOf(a), keyOf(b)) matches their order
 * @param {number} limit    page size (>0)
 * @param {*}       cursor   decoded sort key to resume after, or null for page one
 * @param {(item) => *} keyOf  extracts the unique sort key used in cursors
 * @param {(a, b) => number} cmp  comparator over two keys (same order as items)
 * @param {string} [scope]  paginationScope string — minted cursors carry its fingerprint
 * @returns {{ items: Array, has_more: boolean, next_cursor: string|null }}
 */
export function paginate({ items, limit, cursor, keyOf, cmp, scope = null }) {
  let start = 0;
  if (cursor != null) {
    start = items.findIndex(item => cmp(keyOf(item), cursor) > 0);
    if (start === -1) start = items.length; // cursor past the end -> empty page
  }

  const pageItems = items.slice(start, start + limit);
  const end = start + pageItems.length;
  const has_more = end < items.length;
  return {
    items: pageItems,
    has_more,
    next_cursor: has_more && pageItems.length ? encodeCursor(keyOf(pageItems[pageItems.length - 1]), scope) : null
  };
}

/**
 * Stable descending-by-number, ascending-by-string-tiebreak comparator over
 * [num, str] keys — the shared total order for metric-sorted listings.
 */
export function descNumAscStrCmp(a, b) {
  const byNum = (b[0] ?? -Infinity) - (a[0] ?? -Infinity);
  if (byNum !== 0) return byNum;
  const sa = String(a[1]);
  const sb = String(b[1]);
  return sa < sb ? -1 : sa > sb ? 1 : 0;
}
