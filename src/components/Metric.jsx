import React from 'react';

// Why-explainer registry (issue #87): every entry powers a hover popover on a
// metric readout with plain-language meaning, the exact formula, a live
// substitution computed from the current inputs, and a link into the Theory tab.
export const WHY_TERMS = {
  ttft: {
    label: 'TTFT — time to first token',
    meaning: 'How long you wait after sending a prompt before the first output token appears. It is dominated by prefilling the whole prompt.',
    formula: 'TTFT = prompt tokens ÷ prefill speed',
    anchor: 'theory-prefill'
  },
  tpot: {
    label: 'TPOT — time per output token',
    meaning: 'Average gap between each generated token while decoding. Lower TPOT feels like faster typing.',
    formula: 'TPOT = 1000 ms ÷ decode speed',
    anchor: 'theory-decode'
  },
  walltime: {
    label: 'Total chat walltime',
    meaning: 'End-to-end time for the whole request: one prefill pass plus every decoded token.',
    formula: 'walltime = TTFT + TPOT × output tokens',
    anchor: 'theory-prefill'
  },
  throughput: {
    label: 'Effective throughput',
    meaning: 'How many tokens per second the request delivers on average when prefill and decode are combined. Always higher than decode speed alone because prefill ingests in parallel.',
    formula: 'throughput = (prompt + output tokens) ÷ walltime',
    anchor: 'theory-decode'
  },
  decodeTime: {
    label: 'Decode time',
    meaning: 'Total time spent generating all output tokens one by one after prefill finishes.',
    formula: 'decode time = output tokens ÷ decode speed',
    anchor: 'theory-decode'
  },
  walltimePctPrefill: {
    label: 'Prefill share of walltime',
    meaning: 'Fraction of total time spent on prompt ingestion. Long prompts push this up; long outputs push it down.',
    formula: 'prefill % = TTFT ÷ walltime × 100',
    anchor: 'theory-prefill'
  },
  walltimePctDecode: {
    label: 'Decode share of walltime',
    meaning: 'Fraction of total time spent generating tokens one by one. This dominates for chatty, long-output workloads.',
    formula: 'decode % = decode time ÷ walltime × 100',
    anchor: 'theory-decode'
  },
  agentWalltime: {
    label: 'Agent loop walltime',
    meaning: 'Summed time of every turn in the agent loop. Each turn adds context, so later turns prefill more tokens unless prefix caching reuses the KV cache.',
    formula: 'walltime = Σ turns (turn prefill + turn decode)',
    anchor: 'theory-agentic'
  },
  speedupTotal: {
    label: 'Overall walltime speedup',
    meaning: 'How many times faster System B finishes the same workload than System A. Below 1x means B is slower end to end.',
    formula: 'speedup = walltime B ÷ walltime A',
    anchor: 'theory-decode'
  },
  speedupPrefill: {
    label: 'TTFT advantage',
    meaning: 'How many times faster System B reaches the first token than System A — driven purely by prefill speed.',
    formula: 'advantage = TTFT B ÷ TTFT A',
    anchor: 'theory-prefill'
  },
  speedupDecode: {
    label: 'Decode advantage',
    meaning: 'How many times faster System B generates the output tokens than System A — driven by memory bandwidth vs model size.',
    formula: 'advantage = decode B ÷ decode A',
    anchor: 'theory-decode'
  },
  kvPerToken: {
    label: 'KV cache bytes per token',
    meaning: 'VRAM needed to cache the keys and values for one context token across all layers. GQA divides it by KV-head grouping; MLA compresses it into a latent vector.',
    formula: 'bytes/token = 2 × layers × kv heads × head dim × bytes per element',
    anchor: 'theory-agentic'
  },
  kvTotal: {
    label: 'Total KV cache VRAM',
    meaning: 'VRAM the KV cache occupies at the chosen context length and batch size. It grows linearly with context and competes directly with model weights for memory.',
    formula: 'total = KV bytes/token × context × batch size',
    anchor: 'theory-agentic'
  },
  gpuSplitVram: {
    label: 'Per-GPU VRAM share',
    meaning: 'What one card in a multi-GPU layout must hold: its slice of the sharded weights plus its KV share (sharded, or fully replicated when tensor parallel cannot divide the KV heads) plus CUDA/activation overhead.',
    formula: 'per GPU = weights ÷ N + KV share + ~1.5 GB overhead',
    anchor: 'theory-decode'
  },
  gpuDecodePenalty: {
    label: 'Interconnect decode penalty',
    meaning: 'Decode tok/s lost to cross-GPU synchronization. Tensor parallel all-reduces over the bus every step (PCIe ≈ −10%, NVLink ≈ −3%); pipeline parallel only pays a bubble (≈ −2%).',
    formula: 'effective decode = single-GPU tok/s × (1 − penalty)',
    anchor: 'theory-decode'
  },
  batchMakespan: {
    label: 'Batch makespan',
    meaning: 'Walltime from the first arrival until the last request finishes. Continuous batching shortens it because new requests join as soon as a slot frees instead of waiting for a whole cohort.',
    formula: 'makespan = finish time of last request − first arrival',
    anchor: 'theory-agentic'
  },
  batchAvgTtft: {
    label: 'Average TTFT across the batch',
    meaning: 'Mean wait from request arrival to first token. Queuing behind other requests inflates TTFT even when prefill itself is fast.',
    formula: 'avg TTFT = Σ (first token time − arrival time) ÷ requests',
    anchor: 'theory-prefill'
  },
  batchWorstItl: {
    label: 'Worst inter-token latency',
    meaning: 'Largest gap between two consecutively decoded tokens of any request. Spikes happen when a step also carries a big prefill chunk — chunked prefill caps them.',
    formula: 'ITL = duration between successive decode steps',
    anchor: 'theory-decode'
  },
  batchThroughput: {
    label: 'Aggregate decode throughput',
    meaning: 'Total output tokens per second of walltime across all concurrent requests. This is the headline win of continuous batching over serving one request at a time.',
    formula: 'throughput = total output tokens ÷ makespan',
    anchor: 'theory-decode'
  },
  batchOccupancy: {
    label: 'Batch occupancy',
    meaning: 'Average fraction of the max batch slots that hold a running sequence. Low occupancy means the engine is paying for capacity it is not using.',
    formula: 'occupancy = avg running sequences ÷ max batch size',
    anchor: 'theory-agentic'
  },
  batchQueueWait: {
    label: 'Queue wait',
    meaning: 'Time a request spends waiting between arrival and its first prefill chunk. It grows when arrivals outpace batch slots or long prefills stall the step loop.',
    formula: 'queue wait = first prefill chunk start − arrival time',
    anchor: 'theory-agentic'
  }
};

function theoryHref(anchor) {
  try {
    const url = new URL(window.location.href);
    url.searchParams.set('tab', 'theory');
    url.hash = anchor;
    return url.href;
  } catch {
    return `?tab=theory#${anchor}`;
  }
}

/**
 * Wraps a live number/metric readout with a dotted underline and a hover/focus
 * popover: plain-language meaning, exact formula, live substitution with the
 * current inputs, and a link to the matching Theory tab section.
 *
 * props:
 *  - term: key of WHY_TERMS
 *  - substitution: string showing the formula filled with the current inputs
 *  - align: optional 'left' to keep narrow-context popovers on-screen
 */
export default function Metric({ term, substitution, align, children }) {
  const info = WHY_TERMS[term];
  if (!info) return <>{children}</>;

  const popClass = `why-pop${align === 'left' ? ' why-pop-left' : ''}`;
  const describedBy = `why-${term}`;

  return (
    <span className="why-term" tabIndex={0} aria-describedby={describedBy}>
      {children}
      <span className={popClass} role="tooltip" id={describedBy}>
        <strong className="why-pop-title">{info.label}</strong>
        <span className="why-pop-meaning">{info.meaning}</span>
        <code className="why-pop-formula">{info.formula}</code>
        {substitution && (
          <span className="why-pop-sub">
            With your inputs:{' '}
            <code>{substitution}</code>
          </span>
        )}
        <a className="why-pop-link" href={theoryHref(info.anchor)}>
          Open Theory section →
        </a>
      </span>
    </span>
  );
}
