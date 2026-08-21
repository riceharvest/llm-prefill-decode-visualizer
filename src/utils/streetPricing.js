// Street-price estimates and retailer links for recommended hardware.
//
// Pure data + functions so both the API (/api/best attaches a `pricing`
// object to every ranked rig) and the UI (HardwareComparison panels) show
// the same numbers from one source of truth.
//
// Prices are hand-curated street estimates (new + used mix) in USD, not
// live quotes — every response carries an `asOf` date so agents can judge
// staleness, plus direct eBay/Craigslist search links to verify.

export const PRICES_AS_OF = '2026-08-15';

const GPU_TABLE = [
  { match: /rtx\s*pro\s*6000|6000\s*blackwell/, vramGb: 96, estimateUsd: 8500, lowUsd: 7800, highUsd: 9500 },
  { match: /rtx\s*5090/, vramGb: 32, estimateUsd: 2500, lowUsd: 2300, highUsd: 2900 },
  { match: /rtx\s*5080/, vramGb: 16, estimateUsd: 1250, lowUsd: 1150, highUsd: 1400 },
  { match: /rtx\s*5070\s*ti/, vramGb: 16, estimateUsd: 850, lowUsd: 780, highUsd: 950 },
  { match: /rtx\s*5070/, vramGb: 12, estimateUsd: 580, lowUsd: 520, highUsd: 650 },
  { match: /rtx\s*5060\s*ti/, vramGb: 16, estimateUsd: 500, lowUsd: 440, highUsd: 560 },
  { match: /rtx\s*5060/, vramGb: 8, estimateUsd: 320, lowUsd: 280, highUsd: 360 },
  { match: /rtx\s*6000\s*ada/, vramGb: 48, estimateUsd: 6800, lowUsd: 6200, highUsd: 7500 },
  { match: /rtx\s*a6000|rtx\s*a?6000/, vramGb: 48, estimateUsd: 4200, lowUsd: 3500, highUsd: 4800 },
  { match: /l40s/, vramGb: 48, estimateUsd: 7500, lowUsd: 6800, highUsd: 8500 },
  { match: /h100/, vramGb: 80, estimateUsd: 25000, lowUsd: 22000, highUsd: 30000 },
  { match: /a100.*80|80gb.*a100/, vramGb: 80, estimateUsd: 12000, lowUsd: 9500, highUsd: 15000 },
  { match: /a100/, vramGb: 40, estimateUsd: 6500, lowUsd: 5000, highUsd: 9000 },
  { match: /rtx\s*4090/, vramGb: 24, estimateUsd: 1900, lowUsd: 1700, highUsd: 2300 },
  { match: /rtx\s*3090\s*ti/, vramGb: 24, estimateUsd: 950, lowUsd: 800, highUsd: 1100 },
  { match: /rtx\s*3090/, vramGb: 24, estimateUsd: 850, lowUsd: 700, highUsd: 1000 },
  { match: /rtx\s*4080/, vramGb: 16, estimateUsd: 1000, lowUsd: 900, highUsd: 1150 },
  { match: /rtx\s*4070\s*ti\s*super/, vramGb: 16, estimateUsd: 800, lowUsd: 720, highUsd: 900 },
  { match: /rtx\s*4070\s*super/, vramGb: 12, estimateUsd: 600, lowUsd: 540, highUsd: 680 },
  { match: /rtx\s*4070/, vramGb: 12, estimateUsd: 550, lowUsd: 480, highUsd: 650 },
  { match: /rtx\s*4060\s*ti/, vramGb: 16, estimateUsd: 480, lowUsd: 420, highUsd: 550 },
  { match: /rtx\s*4060/, vramGb: 8, estimateUsd: 300, lowUsd: 260, highUsd: 340 },
  { match: /rtx\s*3080\s*ti/, vramGb: 12, estimateUsd: 550, lowUsd: 450, highUsd: 650 },
  { match: /rtx\s*3080/, vramGb: 10, estimateUsd: 450, lowUsd: 380, highUsd: 550 },
  { match: /rtx\s*3070/, vramGb: 8, estimateUsd: 320, lowUsd: 260, highUsd: 380 },
  { match: /rtx\s*3060/, vramGb: 12, estimateUsd: 250, lowUsd: 200, highUsd: 300 }
];

// Apple-silicon unified-memory systems are priced as whole machines,
// keyed by chip variant (the dataset's `chip` field).
const UNIFIED_TABLE = [
  { match: /m3\s*ultra/, memGb: 192, estimateUsd: 7500, lowUsd: 7000, highUsd: 9500, label: 'Mac Studio M3 Ultra' },
  { match: /m2\s*ultra/, memGb: 192, estimateUsd: 6000, lowUsd: 5200, highUsd: 7200, label: 'Mac Studio M2 Ultra' },
  { match: /m4\s*max/, memGb: 128, estimateUsd: 4000, lowUsd: 3500, highUsd: 4800, label: 'Mac Studio M4 Max' },
  { match: /m5\s*max/, memGb: 128, estimateUsd: 4200, lowUsd: 3800, highUsd: 5000, label: 'Mac Studio M5 Max' },
  { match: /m5\s*pro/, memGb: 64, estimateUsd: 2600, lowUsd: 2300, highUsd: 3200, label: 'Mac Studio M5 Pro' },
  { match: /m\d+\s*max/, memGb: 64, estimateUsd: 2500, lowUsd: 2000, highUsd: 3200, label: 'Apple silicon Max-class' },
  { match: /m\d+\s*pro/, memGb: 48, estimateUsd: 1800, lowUsd: 1500, highUsd: 2400, label: 'Apple silicon Pro-class' },
  { match: /strix\s*halo|radeon\s*8060s|ai\s*max/, memGb: 128, estimateUsd: 2000, lowUsd: 1700, highUsd: 2600, label: 'AMD Strix Halo mini PC' }
];

function round(x) {
  return Math.round(x * 100) / 100;
}

/** Find the price-table entry for a discrete GPU name (or null). */
export function matchGpu(gpuName) {
  if (!gpuName) return null;
  const name = String(gpuName).toLowerCase();
  return GPU_TABLE.find(e => e.match.test(name)) || null;
}

/** Find the whole-machine entry for a unified-memory system (or null). */
export function matchUnified(chip, unifiedMemoryGb) {
  if (!chip && !unifiedMemoryGb) return null;
  const c = String(chip || '').toLowerCase();
  return UNIFIED_TABLE.find(e => e.match.test(c)) || null;
}

/**
 * Deterministic search URLs so an agent (or human) can verify the estimate
 * against live listings right now.
 */
export function retailerLinks(query) {
  const q = encodeURIComponent(String(query || '').trim());
  return {
    ebay: `https://www.ebay.com/sch/i.html?_nkw=${q}`,
    ebayUsed: `https://www.ebay.com/sch/i.html?_nkw=${q}&rt=nc&LH_ItemCondition=3000`,
    craigslist: `https://www.craigslist.org/search/sss?query=${q}`
  };
}

/**
 * Street-price estimate for a rig, given the fields /api/best already has
 * on each ranked result ({ gpu, hwClass, gpuCount, chip, unifiedMemoryGb }).
 * Returns a pricing object, or null when we have no usable anchor
 * (cpu_only rigs, unknown GPUs) — never invents a number.
 */
export function estimateStreetPrice({ gpu, hwClass, gpuCount = 1, chip, unifiedMemoryGb } = {}) {
  const cls = String(hwClass || '').toLowerCase();
  const n = Math.max(1, Math.round(Number(gpuCount) || 1));
  let entry;
  let kind;
  let query;

  if (cls === 'unified') {
    entry = matchUnified(chip, unifiedMemoryGb);
    if (!entry) return null;
    kind = 'complete_system';
    query = entry.label;
  } else if (cls === 'cpu_only') {
    return null;
  } else {
    entry = matchGpu(gpu);
    if (!entry) return null;
    kind = n > 1 ? 'per_gpu_x_count' : 'per_gpu';
    query = String(gpu);
  }

  const scale = cls === 'unified' ? 1 : n;
  return {
    kind,
    currency: 'USD',
    estimateUsd: round(entry.estimateUsd * scale),
    lowUsd: round(entry.lowUsd * scale),
    highUsd: round(entry.highUsd * scale),
    ...(cls === 'unified'
      ? {}
      : { perGpu: { estimateUsd: entry.estimateUsd, lowUsd: entry.lowUsd, highUsd: entry.highUsd }, gpuCount: n }),
    conditionNote: cls === 'unified'
      ? 'Whole-machine street estimate (base config with this memory).'
      : n > 1
        ? `Street estimate across ${n} cards (used/new mix).`
        : 'Single-card street estimate (used/new mix).',
    asOf: PRICES_AS_OF,
    links: retailerLinks(query)
  };
}

/**
 * Best-effort pricing straight from a human preset label like
 * "Dual RTX 3090 48GB (TP2 …)" or "Apple Mac Studio M3/M2 Ultra (192GB)".
 * Used by the UI panels where only a display name is available.
 * Returns null when nothing in the label maps to a price anchor.
 */
export function estimateFromLabel(label) {
  const s = String(label || '');
  if (!s) return null;
  if (/mac studio|ultra/i.test(s) && !/rtx/i.test(s)) {
    // Unified-memory Apple systems are priced as complete machines.
    const chip = /m2/i.test(s) && !/m3/i.test(s) ? 'M2 Ultra' : 'M3 Ultra';
    return estimateStreetPrice({ hwClass: 'unified', chip });
  }
  const gpuCount = /\bdual\b|\b2\s*[x×]\b/i.test(s) ? 2 : 1;
  const entry = matchGpu(s);
  if (!entry) return null;
  const gpuName = s.toLowerCase().match(entry.match)?.[0];
  return estimateStreetPrice({ gpu: gpuName, hwClass: 'discrete_gpu', gpuCount });
}
