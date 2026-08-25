// Text/AX-tree value channels for the Batching view's three charts (#785).
//
// Every chart segment/bar used to carry its value only in non-standard
// data-tooltip/title attributes — textContent and the accessibility tree
// returned nothing, and the Gantt decode segments carried no timing anywhere.
// These pure builders produce the aria-label strings wired into
// BatchingVisualizer so scrapers get real numbers without pixel math.

function fmtMs(ms) {
  if (!Number.isFinite(ms)) return 'unknown';
  const r = Math.round(ms);
  return `${r.toLocaleString('en-US')} ms`;
}

/** Format an integer with thousands grouping for label text. */
function fmtCount(n) {
  return Number.isFinite(n) ? Math.round(n).toLocaleString('en-US') : '0';
}

/** One Gantt row (request) summary. */
export function ganttRowLabel(req) {
  const ttft = Number.isFinite(req?.ttft) ? `TTFT ${fmtMs(req.ttft)}` : 'TTFT pending';
  return `Request R${req.id}: ${fmtCount(req.promptTokens)} prompt → ${fmtCount(req.outputTokens)} output tokens, ${ttft}`;
}

/** Hatched queue-wait region before a request's first prefill chunk. */
export function queueSegmentLabel(req, waitMs) {
  return `R${req.id} queued ${fmtMs(waitMs)} before prefill started`;
}

/** Prefill chunk segment. seg = { kind:'prefill', tStart, tEnd, tokens }. */
export function prefillSegmentLabel(seg) {
  return `Prefill: ${fmtCount(seg.tokens)} tokens in ${fmtMs((seg.tEnd - seg.tStart))}`;
}

/** Decode run segment — carries the timing the old tooltip omitted entirely. */
export function decodeSegmentLabel(req, seg) {
  const durationMs = Math.max(0, (seg.tEnd - seg.tStart));
  return `Decode R${req.id}: ${req.outputTokens} tokens over ${fmtMs(durationMs)} (${fmtMs(req.outputTokens > 0 ? durationMs / req.outputTokens : NaN)} per token)`;
}

/** Whole occupancy histogram summary for the container role="img". */
export function occupancyChartLabel(bars) {
  if (!bars.length) return 'Batch occupancy per step: empty';
  const max = Math.max(...bars);
  const avg = bars.reduce((a, b) => a + b, 0) / bars.length;
  return `Batch occupancy across ${bars.length} steps: average ${avg.toFixed(1)} sequences, peak ${max.toFixed(1)} sequences`;
}

export function occupancyBarLabel(size, stepIndex) {
  return `Step ${stepIndex + 1}: ${size.toFixed(1)} sequences in batch`;
}

/** ITL series summary for the selected request. */
export function itlChartLabel(itls) {
  if (!itls.length) return 'Per-token inter-token latency: empty';
  const avg = itls.reduce((a, b) => a + b, 0) / itls.length;
  const worst = Math.max(...itls);
  return `Inter-token latency across ${itls.length} decode steps: average ${fmtMs(avg)}, worst ${fmtMs(worst)}`;
}

export function itlBarLabel(itlMs, stepIndex, spike) {
  return `Step ${stepIndex + 1}: ${fmtMs(itlMs)} between tokens${spike ? ' · prefill interleaved in this step' : ''}`;
}
