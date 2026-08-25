// Query builder for the Find-HW shortlist's /api/best call (#771).
//
// The tab used to fetch a fixed top-50-by-decode pool and apply constraints
// client-side only, producing false "no rig meets these constraints" states
// while /api/best?maxVramGb=8 returned rows. Constraints are now pushed
// server-side too; this module keeps the param mapping in one testable place.

/**
 * @param {{model?: string, minDecode?: string|number, maxVram?: string|number, quant?: string}} filters
 * @returns {URLSearchParams} ready-to-send query (by=decode&limit=50 baseline).
 */
export function buildBestQuery(filters = {}) {
  const params = new URLSearchParams({ by: 'decode', limit: '50' });
  const { model, minDecode, maxVram, quant } = filters;
  if (model && String(model).trim()) params.set('model', String(model).trim());
  if (minDecode !== '' && minDecode != null && Number(minDecode) > 0) {
    params.set('minDecode', String(Number(minDecode)));
  }
  if (maxVram !== '' && maxVram != null && Number(maxVram) > 0) {
    params.set('maxVramGb', String(Number(maxVram)));
  }
  if (quant && String(quant).trim()) params.set('quant', String(quant));
  return params;
}

/** True when any workload constraint is active (drives pool-cap messaging). */
export function hasActiveConstraints(filters = {}) {
  return buildBestQuery(filters).toString() !== new URLSearchParams({ by: 'decode', limit: '50' }).toString();
}
