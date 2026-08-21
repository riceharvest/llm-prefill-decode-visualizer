import React from 'react';
import { t } from '../i18n/strings';

/**
 * Green/red pass/fail pill for one SLO check (issue #64).
 *
 * props:
 *  - result: an evaluateMetric() result ({ pass, marginPct }) or null/undefined
 *    when the budget for this metric is disabled (renders nothing).
 *  - label: short metric name shown in the badge ('TTFT', 'TPOT', 'Walltime').
 */
export default function SloBadge({ result, label }) {
  if (!result) return null;
  const pct = Math.abs(result.marginPct);
  const pctText = Number.isFinite(pct) ? `${pct.toFixed(0)}%` : '∞';
  const text = t(result.pass ? 'slo.badgePass' : 'slo.badgeFail', { label, pct: pctText });
  const tooltip = result.pass
    ? t('slo.badgePassTooltip', { label, budget: result.budget })
    : t('slo.badgeFailTooltip', { label, budget: result.budget });
  return (
    <span className={`tag ${result.pass ? 'slo-pass' : 'slo-fail'}`} title={tooltip}>
      {text}
    </span>
  );
}
