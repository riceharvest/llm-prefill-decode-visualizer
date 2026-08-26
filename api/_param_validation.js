// Shared additive parameter-validation warnings for the data endpoints
// (/api/benchmarks, /api/localmaxxing) — issue #443.
//
// These endpoints strictly validate some params (e.g. context_band 400s on
// garbage) while silently swallowing others: an unknown ?groupBy= or a
// non-numeric ?max_age= used to return a 200 identical to the default query
// with warnings: []. These helpers produce machine-readable warning objects
// for the silent-ignore cases so a typo'd filter never looks like a
// successful query. They NEVER change status codes, math, or existing
// fields — purely additive entries appended to the envelope's warnings[].

/** Canonical ?groupBy= cohort keys shared by /api/benchmarks. */
export const GROUP_BY_VALUES = ['hardware', 'model', 'quant', 'hardwareModel'];

function baseWarning(code, param, requested, used, message) {
  return {
    code,
    param,
    requested: String(requested),
    ...(used === undefined || used === null ? {} : { used: String(used) }),
    message
  };
}

/**
 * Warning for an enum-ish param whose value is not one of the canonical
 * spellings (the endpoint silently applies its default instead). Returns
 * null when the param was absent/empty or exactly valid.
 *
 * @param {string} param        query-param name as documented (e.g. 'groupBy')
 * @param {*}      raw          raw query value (may be undefined)
 * @param {string[]} valid      canonical values
 * @param {string} applied      the value the handler actually used
 */
export function enumParamWarning(param, raw, valid, applied) {
  if (raw === undefined || raw === null || raw === '') return null;
  const value = String(raw);
  if (valid.includes(value)) return null;
  return baseWarning(
    'param_value_ignored',
    param,
    value,
    applied,
    `Unknown ${param} "${value}" — ignored; applied "${applied}" instead. Valid values: ${valid.join(', ')}.`
  );
}

/**
 * Warning for a numeric param that must be a positive number but arrived
 * unparseable or <= 0 (the endpoint silently drops the filter / falls back
 * to its default page size). Returns null when absent/empty or valid.
 *
 * @param {string} param    query-param name (e.g. 'max_age', 'limit')
 * @param {*}      raw      raw query value
 * @param {*}      applied  the effective value used (number|null)
 * @param {string} [effect] human phrase for what happened, e.g.
 *                          'filter not applied' / 'used the default of 50'
 */
export function positiveNumberParamWarning(param, raw, applied, effect) {
  if (raw === undefined || raw === null || raw === '') return null;
  const n = Number(raw);
  if (Number.isFinite(n) && n > 0) return null;
  return baseWarning(
    'param_value_ignored',
    param,
    raw,
    applied,
    `${param}="${raw}" is not a positive number — ignored (${effect || 'filter not applied'}).`
  );
}

/**
 * Warnings for params that are inert on the /api/localmaxxing INDEX shape:
 * without a hardware/model/quant filter the endpoint returns the
 * hardware-group summary and never paginates, so ?limit=/&cursor= do
 * nothing (#443 repro: `?limit=-5` → 200 summary, zero signal).
 *
 * @param {object} q request query object
 * @returns {object|null}
 */
export function indexModeIgnoredParamsWarning(q = {}) {
  const inert = ['limit', 'cursor'].filter(k => q[k] !== undefined && q[k] !== '');
  if (inert.length === 0) return null;
  return {
    code: 'param_ignored_in_index_mode',
    param: inert.join(','),
    requested: inert.map(k => `${k}=${q[k]}`).join('&'),
    message: `No hardware/model/quant filter given, so this is the hardware-group summary (mode "index") — ${inert.map(k => `?${k}=`).join(' and ')} only apply to the paginated run list (pass ?hardware=, ?model= or ?quant=).`
  };
}
