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

const CURSOR_RE = /^[A-Za-z0-9_-]+$/;

export class InvalidCursorError extends Error {
  constructor() {
    super('invalid ?cursor= — pass the next_cursor value returned by the previous page');
    this.name = 'InvalidCursorError';
  }
}

function b64urlEncode(str) {
  return Buffer.from(str, 'utf8').toString('base64url');
}

function b64urlDecode(str) {
  // Node accepts base64url directly; strict charset check first so junk fails fast.
  if (!CURSOR_RE.test(str)) return null;
  try {
    const raw = Buffer.from(str, 'base64url').toString('utf8');
    const val = JSON.parse(raw);
    if (!val || typeof val !== 'object' || Array.isArray(val)) return null;
    return val;
  } catch {
    return null;
  }
}

/** Opaque cursor for a sort key (plain JSON object of primitives). */
export function encodeCursor(key) {
  return b64urlEncode(JSON.stringify({ k: key }));
}

/** Decode a cursor back into its sort key, or null if malformed. */
export function decodeCursor(cursor) {
  if (typeof cursor !== 'string') return null;
  const parsed = b64urlDecode(cursor);
  return parsed && Object.hasOwn(parsed, 'k') ? parsed.k : null;
}

/**
 * Parse &clamp ?limit and ?cursor from a request query.
 * Throws InvalidCursorError when a cursor was supplied but cannot be decoded.
 */
export function parsePagination(q, { defaultLimit, maxLimit }) {
  const n = Number(q?.limit);
  const limit = Number.isFinite(n) && n >= 1
    ? Math.min(maxLimit, Math.floor(n))
    : defaultLimit;

  const raw = q?.cursor;
  let cursor = null;
  if (raw != null && raw !== '') {
    cursor = decodeCursor(String(raw));
    if (cursor == null) throw new InvalidCursorError();
  }
  return { limit, cursor };
}

/**
 * Slice one page off an already-sorted array using keyset resumption.
 *
 * @param {Array} items     sorted such that cmp(keyOf(a), keyOf(b)) matches their order
 * @param {number} limit    page size (>0)
 * @param {*}       cursor   decoded sort key to resume after, or null for page one
 * @param {(item) => *} keyOf  extracts the unique sort key used in cursors
 * @param {(a, b) => number} cmp  comparator over two keys (same order as items)
 * @returns {{ items: Array, has_more: boolean, next_cursor: string|null }}
 */
export function paginate({ items, limit, cursor, keyOf, cmp }) {
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
    next_cursor: has_more && pageItems.length ? encodeCursor(keyOf(pageItems[pageItems.length - 1])) : null
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
