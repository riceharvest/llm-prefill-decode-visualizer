import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  encodeCursor,
  decodeCursor,
  parsePagination,
  paginate,
  descNumAscStrCmp,
  paginationScope,
  InvalidCursorError,
  CursorScopeMismatchError
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

// ---------- cursor fingerprinting (#740 #755) ----------

test('scoped cursors carry a fingerprint member alongside the key', () => {
  const scope = paginationScope('localmaxxing', { hardware: '4090', snapshot: 'snapshot-2026-08-24-abcd1234' });
  const c = encodeCursor([100, 'run-1'], scope);
  const envelope = JSON.parse(Buffer.from(c, 'base64url').toString('utf8'));
  assert.deepEqual(Object.keys(envelope).sort(), ['k', 's']);
  assert.deepEqual(envelope.k, [100, 'run-1']);
  // deterministic: same scope -> same fingerprint
  assert.equal(encodeCursor([100, 'run-1'], scope), c);
});

test('paginationScope is order-insensitive and omits empty params', () => {
  const a = paginationScope('x', { hardware: '4090', model: 'qwen', snapshot: 's1' });
  const b = paginationScope('x', { snapshot: 's1', model: 'qwen', hardware: '4090', quant: null });
  assert.equal(a, b);
  assert.equal(paginationScope('x', {}), 'x');
});

test('parsePagination accepts a scoped cursor minted under the identical query', () => {
  const mk = extra => paginationScope('benchmarks', { groupBy: 'hardwareModel', snapshot: 'snap-1', ...extra });
  const c = encodeCursor([90, 'g'], mk({}));
  const parsed = parsePagination({ cursor: c }, { defaultLimit: 5, maxLimit: 10, scope: mk({}) });
  assert.deepEqual(parsed.cursor, [90, 'g']);
  // different filters under the same endpoint -> rejected
  assert.throws(
    () => parsePagination({ cursor: c }, { defaultLimit: 5, maxLimit: 10, scope: mk({ groupBy: 'model' }) }),
    CursorScopeMismatchError
  );
});

test('cross-endpoint cursor reuse is rejected with 400-typed error (#740)', () => {
  const localCursor = encodeCursor([50, 'run-9'], paginationScope('localmaxxing', { hardware: '4090', snapshot: 's1' }));
  assert.throws(
    () => parsePagination({ cursor: localCursor }, {
      defaultLimit: 25, maxLimit: 200,
      scope: paginationScope('benchmarks', { groupBy: 'hardwareModel', snapshot: 's1' })
    }),
    CursorScopeMismatchError
  );
});

test('cross-filter and cross-snapshot cursor reuse is rejected (#740 #755)', () => {
  const minted = encodeCursor([50, 'run-9'], paginationScope('localmaxxing', { hardware: '4090', model: 'qwen', snapshot: 'snap-a' }));
  for (const drifted of [
    { hardware: '4090', model: 'llama', snapshot: 'snap-a' },   // filter changed
    { hardware: '4090', model: 'qwen', snapshot: 'snap-b' }     // dataset refreshed
  ]) {
    assert.throws(
      () => parsePagination({ cursor: minted }, {
        defaultLimit: 50, maxLimit: 500,
        scope: paginationScope('localmaxxing', drifted)
      }),
      CursorScopeMismatchError
    );
  }
});

test('legacy fingerprint-less cursors are rejected under a scoped query', () => {
  const legacy = Buffer.from(JSON.stringify({ k: [50, 'run-9'] })).toString('base64url');
  assert.throws(
    () => parsePagination({ cursor: legacy }, {
      defaultLimit: 5, maxLimit: 10,
      scope: paginationScope('runs', { format: 'json', comparable: 'all', datasetVersion: 1 })
    }),
    CursorScopeMismatchError
  );
  // ...and still accepted by unscoped callers (back-compat within this repo's helpers)
  assert.deepEqual(parsePagination({ cursor: legacy }, { defaultLimit: 5, maxLimit: 10 }).cursor, [50, 'run-9']);
});

test('paginate mints scoped cursors that validate under the same scope', () => {
  const runs = makeRuns(6);
  const scope = paginationScope('agent_benchmarks', { snapshot: 'snap-1' });
  const p1 = paginate({ items: runs, limit: 3, cursor: null, keyOf, cmp: descNumAscStrCmp, scope });
  const parsed = parsePagination({ cursor: p1.next_cursor }, { defaultLimit: 3, maxLimit: 10, scope });
  assert.deepEqual(parsed.cursor, keyOf(runs[2]));
  const p2 = paginate({ items: runs, limit: 3, cursor: parsed.cursor, keyOf, cmp: descNumAscStrCmp, scope });
  assert.deepEqual(p2.items.map(r => r.runId), runs.slice(3).map(r => r.runId));
  assert.equal(p2.has_more, false);
});

test('oversized cursor blobs are rejected before decoding (app-level length cap)', () => {
  const junk = 'A'.repeat(2000);
  assert.equal(decodeCursor(junk), null);
  assert.throws(() => parsePagination({ cursor: junk }, { defaultLimit: 5, maxLimit: 10 }), InvalidCursorError);
});
