// Pure view helpers for the Diff view (RunDiff) — issues #387 #388 #390 #391 #394.
// No DOM access so everything is unit-testable with node --test.

// #387: the old hint pointed at "the LocalMaxxing picker", which never shows
// run ids. This is the exact working recipe against the live API.
export const RUN_ID_HINT =
  'Enter two run ids. Get them via GET /api/localmaxxing?hardware=<name>&limit=N — each row of items[].runId can be pasted here.';

/**
 * #394: auto-scale time values instead of rounding sub-millisecond TPOT/TTFT
 * to "0". Seconds in, human string out; null/non-finite renders as an em dash.
 */
export function formatSecondsAuto(seconds) {
  if (seconds == null || seconds === '') return '—';
  const x = Number(seconds);
  if (!Number.isFinite(x)) return '—';
  if (x === 0) return '0 s';
  const abs = Math.abs(x);
  if (abs < 1e-3) return `${(x * 1e6).toLocaleString('en-US', { maximumFractionDigits: 1 })} µs`;
  if (abs < 1) return `${(x * 1e3).toLocaleString('en-US', { maximumFractionDigits: 2 })} ms`;
  return `${x.toLocaleString('en-US', { maximumFractionDigits: 3 })} s`;
}

const dash = v => (v == null || String(v).trim() === '' ? '—' : String(v));

/**
 * #391: one-line identity for a diff side, from the /api/diff payload the UI
 * already receives (result.runA / result.runB are full slim run objects).
 */
export function runMetaLine(side, run) {
  if (!run || typeof run !== 'object') return null;
  const parts = [
    dash(run.modelName ?? run.modelId ?? run.modelFamily),
    dash(run.quantization),
    [dash(run.engine), run.engineVersion ? (/^[a-z]/i.test(String(run.engineVersion)) ? String(run.engineVersion) : `v${run.engineVersion}`) : null].filter(Boolean).join(' '),
    dash(run.hardware ?? run.hardwareKey),
    run.createdAt ? String(run.createdAt).slice(0, 10) : '—'
  ];
  return `${side}: ${parts.join(' · ')}`;
}

/**
 * #390: single source of truth for the container's data-state attribute and
 * the polite live-region announcement.
 */
export function diffStatusState({ loading, result, error }) {
  if (loading) return { state: 'loading', announcement: 'Diffing runs…' };
  if (error) return { state: 'error', announcement: String(error) };
  if (result) return { state: 'done', announcement: 'Diff ready.' };
  return { state: 'idle', announcement: '' };
}

const METRIC_DEFS = [
  { key: 'prefill', label: 'Prefill (tok/s)', kind: 'rate' },
  { key: 'decode', label: 'Decode (tok/s)', kind: 'rate' },
  { key: 'ttft', label: 'TTFT @ 2k prompt', kind: 'time' },
  { key: 'tpot', label: 'TPOT', kind: 'time' },
  { key: 'walltime', label: 'Walltime @ 2k/512', kind: 'time' }
];

/**
 * #388: flatten the diff payload into table rows that carry the RAW numeric
 * values (for data-* attributes / scrapers) next to the display strings.
 */
export function buildDiffTableRows(result) {
  if (!result || !result.diff || !result.diff.metrics) return [];
  return METRIC_DEFS.map(({ key, label, kind }) => {
    const m = result.diff.metrics[key] || {};
    return {
      key,
      label,
      kind,
      a: m.a ?? null,
      b: m.b ?? null,
      delta: m.delta ?? null,
      deltaPct: m.deltaPct ?? null,
      ratio: m.ratio ?? null,
      winner: m.winner ?? null
    };
  });
}
