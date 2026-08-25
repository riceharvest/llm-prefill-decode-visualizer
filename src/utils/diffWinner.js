// Non-color winner encoding for the Diff tab (#890).
//
// RunDiff.jsx colors each per-metric value by its winner (prefill-blue for A,
// decode-green for B) — which fails WCAG 1.4.1 (Use of Color): screen readers
// and text extractors got numbers only, with no verdict channel. These helpers
// provide the text twin of the color encoding; the component renders the label
// in an sr-only span, a data-winner attribute, and a visible legend.

/** Plain-language verdict for a /api/diff metric winner ('A' | 'B' | 'tie'). */
export function winnerLabel(winner) {
  if (winner === 'A') return 'A wins';
  if (winner === 'B') return 'B wins';
  return 'tie';
}

/** Visible one-line legend mapping the two row colors to their meaning. */
export const WINNER_LEGEND =
  'Winner color key: blue = A wins, green = B wins, gray = tie.';
