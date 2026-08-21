// Agent-facing index over the LocalMaxxing community benchmark data.
// Reuses the same upstream API the site proxies (server-side here, so agents
// don't need to know the proxy layout). Supports hardware-first browsing.

const UPSTREAM = 'https://www.localmaxxing.com/api';

function comparable(r) {
  const ef = r.engineFlags || {};
  return r.batchSize === 1
    && (ef.concurrency == null || ef.concurrency <= 1)
    && (ef.numParallel == null || ef.numParallel <= 1)
    && Number.isFinite(r.tokSPrefill) && r.tokSPrefill > 0
    && Number.isFinite(r.tokSOut) && r.tokSOut > 0;
}

function slim(r) {
  const h = r.hardware || {};
  return {
    runId: r.id,
    hardware: r.hardwareGroupLabel || r.hardwareGroupKey,
    hardwareKey: r.hardwareGroupKey,
    hwClass: h.hwClass,
    gpu: h.gpuName,
    gpuCount: h.gpuCount,
    vramGb: h.vramGb,
    chip: h.chipVariant || h.chipFamily || h.chipVendor,
    unifiedMemoryGb: h.unifiedMemoryGb,
    cpu: h.cpu,
    engine: r.engine?.engineName,
    quantization: r.engine?.quantization,
    modelId: r.model?.hfId,
    modelName: r.model?.displayName,
    prefillTokPerSec: Math.round(r.tokSPrefill),
    decodeTokPerSec: Math.round(r.tokSOut),
    promptTokens: r.promptTokens,
    outputTokens: r.outputTokens,
    contextLength: r.contextLength,
    source: `https://localmaxxing.com/en/runs/${r.id}`
  };
}

async function fetchJson(url) {
  const res = await fetch(url, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`upstream ${res.status}`);
  return res.json();
}

export const config = { runtime: 'nodejs' };

export default async function handler(req, res) {
  const json = (body, status = 200) => {
    res.statusCode = status;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'public, max-age=600');
    res.end(JSON.stringify(body, null, 2));
  };

  try {
    const q = req.query || {};
    const hardware = q.hardware;       // filter by hardwareGroupKey or label substring
    const model = q.model;             // filter by model hfId substring
    const limit = Math.min(500, Math.max(1, Number(q.limit) || 50));

    // No filters → hardware summary (cheap: 3 pages max is enough for groups;
    // but for correctness fetch all — upstream caps ~5.6k rows, ~28 pages)
    const wantSummary = !hardware && !model;

    const rows = [];
    const PAGE = 200;
    const maxPages = wantSummary ? 28 : (hardware || model ? 28 : 1);
    for (let offset = 0; offset < maxPages * PAGE; offset += PAGE) {
      const data = await fetchJson(`${UPSTREAM}/leaderboard?limit=${PAGE}&offset=${offset}`);
      const batch = data.rows || [];
      rows.push(...batch);
      if (batch.length < PAGE) break;
    }

    const comparableRows = rows.filter(comparable).map(slim);

    if (wantSummary) {
      const groups = new Map();
      for (const r of comparableRows) {
        if (!groups.has(r.hardwareKey)) groups.set(r.hardwareKey, { hardware: r.hardware, hardwareKey: r.hardwareKey, hwClass: r.hwClass, runs: 0, models: new Set() });
        const g = groups.get(r.hardwareKey);
        g.runs += 1;
        g.models.add(r.modelId);
      }
      return json({
        description: 'Community-measured single-stream LLM benchmark runs (LocalMaxxing). Filter with ?hardware=<substring>&model=<substring>&limit=N, or use ?hardware= to list runs for one rig.',
        totalComparableRuns: comparableRows.length,
        hardwareGroups: [...groups.values()]
          .sort((a, b) => b.runs - a.runs)
          .map(g => ({ hardware: g.hardware, hardwareKey: g.hardwareKey, hwClass: g.hwClass, runs: g.runs, distinctModels: g.models.size }))
      });
    }

    const hw = hardware ? String(hardware).toLowerCase() : null;
    const md = model ? String(model).toLowerCase() : null;
    const filtered = comparableRows.filter(r =>
      (!hw || r.hardwareKey?.toLowerCase().includes(hw) || r.hardware?.toLowerCase().includes(hw))
      && (!md || r.modelId?.toLowerCase().includes(md) || r.modelName?.toLowerCase().includes(md))
    );

    return json({
      description: 'Community-measured single-stream LLM benchmark runs (LocalMaxxing).',
      matchedRuns: filtered.length,
      runs: filtered.slice(0, limit)
    });
  } catch (err) {
    return json({ error: String(err.message || err) }, 502);
  }
}
