// Scenario preset identity helpers (#786).
//
// The UI used to derive "which preset is active" purely by reverse-matching
// token counts with an order-dependent .find() — any colliding token pair or
// array reorder silently reassigned which id the DOM reported. Presets applied
// by id now win over the token-count heuristic; the exact-match fallback keeps
// hand-typed token counts lighting up their preset as before.

/**
 * Resolve the active scenario chip.
 *
 * @param {Array<{id: string, promptTokens: number, outputTokens: number}>} presets
 * @param {string|null} appliedId - stored id of the preset the user actually applied.
 * @param {number} promptTokens
 * @param {number} outputTokens
 * @returns {object|null}
 */
export function resolveActiveScenario(presets, appliedId, promptTokens, outputTokens) {
  if (appliedId) {
    const byId = presets.find(p => p.id === appliedId);
    if (byId) return byId;
  }
  return presets.find(s => s.promptTokens === promptTokens && s.outputTokens === outputTokens) || null;
}
