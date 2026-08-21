import { getAllRuns } from './_localmaxxing.js';
import { normalizeModelId } from './_normalize.js';
import { parsePagination, paginate, descNumAscStrCmp, InvalidCursorError } from './_pagination.js';
import { validateSubmission, checkDuplicates, queueSubmission } from './_submit.js';
import { datasetStore } from './_dataset.js';
import { sendJson } from './_respond.js';

export const config = { runtime: 'nodejs' };

// Shared pagination contract (see ./_pagination.js): ?limit=N (default 50, max
// 500) + opaque &cursor=; responses carry items[], has_more, next_cursor, total.
const RUN_KEY = r => [r.decodeTokPerSec, String(r.runId)];

export async function handlerWith(store, req, res) {
  try {
    const q = req.query || {};

    const asOf = q.asOf ? String(q.asOf) : null;
    let snapshot;
    if (asOf) {
      const hit = store.resolve(asOf);
      if (!hit) {
        return sendJson(req, res, {
          error: `No cached dataset snapshot matches asOf='${asOf}'. Snapshots live in server memory; try an id from 'snapshots' or a timestamp within the retention window.`,
          requestedAsOf: asOf,
          snapshots: store.listSnapshots()
        }, { status: 404 });
      }
      snapshot = hit.snapshot;
    } else {
      snapshot = await store.current();
    }

    let runs = snapshot.rows;

    const hardware = q.hardware ? String(q.hardware).toLowerCase() : null;
    const model = q.model ? String(q.model).toLowerCase() : null;
    const quant = q.quant ? String(q.quant).toLowerCase() : null;

    if (hardware) runs = runs.filter(r => r.hardwareKey?.toLowerCase().includes(hardware) || r.hardware?.toLowerCase().includes(hardware));
    if (model) runs = runs.filter(r => r.modelFamily.includes(model) || r.modelId?.toLowerCase().includes(model));
    if (quant) runs = runs.filter(r => r.quantization?.toLowerCase() === quant);

    // Every response carries the exact dataset version that produced it,
    // so agents can cite and replay against the same numbers.
    const datasetMeta = {
      version: snapshot.id,
      buildTimestamp: snapshot.buildTimestamp,
      runCount: snapshot.runCount,
      asOf: asOf || null
    };

    if (!hardware && !model && !quant) {
      // Summary: hardware groups with run counts
      const groups = new Map();
      for (const r of runs) {
        if (!groups.has(r.hardwareKey)) {
          groups.set(r.hardwareKey, {
            hardware: r.hardware, hardwareKey: r.hardwareKey, hwClass: r.hwClass,
            runs: 0, modelFamilies: new Set()
          });
        }
        const g = groups.get(r.hardwareKey);
        g.runs += 1;
        g.modelFamilies.add(r.modelFamily);
      }
      return sendJson(req, res, {
        description: 'Community-measured single-stream LLM benchmark runs. Filter with ?hardware=&model=&quant=&limit=&cursor= for paginated runs. Aggregated stats: /api/benchmarks. Ranked answers: /api/best. Reproducible answers: pass ?asOf=<version>.',
        dataset: datasetMeta,
        totalComparableRuns: runs.length,
        hardwareGroups: [...groups.values()]
          .sort((a, b) => b.runs - a.runs)
          .map(g => ({
            hardware: g.hardware, hardwareKey: g.hardwareKey, hwClass: g.hwClass,
            runs: g.runs, distinctModelFamilies: g.modelFamilies.size
          }))
      });
    }

    let { limit, cursor } = parsePagination(q, { defaultLimit: 50, maxLimit: 500 });

    // Stable total order: fastest decode first, runId as unique tiebreak
    runs.sort((a, b) => descNumAscStrCmp(RUN_KEY(a), RUN_KEY(b)));

    const page = paginate({ items: runs, limit, cursor, keyOf: RUN_KEY, cmp: descNumAscStrCmp });

    return sendJson(req, res, {
      description: 'Raw comparable runs (modelFamily collapses repo/quant variants of the same base model). Cursor pagination: follow next_cursor until has_more is false.',
      dataset: datasetMeta,
      total: runs.length,
      items: page.items,
      has_more: page.has_more,
      next_cursor: page.next_cursor
    });
  } catch (err) {
    if (err instanceof InvalidCursorError) {
      return sendJson(req, res, { error: err.message }, { status: 400 });
    }
    return sendJson(req, res, { error: String(err.message || err) }, { status: 502 });
  }
}

export default function handler(req, res) {
  return handlerWith(datasetStore, req, res);
}
