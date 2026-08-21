// Machine-readable estimate provenance (issue #69).
//
// Every numeric result returned by the agent-facing endpoints carries a
// `basis` tag telling consumers HOW the number was produced, plus a
// `caveats` array (same {code, severity, summary, detail} shape as
// ./_caveats.js) whenever it rests on an assumption worth surfacing.
// This complements the payload-level statistical caveats: `caveats` there
// describe the dataset, `basis`/`caveats` here describe each number.
//
//   measured      — comes directly from community benchmark runs
//   interpolated  — derived from measured numbers via a model (batch-decay
//                   scaling, normalization to a reference workload,
//                   walltime projection from medians)
//   theoretical   — closed-form math from inputs/assumptions; no
//                   measurement involved (VRAM fit, KV cache, engine-flag
//                   deltas, cost math)

export const MEASURED = 'measured';
export const INTERPOLATED = 'interpolated';
export const THEORETICAL = 'theoretical';

export const BASIS_VALUES = [MEASURED, INTERPOLATED, THEORETICAL];

/**
 * Build a { basis, caveats } annotation block. Caveats are deduped by code
 * (first wins) and sorted for stable payloads. Throws on an unknown basis
 * so a typo can't silently ship as untagged data. Spread the result into a
 * response object: { ...annotate(THEORETICAL, caveats) } adds flat
 * `basis` + `caveats` fields next to the numbers they describe.
 */
export function annotate(basis, caveats = []) {
  if (!BASIS_VALUES.includes(basis)) {
    throw new Error(`annotate: unknown basis '${basis}' — expected one of ${BASIS_VALUES.join(', ')}`);
  }
  const byCode = new Map();
  for (const c of caveats || []) {
    if (!c || !c.code) continue;
    if (!byCode.has(c.code)) byCode.set(c.code, c);
  }
  return {
    basis,
    caveats: [...byCode.values()].sort((a, b) => String(a.code).localeCompare(String(b.code)))
  };
}
