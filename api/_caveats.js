// Shared statistical-caveat builder for the agent-facing benchmark endpoints.
// Every ranked/aggregated/raw payload carries a machine-readable `caveats`
// array so consumers see the dataset's known limitations inline, not just in
// the docs (issue #19).

/**
 * Caveats that apply to any payload derived from the community dataset.
 * The comparable-run filter (batchSize=1, concurrency<=1) lives in
 * ./_localmaxxing.js — these describe it, they don't enforce it.
 */
export function datasetCaveats() {
  return [
    {
      code: 'single_stream_only',
      severity: 'info',
      summary: 'Single-stream only',
      detail: 'Only runs with batchSize=1 and concurrency/numParallel<=1 are included. Numbers reflect one request at a time, not batched serving throughput.'
    },
    {
      code: 'self_reported_unvalidated',
      severity: 'warning',
      summary: 'Self-reported, unvalidated',
      detail: 'Runs are community-submitted to localmaxxing.com and not independently verified. Trust group medians over any single run.'
    }
  ];
}

/**
 * Caveats derived from aggregated groups (output of aggregate() in
 * ./_localmaxxing.js, which now carries an `engines` array per group).
 * Always returns caveats sorted by code for stable payloads.
 */
export function groupCaveats(groups) {
  const out = [];
  const total = groups.length;

  if (total > 0) {
    const n1 = groups.filter(g => g.runs === 1);
    if (n1.length > 0) {
      const pct = Math.round((n1.length / total) * 100);
      out.push({
        code: 'n1_groups',
        severity: 'warning',
        summary: `n=1 for ${pct}% of groups`,
        detail: `${n1.length} of ${total} groups rest on a single run. Their medians equal that one run — treat as anecdotal.`,
        groupsWithOneRun: n1.length,
        totalGroups: total,
        pct: pct
      });
    }

    const mixed = groups.filter(g => new Set((g.engines || []).filter(Boolean)).size > 1);
    if (mixed.length > 0) {
      out.push({
        code: 'mixed_engines',
        severity: 'warning',
        summary: `Mixed engine versions in ${mixed.length} of ${total} groups`,
        detail: 'Some groups combine runs from different inference engines (e.g. llama.cpp vs MLX vs vLLM), so group stats blend engines.',
        affectedGroups: mixed.length,
        totalGroups: total,
        examples: mixed.slice(0, 5).map(g => g.key)
      });
    }
  }

  return out.sort((a, b) => a.code.localeCompare(b.code));
}

/**
 * Caveats for a raw run listing (no grouping applied): the dataset-level
 * caveats plus an engine-mix caveat when the matched runs span engines.
 */
export function runsCaveats(runs) {
  const out = datasetCaveats();
  if (runs.length > 0) {
    const engines = [...new Set(runs.map(r => r.engine).filter(Boolean))];
    if (engines.length > 1) {
      out.push({
        code: 'mixed_engines',
        severity: 'warning',
        summary: `Runs span ${engines.length} engine versions`,
        detail: 'The matched runs were measured on different inference engines; compare like with like via ?quant= and per-run engine fields.',
        engines: engines.sort()
      });
    }
  }
  return out.sort((a, b) => a.code.localeCompare(b.code));
}

/** Per-row caveats for a single aggregated/ranked group. */
export function rowCaveats(group) {
  const out = [];
  if (!group) return out;
  if (group.runs === 1) {
    out.push({
      code: 'n1_group',
      severity: 'warning',
      summary: 'n=1',
      detail: 'This group contains a single run; median equals that run.'
    });
  }
  if (new Set((group.engines || []).filter(Boolean)).size > 1) {
    out.push({
      code: 'mixed_engines',
      severity: 'warning',
      summary: 'Mixed engine versions',
      detail: 'This group blends runs from different inference engines.'
    });
  }
  return out.sort((a, b) => a.code.localeCompare(b.code));
}

/** Full caveat set for a ranked/aggregated payload. */
export function buildCaveats(runs, groups) {
  return [...datasetCaveats(), ...groupCaveats(groups || [])]
    .sort((a, b) => a.code.localeCompare(b.code));
}
