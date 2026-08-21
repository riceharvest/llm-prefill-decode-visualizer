// Power-draw and thermal-feasibility estimates for recommended hardware.
//
// Pure data + functions so both the API (/api/best attaches a `power`
// object to every ranked rig) and the UI (HardwareComparison panels) show
// the same numbers from one source of truth.
//
// Figures are hand-curated estimates in watts: nameplate board power
// ("TDP") per card, typical whole-rig wall draw under sustained inference
// load, and a recommended PSU size with headroom for CPU, platform and
// transient spikes. Every response carries an `asOf` date so agents can
// judge staleness. Estimates only — always check the actual card's spec
// sheet before buying a PSU.

export const POWER_AS_OF = '2026-08-22';

// Standard ATX PSU sizes recommendations round up to.
const PSU_SIZES = [450, 550, 650, 750, 850, 1000, 1200, 1500, 1600];

// Fixed platform allowance added to summed board power when sizing a PSU:
// CPU + RAM + drives + fans + transient spike headroom.
const PLATFORM_HEADROOM_WATTS = 350;

// Rest-of-system draw added on top of GPU load to estimate whole-rig wall
// wattage during sustained inference.
const DISCRETE_PLATFORM_LOAD_WATTS = 120;

// Largest common consumer PSU; beyond this you're into dual-PSU or
// server-platform territory and we refuse to name a single number.
const MAX_SINGLE_PSU_WATTS = 1600;

// Discrete GPUs: board power (TDP) per card and typical sustained per-card
// draw while serving tokens. Order matters — more specific patterns first.
const GPU_TABLE = [
  { match: /rtx\s*5090/, tdpWatts: 575, note: '12V-2x6 connector; brief spikes past 600W — an ATX 3.x PSU is strongly recommended.' },
  { match: /h100/, tdpWatts: 700, note: 'SXM5 module for server platforms — power delivery is the datacenter\'s problem, not a desktop PSU\'s.' },
  { match: /\ba?100\b|a100/, tdpWatts: 400, note: 'PCIe A100 cards draw up to 400W over one 8-pin EPS-style connector plus aux.' },
  { match: /rtx\s*pro\s*6000|6000\s*blackwell/, tdpWatts: 600, note: 'Workstation board; size cooling for sustained multi-hour inference at full board power.' },
  { match: /rtx\s*6000\s*ada/, tdpWatts: 300, note: 'Ada workstation cards are power-friendly for their VRAM class.' },
  { match: /l40s/, tdpWatts: 350, note: 'Passive datacenter cooler — needs a proper server chassis, not a desktop case.' },
  { match: /rtx\s*a6000|rtx\s*a?6000/, tdpWatts: 300, note: 'Ampere workstation board; blower cooler suits dense multi-GPU builds.' },
  { match: /rtx\s*4090/, tdpWatts: 450, note: 'Transient spikes exceed 600W; use a native ATX 3.x / 12V-2x6 connection, not adapters.' },
  { match: /rtx\s*3090\s*ti/, tdpWatts: 450, note: '450W board power with 12VHPWR connector — same transient caveats as a 4090.' },
  { match: /rtx\s*3090/, tdpWatts: 350, note: 'Power-limiting to ~280W costs ~5% token speed for ~20% less heat and fan noise.' },
  { match: /rtx\s*5080/, tdpWatts: 360, note: '12V-2x6 connector on a 360W board.' },
  { match: /rtx\s*4080/, tdpWatts: 320, note: '' },
  { match: /rtx\s*5070\s*ti/, tdpWatts: 300, note: '' },
  { match: /rtx\s*4070\s*ti\s*super/, tdpWatts: 285, note: '' },
  { match: /rtx\s*4070/, tdpWatts: 200, note: '' },
  { match: /rtx\s*4060\s*ti/, tdpWatts: 160, note: 'Single 8-pin; fits almost any existing build.' },
  { match: /rtx\s*4060/, tdpWatts: 115, note: 'Runs off a single 8-pin; sips power for its class.' },
  { match: /rtx\s*3080\s*ti/, tdpWatts: 350, note: '' },
  { match: /rtx\s*3080/, tdpWatts: 320, note: 'GDDR6X runs hot — keep airflow on the memory, not just the core.' },
  { match: /rtx\s*3070/, tdpWatts: 220, note: '' },
  { match: /rtx\s*3060/, tdpWatts: 170, note: 'Single 8-pin; the classic low-power budget inference card.' }
];

// Unified-memory systems are whole machines keyed by chip variant
// (the dataset's `chip` field). tdpWatts is the SoC package ceiling;
// loadWatts is measured-at-the-wall whole-machine draw under inference.
const UNIFIED_TABLE = [
  { match: /m3\s*ultra|m2\s*ultra|ultra/, tdpWatts: 140, loadWatts: 180, note: 'Mac Studio sustains full package power 24/7 within its acoustic envelope — no PSU to size (fixed internal supply).' },
  { match: /m\d+\s*max/, tdpWatts: 80, loadWatts: 110, note: 'Max-class Apple silicon throttles rarely under memory-bandwidth-bound decode.' },
  { match: /m\d+\s*pro/, tdpWatts: 60, loadWatts: 90, note: 'Pro-class Apple silicon is efficiency-first; decode is bandwidth-bound, not power-bound.' },
  { match: /strix\s*halo|radeon\s*8060s|ai\s*max/, tdpWatts: 120, loadWatts: 160, note: 'Mini-PC chassis — verify the vendor\'s cooling option (AUPH/FPB) sustains the 120W package.' }
];

function round(x) {
  return Math.round(x * 10) / 10;
}

/** Find the discrete-GPU table entry for a GPU name (or null). */
export function matchGpuPower(gpuName) {
  if (!gpuName) return null;
  const name = String(gpuName).toLowerCase();
  return GPU_TABLE.find(e => e.match.test(name)) || null;
}

/** Find the whole-machine entry for a unified-memory system (or null). */
export function matchUnifiedPower(chip) {
  if (!chip) return null;
  const c = String(chip).toLowerCase();
  return UNIFIED_TABLE.find(e => e.match.test(c)) || null;
}

/**
 * Recommended minimum PSU size from summed board power: board total plus a
 * fixed platform/transient allowance, rounded up to a standard ATX size.
 * Returns null past 1600W — no honest single-PSU answer exists there.
 */
export function recommendPsu(totalBoardPowerWatts) {
  if (!Number.isFinite(totalBoardPowerWatts)) return null;
  const target = totalBoardPowerWatts + PLATFORM_HEADROOM_WATTS;
  if (target > MAX_SINGLE_PSU_WATTS) return null;
  return PSU_SIZES.find(size => size >= target) ?? null;
}

/**
 * Power-draw and thermal-feasibility estimate for a rig, given the fields
 * /api/best already has on each ranked result
 * ({ gpu, hwClass, gpuCount, chip }). Returns a power object, or null when
 * we have no usable anchor (cpu_only rigs, unknown GPUs) — never invents
 * a number. The point (#69): an agent recommending a dual-GPU rig must
 * sanity-check the PSU, or the recommendation fails on delivery.
 */
export function estimatePower({ gpu, hwClass, gpuCount = 1, chip } = {}) {
  const cls = String(hwClass || '').toLowerCase();
  const n = Math.max(1, Math.round(Number(gpuCount) || 1));

  if (cls === 'unified') {
    const entry = matchUnifiedPower(chip);
    if (!entry) return null;
    return {
      kind: 'complete_system',
      gpuCount: null,
      tdpWatts: entry.tdpWatts,
      totalTdpWatts: entry.tdpWatts,
      loadWatts: entry.loadWatts,
      psuWatts: null,
      psuNote: 'Fixed internal supply — no PSU sizing needed.',
      note: entry.note,
      asOf: POWER_AS_OF
    };
  }

  if (cls !== 'discrete_gpu') return null;

  const entry = matchGpuPower(gpu);
  if (!entry) return null;

  const totalTdpWatts = entry.tdpWatts * n;
  // Whole-rig wall draw: per-card sustained draw × count + rest of system.
  const loadWatts = Math.round(n * (entry.tdpWatts * 0.95) + DISCRETE_PLATFORM_LOAD_WATTS);
  const psuWatts = recommendPsu(totalTdpWatts);

  return {
    kind: n > 1 ? 'per_gpu_x_count' : 'per_gpu',
    gpuCount: n,
    tdpWatts: entry.tdpWatts,
    totalTdpWatts,
    loadWatts: round(loadWatts),
    psuWatts,
    psuNote: psuWatts == null
      ? `${totalTdpWatts}W of board power exceeds any single consumer PSU (${MAX_SINGLE_PSU_WATTS}W max) — plan a dual-PSU build or a server platform.`
      : `Round up from ${totalTdpWatts}W board total + ${PLATFORM_HEADROOM_WATTS}W platform/transient allowance.`,
    note: [
      n > 1 ? `${n} cards: verify chassis clearance, blower vs axial coolers, and ${n * 2}× PCIe power connectors before buying.` : '',
      entry.note
    ].filter(Boolean).join(' ') || null,
    asOf: POWER_AS_OF
  };
}
