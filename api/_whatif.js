// Pure what-if decision-diff math (#71).
//
// Where _diff.js compares two *measured runs*, this module compares two
// *decision requests*: /api/best-style constraint sets (context length,
// quant, VRAM budget, fitCheck …). Each set resolves to a ranked option
// list; the diff reports only the deltas:
//   - options ENTERING the feasible set (feasible under B, not under A)
//   - options LEAVING it (feasible under A, not under B)
//   - per-option VRAM headroom change (from the estimated vramFit block)
//
// Input rows are ranked decision rows as produced by bestBody() — each has
// hardwareKey/modelFamily identity and, when fitCheck was enabled, a
// vramFit { fits, headroomGb, ... } estimate.

const round = (x, places = 3) =>
  Number.isFinite(x) ? Math.round(x * 10 ** places) / 10 ** places : null;

/** Stable identity of an option: hardware rig × model family. */
export function optionKey(row) {
  return `${row.hardwareKey}|${row.modelFamily}`;
}

/** Slim public projection of an option (no per-row stats bloat). */
function optionRef(row) {
  return {
    key: optionKey(row),
    hardware: row.hardware ?? null,
    hardwareKey: row.hardwareKey ?? null,
    hwClass: row.hwClass ?? null,
    modelFamily: row.modelFamily ?? null,
    exampleModel: row.exampleModel ?? null,
    quantization: row.quantization ?? null
  };
}

function fitsFlag(row) {
  return row?.vramFit?.fits ?? null;
}

function headroomGb(row) {
  const h = row?.vramFit?.headroomGb;
  return Number.isFinite(h) ? h : null;
}

/**
 * Diff two ranked option lists. Order-independent for set membership;
 * rank positions are carried through so callers can show movement.
 *
 * Returns {
 *   counts: { aOnly, bOnly, shared },
 *   entered: [option + rankB],       // feasible only under B
 *   left:    [option + rankA],       // feasible only under A
 *   headroom: [ { key, …, headroomGbA, headroomGbB, headroomDeltaGb,
 *                 fitsA, fitsB } ],  // shared options with a measurable shift or fit flip
 *   summary: plain-language string
 * }
 */
export function computeWhatIfDiff(rowsA = [], rowsB = []) {
  const indexA = new Map(rowsA.map((r, i) => [optionKey(r), { row: r, rank: i + 1 }]));
  const indexB = new Map(rowsB.map((r, i) => [optionKey(r), { row: r, rank: i + 1 }]));

  const entered = [];
  const left = [];
  const sharedKeys = [];

  for (const [key, { row, rank }] of indexB) {
    if (!indexA.has(key)) entered.push({ ...optionRef(row), rankB: rank });
    else sharedKeys.push(key);
  }
  for (const [key, { row, rank }] of indexA) {
    if (!indexB.has(key)) left.push({ ...optionRef(row), rankA: rank });
  }

  const headroom = [];
  let fitFlips = 0;
  for (const key of sharedKeys) {
    const a = indexA.get(key).row;
    const b = indexB.get(key).row;
    const ha = headroomGb(a);
    const hb = headroomGb(b);
    const fitsA = fitsFlag(a);
    const fitsB = fitsFlag(b);
    const flipped = fitsA !== null && fitsB !== null && fitsA !== fitsB;
    if (flipped) fitFlips += 1;
    if (ha === null && hb === null && !flipped) continue; // nothing measurable
    headroom.push({
      ...optionRef(a),
      rankA: indexA.get(key).rank,
      rankB: indexB.get(key).rank,
      headroomGbA: round(ha),
      headroomGbB: round(hb),
      headroomDeltaGb: ha !== null && hb !== null ? round(hb - ha) : null,
      fitsA,
      fitsB
    });
  }
  // Biggest absolute headroom change first.
  headroom.sort((x, y) =>
    Math.abs(y.headroomDeltaGb ?? 0) - Math.abs(x.headroomDeltaGb ?? 0));

  return {
    counts: { aOnly: left.length, bOnly: entered.length, shared: sharedKeys.length },
    entered,
    left,
    headroom,
    summary: buildSummary({ entered, left, headroom, sharedCount: sharedKeys.length, fitFlips })
  };
}

// Locale-invariant (#652): no thousands grouping inside JSON prose — a
// regex-extracted magnitude from "12,000 GB" would read as 12.
function fmtGb(x) {
  const n = Math.abs(Number(x));
  const s = Number.isInteger(n) ? String(n) : String(Math.round(n * 10) / 10);
  return `${s} GB`;
}

function nameOf(entry) {
  return entry.hardware || entry.hardwareKey || 'unknown rig';
}

function buildSummary({ entered, left, headroom, sharedCount, fitFlips }) {
  const hasHeadroomShift = headroom.some(h =>
    (h.headroomDeltaGb ?? 0) !== 0 || (h.fitsA !== null && h.fitsB !== null && h.fitsA !== h.fitsB));
  if (!entered.length && !left.length && !hasHeadroomShift) {
    return `Both constraint sets resolve to the same ${sharedCount} option(s); no what-if deltas.`;
  }
  const parts = [];
  if (entered.length) {
    parts.push(`${entered.length} option(s) enter the feasible set (${entered.slice(0, 3).map(nameOf).join(', ')})`);
  }
  if (left.length) {
    parts.push(`${left.length} option(s) leave it (${left.slice(0, 3).map(nameOf).join(', ')})`);
  }
  if (!parts.length) {
    parts.push(`all ${sharedCount} shared option(s) stay feasible`);
  }
  let s = `What-if result: ${parts.join('; ')}.`;
  if (fitFlips) s += ` ${fitFlips} shared option(s) flip their estimated fit verdict.`;
  const biggest = headroom.find(h => (h.headroomDeltaGb ?? 0) !== 0);
  if (biggest) {
    const dir = biggest.headroomDeltaGb >= 0 ? 'gains' : 'loses';
    s += ` Largest headroom shift: ${nameOf(biggest)} (${biggest.modelFamily || '?'}) ${dir} ${fmtGb(biggest.headroomDeltaGb)} (${fmtGb(biggest.headroomGbA)} → ${fmtGb(biggest.headroomGbB)}).`;
  }
  return s;
}
