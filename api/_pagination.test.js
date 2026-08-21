import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  encodeCursor,
  decodeCursor,
  parsePagination,
  paginate,
  descNumAscStrCmp,
  InvalidCursorError
} from './_pagination.js';

// ---------- cursor codec ----------

test('cursor round-trips its sort key', () => {
  const key = { d: 1234, id: 'run-42' };
  assert.deepEqual(decodeCursor(encodeCursor(key)), key);
});

test('decodeCursor returns null on junk, tampering, and wrong shapes', () => {
  assert.equal(decodeCursor(null), null);
  assert.equal(decodeCursor(''), null);
  assert.equal(decodeCursor('not a cursor!'), null); // illegal charset
  assert.equal(decodeCursor(Buffer.from('just a string').toString('base64url')), null);
  assert.equal(decodeCursor(Buffer.from('[1,2,3]').toString('base64url')), null); // array, not object
  // valid base64url JSON but truncated key envelope
  assert.equal(decodeCursor(Buffer.from('{}').toString('base64url')), null);
});

test('cursors are url-safe', () => {
  const c = encodeCursor({ s: 'a+b/c?d=e&f g' });
  assert.match(c, /^[A-Za-z0-9_-]+$/);
});

// ---------- parsePagination ----------

test('parsePagination applies documented default/max limits', () => {
  assert.equal(parsePagination({}, { defaultLimit: 50, maxLimit: 500 }).limit, 50);
  assert.equal(parsePagination({ limit: '10' }, { defaultLimit: 50, maxLimit: 500 }).limit, 10);
  assert.equal(parsePagination({ limit: '9999' }, { defaultLimit: 50, maxLimit: 500 }).limit, 500);
  assert.equal(parsePagination({ limit: '0' }, { defaultLimit: 50, maxLimit: 500 }).limit, 50);
  assert.equal(parsePagination({ limit: '-5' }, { defaultLimit: 50, maxLimit: 500 }).limit, 50);
  assert.equal(parsePagination({ limit: 'abc' }, { defaultLimit: 25, maxLimit: 200 }).limit, 25);
  assert.equal(parsePagination({ limit: '2.7' }, { defaultLimit: 25, maxLimit: 200 }).limit, 2);
});

test('parsePagination decodes a supplied cursor', () => {
  const { cursor } = parsePagination(
    { cursor: encodeCursor([100, 'x']) },
    { defaultLimit: 10, maxLimit: 100 }
  );
  assert.deepEqual(cursor, [100, 'x']);
});

test('parsePagination throws InvalidCursorError on malformed cursor', () => {
  assert.throws(() => parsePagination({ cursor: 'garbage!!' }, { defaultLimit: 10, maxLimit: 100 }), InvalidCursorError);
});

// ---------- paginate ----------

function makeRuns(n) {
  // decode speeds descend with duplicates so the runId tiebreak matters
  return Array.from({ length: n }, (_, i) => ({
    runId: `run-${String(i).padStart(3, '0')}`,
    decodeTokPerSec: 200 - Math.floor(i / 2)
  }));
}

const keyOf = r => [r.decodeTokPerSec, r.runId];

function walk(items, limit) {
  const seen = [];
  let cursor = null;
  let pages = 0;
  do {
    const page = paginate({ items, limit, cursor: cursor && decodeCursor(cursor), keyOf, cmp: descNumAscStrCmp });
    assert.ok(page.items.length <= limit);
    // contract invariant: has_more is exactly "a next_cursor was returned"
    assert.equal(page.has_more, page.next_cursor != null);
    seen.push(...page.items);
    cursor = page.next_cursor;
    pages++;
    assert.ok(pages < 1000, 'walk must terminate');
  } while (cursor);
  return { seen, pages };
}

test('first page: exact slice, has_more and next_cursor set', () => {
  const runs = makeRuns(10);
  const p1 = paginate({ items: runs, limit: 4, cursor: null, keyOf, cmp: descNumAscStrCmp });
  assert.deepEqual(p1.items.map(r => r.runId), ['run-000', 'run-001', 'run-002', 'run-003']);
  assert.equal(p1.has_more, true);
  assert.equal(p1.next_cursor, encodeCursor(keyOf(runs[3])));
});

test('last page: has_more=false and next_cursor=null', () => {
  const runs = makeRuns(10);
  const p2 = paginate({ items: runs, limit: 4, cursor: decodeCursor(encodeCursor(keyOf(runs[7]))), keyOf, cmp: descNumAscStrCmp });
  assert.deepEqual(p2.items.map(r => r.runId), ['run-008', 'run-009']);
  assert.equal(p2.has_more, false);
  assert.equal(p2.next_cursor, null);
});

test('full walk yields every item exactly once, in order', () => {
  for (const limit of [1, 3, 7, 100]) {
    const runs = makeRuns(23);
    const { seen, pages } = walk(runs, limit);
    assert.deepEqual(seen, runs);
    assert.equal(pages, Math.ceil(23 / limit));
  }
});

test('resume is stable when new higher-scoring rows land between pages', () => {
  const before = makeRuns(20);
  const p1 = paginate({ items: before, limit: 5, cursor: null, keyOf, cmp: descNumAscStrCmp });

  // upstream inserts fresh top-scoring runs mid-scan
  const inserted = [
    { runId: 'run-new-a', decodeTokPerSec: 999 },
    { runId: 'run-new-b', decodeTokPerSec: 999 }
  ];
  const after = [...inserted, ...before].sort((a, b) => descNumAscStrCmp(keyOf(a), keyOf(b)));

  const p2 = paginate({ items: after, limit: 5, cursor: decodeCursor(p1.next_cursor), keyOf, cmp: descNumAscStrCmp });
  // continues strictly after the old boundary — no duplicates, no skips
  for (const r of p2.items) {
    assert.ok(!p1.items.some(o => o.runId === r.runId), `duplicate row ${r.runId} across pages`);
  }
  const rest = [];
  let cur = p2.next_cursor;
  while (cur) {
    const p = paginate({ items: after, limit: 5, cursor: decodeCursor(cur), keyOf, cmp: descNumAscStrCmp });
    rest.push(...p.items);
    cur = p.next_cursor;
  }
  const all = [...p1.items, ...p2.items, ...rest];
  // every ORIGINAL row is served exactly once; rows newly inserted ABOVE the
  // cursor surface on the next scan (keyset guarantee: never duplicates/skips
  // within the window, unlike offset pagination which shifts under you)
  assert.equal(all.length, before.length);
  assert.deepEqual(all.map(r => r.runId), before.map(r => r.runId));
});

test('deleted or unknown cursor key still resumes at the right position', () => {
  const runs = makeRuns(10); // decode speeds: 200,200,199,199,198,198,197,197,196,196
  // ghost id tied at an existing score -> resumes at the next row in tiebreak order
  const tiedGhost = encodeCursor([197, 'run-0055']);
  const p1 = paginate({ items: runs, limit: 3, cursor: decodeCursor(tiedGhost), keyOf, cmp: descNumAscStrCmp });
  assert.deepEqual(p1.items.map(r => r.runId), ['run-006', 'run-007', 'run-008']);
  // ghost score below every row -> scan already complete, empty page
  const lowGhost = encodeCursor([150, 'run-deleted']);
  const p2 = paginate({ items: runs, limit: 2, cursor: decodeCursor(lowGhost), keyOf, cmp: descNumAscStrCmp });
  assert.deepEqual(p2.items, []);
  assert.equal(p2.has_more, false);
  assert.equal(p2.next_cursor, null);
});

test('empty result set paginates to an empty page', () => {
  const p = paginate({ items: [], limit: 10, cursor: null, keyOf, cmp: descNumAscStrCmp });
  assert.deepEqual(p.items, []);
  assert.equal(p.has_more, false);
  assert.equal(p.next_cursor, null);
});
