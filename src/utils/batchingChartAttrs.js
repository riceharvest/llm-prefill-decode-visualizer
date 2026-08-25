/**
 * Chart data attributes for the Batching view (#715).
 *
 * All four batching charts encode values purely as CSS geometry (left/width %
 * of makespan, height % of max). These pure helpers build `data-*` attribute
 * objects carrying the RAW numerics alongside the styling percentages, so an
 * agent can read exact milliseconds / sequence counts / ITL values from the
 * DOM without reverse-engineering computed styles and axis labels.
 *
 * All values are stringified numbers in milliseconds or tokens; spread the
 * returned object onto the corresponding JSX element.
 */

const num = (v) => (Number.isFinite(v) ? String(v) : '');

/** Per-request Gantt row: schedule facts for one request. */
export function requestRowAttrs(req) {
  if (!req) return {};
  return {
    'data-request-id': String(req.id),
    'data-arrival-ms': num(req.arrivalTime),
    'data-ttft-ms': Number.isFinite(req.ttft) ? String(req.ttft) : '',
    'data-finish-ms': Number.isFinite(req.finishTime) ? String(req.finishTime) : '',
    'data-prompt-tokens': String(req.promptTokens ?? ''),
    'data-output-tokens': String(req.outputTokens ?? '')
  };
}

/** Queue-wait gutter segment (arrival → first prefill start). */
export function queueWaitAttrs(queueWaitMs) {
  return { 'data-seg-kind': 'queue', 'data-queue-wait-ms': num(queueWaitMs) };
}

/** One prefill-chunk or decode-run segment of a Gantt row. */
export function segmentAttrs(seg) {
  if (!seg) return {};
  const attrs = {
    'data-seg-kind': seg.kind,
    'data-start-ms': num(seg.tStart),
    'data-end-ms': num(seg.tEnd)
  };
  if (seg.kind === 'prefill') attrs['data-tokens'] = String(seg.tokens ?? '');
  return attrs;
}

/** One occupancy bar (batch size over time steps). */
export function occupancyBarAttrs(size, index, maxBatchSize) {
  return {
    'data-step': String(index + 1),
    'data-seqs': Number.isFinite(size) ? size.toFixed(1) : '',
    'data-batch-capacity': String(maxBatchSize)
  };
}

/** One inter-token-latency histogram bar for the selected request. */
export function itlBarAttrs(itl, index, spike) {
  return {
    'data-step': String(index + 1),
    'data-itl-ms': num(itl),
    ...(spike ? { 'data-spike': 'true' } : {})
  };
}
