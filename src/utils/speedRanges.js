// Declared ranges of the global PREFILL/DECODE slider controls
// (src/components/SpeedControls.jsx). Apply paths that inject *measured*
// community speeds (LocalMaxxing runs, quant-matrix rows) must clamp to
// these ranges, otherwise the <input type=range> pins at max while state,
// exports and share URLs carry the raw value — and the first drag silently
// destroys the applied measurement (#850).

export const SPEED_RANGES = {
  prefill: { min: 50, max: 50000, step: 50 },
  decode: { min: 2, max: 1000, step: 1 }
};

// Clamp a single speed to its axis' declared range. Returns a finite number
// within range, or null when the input is not a usable finite number.
export function clampSpeed(value, axis) {
  const range = SPEED_RANGES[axis];
  if (!range) return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.min(range.max, Math.max(range.min, n));
}

// Clamp a prefill/decode pair coming from a measured-data apply path.
// Returns { prefill, decode, clamped } where clamped lists one entry per
// axis whose applied value differs from the requested measurement.
// Returns null when either axis is unusable (caller should reject the apply).
export function clampMeasuredSpeedPair(prefillReq, decodeReq) {
  const prefill = clampSpeed(prefillReq, 'prefill');
  const decode = clampSpeed(decodeReq, 'decode');
  if (prefill === null || decode === null) return null;
  const clamped = [];
  if (prefill !== Number(prefillReq)) {
    clamped.push({ axis: 'prefill', requested: Number(prefillReq), applied: prefill });
  }
  if (decode !== Number(decodeReq)) {
    clamped.push({ axis: 'decode', requested: Number(decodeReq), applied: decode });
  }
  return { prefill, decode, clamped };
}

// Human-readable, non-blocking note for surfaces that had to be clamped.
// Empty string when nothing was clamped.
export function formatClampNotice(clamped) {
  if (!Array.isArray(clamped) || clamped.length === 0) return '';
  const parts = clamped.map(({ axis, requested, applied }) =>
    `${axis} ${requested.toLocaleString()} → ${applied.toLocaleString()} tok/s`
  );
  return `Measured speed exceeds the slider range — clamped: ${parts.join(', ')}.`;
}
