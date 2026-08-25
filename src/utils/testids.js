/**
 * Stable DOM selector contract for agent automation (#641, #791, #795).
 *
 * Every value here is a plain string literal baked into the bundle — nothing
 * is derived from React `useId()`, mount order, counters or locale strings,
 * so recorded scripts survive re-renders, dependency bumps and `?lang=ar`
 * label swaps. These names are a PUBLIC CONTRACT: renaming one is a breaking
 * change and must be called out in CHANGELOG-API.md.
 *
 * Documented for agents in public/llms.txt ("DOM selector contract").
 */
export const TESTIDS = Object.freeze({
  // App shell roots — one per entry point (#795).
  appRoot: 'app-root',
  embedRoot: 'embed-root',
  comparePage: 'compare-page',

  // Header (main entry only; /embed renders chrome-free by design).
  shareButton: 'share-button',
  viewSelect: 'view-select',
  hwPreset: 'hw-preset',

  // Simulation controls (SpeedControls panel).
  simToggle: 'sim-toggle', // Start/Pause Simulation
  simReset: 'sim-reset',
  prefillRange: 'speed-prefill-range',
  prefillInput: 'speed-prefill-input',
  decodeRange: 'speed-decode-range',
  decodeInput: 'speed-decode-input',
  timeScaleOption: 'time-scale-option', // suffixed with the multiplier, e.g. time-scale-option-5x

  // Run-state regions.
  runState: 'run-state', // aria-live run phase/status region per visualizer
  liveRegion: 'live-region', // polite announcer (AriaLiveRegion)
});

/**
 * Build-stable suffix for a ChartDataTable derived from its caption.
 * Replaces the old mount-order-dependent `useId()` value (#641): two tables
 * with the same caption intentionally map to the same slug, and captions are
 * English source strings (not translated), so the slug never changes with
 * locale.
 */
export function chartTableSlug(caption) {
  return String(caption || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'table';
}

/** Full data-testid for a ChartDataTable region. */
export const chartTableTestId = (caption) => `chart-data-table-${chartTableSlug(caption)}`;
