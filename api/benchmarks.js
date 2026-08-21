import { aggregate } from './_localmaxxing.js';
import { datasetStore } from './_dataset.js';
import { sendJson } from './_respond.js';
import { parsePagination, paginate, descNumAscStrCmp, InvalidCursorError } from './_pagination.js';

export const config = { runtime: 'nodejs' };

// Shared pagination contract (see ./_pagination.js): ?limit=N (default 25, max
// 200) + opaque &cursor=; responses carry items[], has_more, next_cursor, total.
// Stable total order: best median decode first, group key as unique tiebreak
// (matches the ordering aggregate() already returns).
const GROUP_KEY = g => [g.decode.median, g.key];

export async function handlerWith(store, req, res) {
  try {
    const q = req.query || {};

    // Filters
    const hardware = q.hardware ? String(q.hardware).toLowerCase() : null;
    const model = q.model ? String(q.model).toLowerCase() : null;   // matches family OR raw hfId
    const quant = q.quant ? String(q.quant).toLowerCase() : null;
    const hwClass = q.hwClass ? String(q.hwClass).toLowerCase() : null; // discrete_gpu | unified | cpu_only

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

    if (hardware) runs = runs.filter(r => r.hardwareKey?.toLowerCase().includes(hardware) || r.hardware?.toLowerCase().includes(hardware));
    if (model) runs = runs.filter(r => r.modelFamily.includes(model) || r.modelId?.toLowerCase().includes(model));
    if (quant) runs = runs.filter(r => r.quantization?.toLowerCase() === quant);
    if (hwClass) runs = runs.filter(r => r.hwClass?.toLowerCase() === hwClass);

    const groupBy = q.groupBy === 'model' ? 'model'
      : q.groupBy === 'hardware' ? 'hardware'
      : q.groupBy === 'quant' ? 'quant'
      : 'hardwareModel'; // default: hardware × model family

    const keyFns = {
      hardware: r => r.hardwareKey,
      model: r => r.modelFamily,
      quant: r => `${r.hardwareKey}|${r.quantization}`,
      hardwareModel: r => `${r.hardwareKey}|${r.modelFamily}`
    };

    const { limit, cursor } = parsePagination(q, { defaultLimit: 25, maxLimit: 200 });

    // aggregate() sorts by median decode desc; enforce the full stable order
    const allGroups = aggregate(runs, keyFns[groupBy])
      .sort((a, b) => descNumAscStrCmp(GROUP_KEY(a), GROUP_KEY(b)));

    const page = paginate({ items: allGroups, limit, cursor, keyOf: GROUP_KEY, cmp: descNumAscStrCmp });

    const groups = page.items.map(g => ({
      ...g,
      models: undefined,
      modelFamilies: g.models,
      bestRun: {
        runId: g.bestRun.runId,
        modelName: g.bestRun.modelName,
        hardware: g.bestRun.hardware,
        engine: g.bestRun.engine,
        quantization: g.bestRun.quantization,
        prefillTokPerSec: g.bestRun.prefillTokPerSec,
        decodeTokPerSec: g.bestRun.decodeTokPerSec,
        source: g.bestRun.source
      }
    }));

    return sendJson(req, res, {
      description: 'Aggregated community benchmark speeds (median + IQR per group). Filter with ?hardware=&model=&quant=&hwClass=; regroup with ?groupBy=hardware|model|quant|hardwareModel. Cursor pagination: follow next_cursor until has_more is false. Pin numbers with ?asOf=<version>.',
      dataset: {
        version: snapshot.id,
        buildTimestamp: snapshot.buildTimestamp,
        runCount: snapshot.runCount,
        asOf: asOf || null
      },
      total: allGroups.length,
      matchedRuns: runs.length,
      distinctModelFamilies: [...new Set(runs.map(r => r.modelFamily))].length,
      note: 'medians are outlier-resistant; use bestRun for the single fastest measured run in each group',
      items: groups,
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
