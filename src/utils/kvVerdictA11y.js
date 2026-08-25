// Accessible-name / live-region helpers for the KV-cache view (#510).
//
// The per-GPU verdict chips ("Fit across common GPUs" / "Verdict per GPU at
// current settings") used to carry their fit verdict only as a colored dot +
// data-tooltip, both invisible to assistive tech and DOM-scraping agents, and
// every recomputed output mutated silently. These pure helpers fold the
// verdict into the chips' accessible names and build the single polite status
// announcement the view emits when computed results change.

/**
 * Accessible name for one per-GPU verdict chip: card + capacity + verdict,
 * e.g. "RTX 5090 32GB — OOM, exceeds VRAM".
 */
export function gpuVerdictChipLabel({ name, vramGb, verdict, verdictLabels }) {
  const cap = name ? `${name}${vramGb != null ? ` ${vramGb}GB` : ''}` : vramGb != null ? `${vramGb}GB` : 'GPU';
  const v = verdictLabels?.[verdict] || 'verdict unknown';
  return `${cap} — ${v}`;
}

/**
 * One-line summary of the KV-cache view's computed results, announced via a
 * polite role=status region whenever inputs change.
 */
export function kvCacheLiveSummary({ kbPerToken, totalGb, gpuVramGb, verdictLabel } = {}) {
  const parts = [];
  if (Number.isFinite(kbPerToken)) parts.push(`KV cache ${kbPerToken} KB/token`);
  if (Number.isFinite(totalGb)) parts.push(`total ${totalGb} GB`);
  if (Number.isFinite(gpuVramGb) && verdictLabel) parts.push(`${gpuVramGb} GB target: ${verdictLabel}`);
  return parts.join(', ');
}
