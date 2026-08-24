// Unified VRAM-source-of-truth helpers for the KV-cache view (#988).
//
// The memory ledger and the VRAM budget planner resolved ?gpu=/?vram= with
// OPPOSITE precedence (ledger: explicit vram wins; planner: gpu preset only),
// and two of three GPU pickers updated only one side — normal clicks minted a
// permanently divergent ?gpu=&vram= pair whose panels rendered contradictory
// fits. These helpers give both panels one resolution rule and keep every
// picker's two state slots in sync.

/**
 * Effective budget VRAM: an explicit ledger override (> 0) wins over the
 * selected GPU preset's capacity; without a catalog GPU there is no verdict.
 *
 * @param {{vramGb: number}|null} selectedGpu
 * @param {number} gpuVramGb ledger VRAM state (may be a manual override)
 * @returns {number|null}
 */
export function resolveBudgetVramGb(selectedGpu, gpuVramGb) {
  const override = Number(gpuVramGb);
  if (selectedGpu && Number.isFinite(override) && override > 0) return override;
  return selectedGpu ? selectedGpu.vramGb : null;
}

/**
 * State patch for a GPU-picker change so BOTH panels stay consistent:
 * selecting a preset id also selects its capacity; unknown/cleared ids only
 * clear the id (custom typed VRAM stays).
 *
 * @param {string} id target GPU preset id ('' to clear)
 * @param {Array<{id: string, vramGb: number}>} catalog
 * @returns {{gpuId: string, gpuVramGb?: number}}
 */
export function gpuSelectionPatch(id, catalog) {
  const gpu = (catalog || []).find(g => g.id === id) || null;
  return gpu ? { gpuId: id, gpuVramGb: gpu.vramGb } : { gpuId: id };
}
