// Accessible summary for the agentic turn-by-turn waterfall chart (#421).
//
// The waterfall's data lives entirely in positioned divs + data-tooltip
// attributes, so name-based AT/agent lookups find a bare container. This pure
// helper composes the per-turn prefill/decode/walltime values into one string
// for role="img" aria-label use — the same numbers the "View as table"
// disclosure exposes, without requiring the toggle to be found first.
//
// Pure function (no DOM), so it is unit-testable under node:test.

const MAX_TURNS_IN_SUMMARY = 12;

function fmtSeconds(sec) {
  if (!Number.isFinite(sec)) return '∞';
  return sec >= 1 ? `${sec.toFixed(2)} s` : `${Math.round(sec * 1000)} ms`;
}

/**
 * Build a text summary of the turn-by-turn walltime waterfall.
 * Long loops are capped at the first MAX_TURNS_IN_SUMMARY turns with an
 * explicit "+ N more turns" suffix so the label stays bounded.
 */
export function waterfallAriaSummary(turnBreakdown = [], totalWalltimeSec = null) {
  const turns = Array.isArray(turnBreakdown) ? turnBreakdown : [];
  if (turns.length === 0) return 'Turn-by-turn walltime waterfall: no turns configured.';
  const shown = turns.slice(0, MAX_TURNS_IN_SUMMARY);
  const parts = shown.map(t =>
    `T${t.turn} ${t.isCached ? 'cached' : 'full ingest'}: prefill ${fmtSeconds(t.prefillTime)}, decode ${fmtSeconds(t.decodeTime)}, turn total ${fmtSeconds(t.turnWalltime)}`
  );
  const hidden = turns.length - shown.length;
  if (hidden > 0) parts.push(`+ ${hidden} more turns`);
  const totalTail = Number.isFinite(totalWalltimeSec)
    ? `. Loop total ${fmtSeconds(totalWalltimeSec)}`
    : '';
  return `Turn-by-turn walltime waterfall: ${parts.join('; ')}${totalTail}. Full values in the per-turn data table.`;
}
