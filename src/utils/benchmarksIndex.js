// Pagination follower for /api/benchmarks grouped indexes (#772).
//
// The Quant Tradeoff family picker fetched ?limit=200 once and ignored
// has_more/next_cursor — 38 of 238 model families were silently absent from
// the datalist. This helper follows the documented cursor contract until the
// server reports has_more=false (bounded by maxPages as a runaway guard).

/**
 * @param {(query: string) => Promise<{items?: any[], has_more?: boolean, next_cursor?: string|null}>} fetchPage
 * @param {{groupBy: string, limit?: number, maxPages?: number}} opts
 * @returns {Promise<{items: any[], truncated: boolean, pages: number}>}
 *   truncated is true when maxPages was hit while the server still had more.
 */
export async function collectGroupedItems(fetchPage, { groupBy, limit = 200, maxPages = 10 } = {}) {
  const items = [];
  let cursor = null;
  let page = 0;
  let truncated = false;
  do {
    const q = new URLSearchParams({ groupBy, limit: String(limit) });
    if (cursor) q.set('cursor', cursor);
    const data = await fetchPage(q.toString());
    if (Array.isArray(data?.items)) items.push(...data.items);
    cursor = data?.has_more ? (data.next_cursor || null) : null;
    page += 1;
    truncated = Boolean(cursor);
  } while (cursor && page < maxPages);
  return { items, truncated, pages: page };
}

/** Dedupe grouped items by key (defensive; API pages should not overlap). */
export function dedupeByKey(items) {
  const seen = new Set();
  return items.filter(item => {
    const key = item?.key;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
