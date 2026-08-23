// Agentic contract tests: pagination cursor wire format & semantics.
//
// _pagination.test.js covers helper behavior; this file locks the *wire
// contract* agents program against: the cursor is an opaque base64url blob
// with a stable internal envelope, is URL-safe without escaping, encodes are
// deterministic, resumption is keyset-based (next-only), pages are idempotent
// under retries, and walks terminate with an empty terminal page.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  decodeCursor,
  descNumAscStrCmp,
  encodeCursor,
  InvalidCursorError,
  paginate,
  parsePagination
} from './_pagination.js';

const CURSOR_CHARSET = /^[A-Za-z0-9_-]+$/;

// Deterministic fixture: [metric, id] rows pre-sorted per the shared total
// order (metric desc, id asc).
function rows(n) {
  return Array.from({ length: n }, (_, i) => [100 - i, `id-${String(i).padStart(3, '0')}`]);
}
const keyOf = (row) => row;
const cmp = descNumAscStrCmp;

test('cursor encoding is deterministic — same key, same bytes', () => {
  const key = [105, 'id-005'];
  assert.equal(encodeCursor(key), encodeCursor(key));
  assert.equal(encodeCursor(key), encodeCursor([...key]), 'encoding must not depend on key identity');
});

test('wire format: base64url JSON envelope with a single "k" member', () => {
  const cursor = encodeCursor([42, 'run-9']);
  // Decode independently of the implementation to lock the envelope shape.
  const envelope = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
  assert.deepEqual(Object.keys(envelope), ['k']);
  assert.deepEqual(envelope.k, [42, 'run-9']);
  assert.deepEqual(decodeCursor(cursor), [42, 'run-9']);
});

test('cursors are URL-safe without percent-encoding', () => {
  for (const key of [[1, 'a'], [99999, 'x'.repeat(64)], [-3, 'id with space']]) {
    const cursor = encodeCursor(key);
    assert.match(cursor, CURSOR_CHARSET, 'cursor must use the base64url alphabet only');
    assert.equal(encodeURIComponent(cursor), cursor, 'cursor must survive query strings unescaped');
  }
});

test('next_cursor always points at the last item of the page it was cut at', () => {
  const items = rows(10);
  const page = paginate({ items, limit: 4, cursor: null, keyOf, cmp });
  assert.deepEqual(decodeCursor(page.next_cursor), keyOf(page.items[3]));
  // ...and resuming from it starts strictly after that key (keyset, not offset).
  const page2 = paginate({ items, limit: 4, cursor: decodeCursor(page.next_cursor), keyOf, cmp });
  assert.deepEqual(page2.items.map(keyOf), items.slice(4, 8));
});

test('pagination is next-only: no prev_cursor, terminal page is empty with null cursor', () => {
  const items = rows(6);
  let cursor = null;
  let seen = 0;
  for (let i = 0; i < 10; i++) {
    const page = paginate({ items, limit: 2, cursor, keyOf, cmp });
    assert.equal('prev_cursor' in page, false, 'contract exposes next_cursor only');
    seen += page.items.length;
    if (!page.has_more) {
      assert.equal(page.next_cursor, null, 'terminal page must emit a null next_cursor');
      assert.equal(seen, items.length, 'terminal page reached only after all items');
      // Following the terminal contract one more time is a no-op empty page.
      const after = paginate({ items, limit: 2, cursor: null, keyOf, cmp });
      assert.equal(after.items.length, 2, 'null cursor restarts from the top (documented next-only semantics)');
      return;
    }
    cursor = decodeCursor(page.next_cursor);
  }
  assert.fail('walk did not terminate within the step budget');
});

test('retrying a page is idempotent — same cursor, identical page', () => {
  const items = rows(12);
  const first = paginate({ items, limit: 5, cursor: null, keyOf, cmp });
  const retry = paginate({ items, limit: 5, cursor: decodeCursor(first.next_cursor), keyOf, cmp });
  const retryAgain = paginate({ items, limit: 5, cursor: decodeCursor(first.next_cursor), keyOf, cmp });
  assert.deepEqual(retry, retryAgain, 'same cursor must yield byte-identical page results');
  assert.equal(retry.items.length, 5);
  assert.equal(retry.has_more, true);
});

test('walk order is metric-desc with id-asc tiebreak; equal metrics never skipped', () => {
  const unsorted = [[100, 'b'], [100, 'a'], [90, 'z'], [90, 'y'], [80, 'only']];
  const items = [...unsorted].sort((x, y) => cmp(keyOf(x), keyOf(y)));
  const all = [];
  let cursor = null;
  for (;;) {
    const page = paginate({ items, limit: 2, cursor, keyOf, cmp });
    all.push(...page.items);
    if (!page.has_more) {
      assert.equal(page.next_cursor, null);
      break;
    }
    cursor = decodeCursor(page.next_cursor);
  }
  assert.equal(all.length, items.length, 'every row appears exactly once');
  assert.deepEqual(all, items, 'the walk reproduces the shared total order');
  // Explicitly pin the documented direction of that order.
  assert.deepEqual(all.map(r => r[1]), ['a', 'b', 'y', 'z', 'only'], 'metric desc, id asc within ties');
});

test('cursor past the end of data is a clean empty terminal page, not an error', () => {
  const items = rows(3);
  const stale = encodeCursor([-Infinity, 'zzz']); // sorts after everything
  const page = paginate({ items, limit: 5, cursor: decodeCursor(stale), keyOf, cmp });
  assert.deepEqual(page.items, []);
  assert.equal(page.has_more, false);
  assert.equal(page.next_cursor, null);
});

test('parsePagination clamps limit to the documented max and floors junk to default', () => {
  const opts = { defaultLimit: 25, maxLimit: 200 };
  assert.equal(parsePagination({ limit: '100000' }, opts).limit, 200);
  assert.equal(parsePagination({ limit: '25' }, opts).limit, 25);
  assert.equal(parsePagination({ limit: '0' }, opts).limit, 25);
  assert.equal(parsePagination({ limit: '-5' }, opts).limit, 25);
  assert.equal(parsePagination({ limit: '12.9' }, opts).limit, 12, 'fractional limits floor');
  assert.equal(parsePagination({}, opts).limit, 25);
  assert.equal(parsePagination({ cursor: '' }, opts).cursor, null, 'empty cursor equals no cursor');
});

test('malformed cursors throw the typed InvalidCursorError agents can branch on', () => {
  for (const junk of ['!!!', 'not-base64!!', Buffer.from('[1,2]').toString('base64url'), 'e30', 'null', '[]']) {
    assert.throws(() => parsePagination({ cursor: junk }, { defaultLimit: 5, maxLimit: 10 }),
      InvalidCursorError, `"${junk}" must be rejected`);
  }
});
