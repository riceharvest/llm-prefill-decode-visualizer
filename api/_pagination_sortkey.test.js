// Regression tests for #1094: type-confused ?cursor= sort keys must return the
// documented 400 INVALID_CURSOR instead of decoding "successfully" and
// degrading into a silent empty has_more:false page (false end-of-data).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  decodeCursor,
  descNumAscStrCmp,
  encodeCursor,
  InvalidCursorError,
  paginate,
  parsePagination,
  isValidSortKey
} from './_pagination.js';

const OPTS = { defaultLimit: 5, maxLimit: 10 };
const b64 = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');

// The issue's prod-reproduced forged-key table: envelope-valid, wrong k type.
const FORGED_KEYS = [
  ['"b"', 'b'],                       // string k
  ['750', 750],                       // number k
  ['[]', []],                         // empty-array k
  ['["abc","def"]', ['abc', 'def']],  // swapped types
  ['{"0":750,"1":"x"}', { 0: 750, 1: 'x' }], // array-like object
  ['{"a":{"b":1}}', { a: { b: 1 } }], // nested object
  ['[null,"zzz"]', [null, 'zzz']],    // non-finite metric after JSON round-trip
  ['["750"]', ['750']],               // metric as string
  ['[750,null]', [750, null]],        // id not a string
  ['[750,"x","y"]', [750, 'x', 'y']]  // arity 3
];

test('#1094: type-confused k keys throw the documented InvalidCursorError (400), not a silent empty page', () => {
  for (const [label, key] of FORGED_KEYS) {
    assert.throws(
      () => parsePagination({ cursor: b64({ k: key }) }, OPTS),
      InvalidCursorError,
      `forged k=${label} must be rejected`
    );
  }
});

test('#1094: well-formed [number, string] cursors still resume mid-walk', () => {
  const items = [[900, 'a'], [800, 'b'], [700, 'c'], [600, 'd']];
  const { cursor } = parsePagination({ cursor: encodeCursor([750, 'x']) }, OPTS);
  const page = paginate({ items, limit: 2, cursor, keyOf: r => r, cmp: descNumAscStrCmp });
  assert.deepEqual(page.items.map(r => r[1]), ['c', 'd']);
});

test('isValidSortKey accepts exactly the shared [finite number, string] shape', () => {
  assert.equal(isValidSortKey([105, 'run-9']), true);
  assert.equal(isValidSortKey([-3.5, 'id with space']), true);
  for (const bad of ['b', 750, [], ['abc', 'def'], [750], [750, 'x', 'y'],
    [NaN, 'x'], [Infinity, 'x'], [750, null], [{}, {}], null, undefined]) {
    assert.equal(isValidSortKey(bad), false, JSON.stringify(bad));
  }
});

test('#1094: real minted next_cursor values keep passing validation end-to-end', () => {
  const items = Array.from({ length: 7 }, (_, i) => [100 - i, `id-${i}`]);
  let cursor = null;
  let pages = 0;
  for (;;) {
    const { limit, cursor: c } = parsePagination(
      cursor ? { cursor: encodeCursor(cursor) } : {}, OPTS);
    void limit;
    const page = paginate({ items, limit: OPTS.defaultLimit, cursor: c, keyOf: r => r, cmp: descNumAscStrCmp });
    pages++;
    if (!page.has_more) break;
    // Round-trip the emitted cursor through the exact endpoint boundary.
    cursor = decodeCursor(page.next_cursor);
    assert.ok(isValidSortKey(cursor), 'emitted cursor must satisfy its own validation');
    if (pages > 10) assert.fail('walk did not terminate');
  }
  assert.ok(pages >= 2);
});
