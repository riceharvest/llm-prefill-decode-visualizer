// LocalMaxxing preset identity helpers.
//
// Applying a measured run sets TWO disconnected pieces of state: App-level
// `preset=lmx:<runId>` (+ baked speeds) and picker-level wizard selection
// (`lmxRun`/`lmxModel`/`lmxQuant`/`lmxHw` URL params). When the wizard clears
// its selection while an `lmx:` preset is still live at App level, the app
// manufactures #596's dead-preset shape: nothing can resolve the id anymore
// and every machine-readable surface stops attributing the live numbers (#851).

export function lmxPresetId(runId) {
  return `lmx:${runId}`;
}

export function runIdFromLmxPreset(preset) {
  return typeof preset === 'string' && preset.startsWith('lmx:')
    ? preset.slice(4)
    : null;
}

// True when the picker cleared `clearedRunId` while that exact run's lmx
// preset is the live App-level preset — i.e. the applied-run block just became
// unresolvable and App must reset to a real hardware preset.
export function isDanglingLmxPreset(preset, clearedRunId) {
  if (!clearedRunId) return false;
  return preset === lmxPresetId(clearedRunId);
}
