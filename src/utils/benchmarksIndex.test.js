import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collectGroupedItems, dedupeByKey } from './benchmarksIndex.js';

test('#772 follows next_cursor until has_more is false', async () => {
  const queries = [];
  const fetchPage = async (query) => {
    queries.push(query);
    if (queries.length === 1) {
      return {
        total: 238,
        items: Array.from({ length: 200 }, (_, i) => ({ key: `m${i}`, runs: 10 - i })),
        has_more: true,
        next_cursor: 'CUR1'
      };
    }
    return {
      total: 238,
      items: Array.from({ length: 38 }, (_, i) => ({ key: `x${i}`, runs: 5 })),
      has_more: false,
      next_cursor: null
    };
  };
  const { items, truncated, pages } = await collectGroupedItems(fetchPage, { groupBy: 'model', limit: 200 });
  assert.equal(items.length, 238);
  assert.equal(truncated, false);
  assert.equal(pages, 2);
  assert.match(queries[0], /groupBy=model&limit=200/);
  assert.match(queries[1], /cursor=CUR1/);
});

test('#772 stops at maxPages and flags truncation instead of lying', async () => {
  let n = 0;
  const fetchPage = async () => ({
    items: [{ key: `p${n++}` }],
    has_more: true,
    next_cursor: 'MORE'
  });
  const { truncated, pages } = await collectGroupedItems(fetchPage, { groupBy: 'model', limit: 200, maxPages: 3 });
  assert.equal(truncated, true);
  assert.equal(pages, 3);
});

test('#772 single-page corpus needs exactly one request', async () => {
  const fetchPage = async () => ({ items: [{ key: 'a' }, { key: 'b' }], has_more: false, next_cursor: null });
  const { items, truncated, pages } = await collectGroupedItems(fetchPage, { groupBy: 'hardware' });
  assert.deepEqual(dedupeByKey(items).map(i => i.key), ['a', 'b']);
  assert.equal(truncated, false);
  assert.equal(pages, 1);
});
