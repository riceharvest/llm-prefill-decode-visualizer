import React, { useState } from 'react';
import { Target } from 'lucide-react';
import { DEFAULT_SLO_BUDGETS, loadSloBudgets, saveSloBudgets, sanitizeBudgets } from '../utils/slo.js';
import { t } from '../i18n/strings';

/**
 * Hook backing the SLO budgets (issue #64): React state kept in sync with
 * localStorage so budgets persist across reloads and are shared by every tab —
 * the panel lives once in App, above the tab content, and the resulting object
 * is passed down to each visualizer for badge evaluation.
 *
 * Returns [budgets, update, persisted]; persisted is false when the last write
 * failed (private browsing / quota-full) so the UI can warn instead of letting
 * verdict badges silently revert on reload (#779).
 */
export function useSloBudgets() {
  const [budgets, setBudgets] = useState(() => loadSloBudgets());
  const [persisted, setPersisted] = useState(() => loadSloBudgetsPersisted());
  const update = (next) => {
    const clean = sanitizeBudgets(next);
    setBudgets(clean);
    setPersisted(saveSloBudgets(clean)); // boolean result is honored now (#779)
  };
  return [budgets, update, persisted];
}

/** Did budgets load from storage (true) or fall back to defaults? */
function loadSloBudgetsPersisted() {
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem('llmpdv.slo-budgets-v1') != null;
  } catch {
    return false;
  }
}

/**
 * Compact budget editor. Empty or zero input disables that metric's check —
 * its badges disappear and it never counts as failing.
 */
export default function SloBudgetsPanel({ budgets, onChange, persisted = true }) {
  const [open, setOpen] = useState(false);

  const setField = (key, raw) => {
    const n = Number(raw);
    onChange({ ...budgets, [key]: raw === '' || !Number.isFinite(n) ? null : n });
  };

  const fields = [
    { key: 'ttftMs', label: t('slo.ttftLabel'), unit: 'ms', step: '10', min: '1' },
    { key: 'tpotMs', label: t('slo.tpotLabel'), unit: 'ms', step: '1', min: '1' },
    { key: 'walltimeSec', label: t('slo.walltimeLabel'), unit: 's', step: '0.5', min: '0.1' }
  ];

  const enabledCount = fields.filter(f => budgets[f.key] != null).length;

  return (
    <section className="panel" aria-label={t('slo.panelAria')}>
      {!persisted && (
        <p role="status" className="hint-text" style={{ margin: '0 0 8px', fontSize: '0.72rem', color: 'var(--danger)' }}>
          Browser storage unavailable (private mode or quota full) — these budgets will NOT survive a reload; verdict badges will revert to defaults.
        </p>
      )}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
        <button
          onClick={() => setOpen(!open)}
          className="btn"
          aria-expanded={open}
          title={t('slo.toggleTooltip')}
        >
          <Target size={15} />
          <span>
            {t('slo.panelTitle')}:{' '}
            <strong>{enabledCount > 0 ? t('slo.enabledCount', { count: enabledCount }) : t('slo.disabled')}</strong>
          </span>
        </button>

        <p className="hint-text" style={{ margin: 0, fontSize: '0.72rem' }}>
          {t('slo.panelHint')}
        </p>
      </div>

      {open && (
        <>
          <div className="grid-auto" style={{ '--grid-min': '12.5rem', marginTop: '12px' }}>
            {fields.map(f => (
              <div className="panel-inset field" key={f.key}>
                <div className="field-head">
                  <span className="field-label">{f.label}</span>
                  <span className="field-value" style={{ color: budgets[f.key] != null ? 'var(--accent)' : 'var(--text-subtle)' }}>
                    {budgets[f.key] != null ? `${budgets[f.key]} ${f.unit}` : t('slo.off')}
                  </span>
                </div>
                <input
                  type="number"
                  step={f.step}
                  min={f.min}
                  value={budgets[f.key] ?? ''}
                  placeholder={String(DEFAULT_SLO_BUDGETS[f.key])}
                  aria-label={t('slo.inputAria', { metric: f.label })}
                  onChange={(e) => setField(f.key, e.target.value)}
                />
              </div>
            ))}
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '10px', flexWrap: 'wrap', gap: '8px' }}>
            <p className="hint-text" style={{ margin: 0 }}>
              {t('slo.marginHint')}
            </p>
            <button
              onClick={() => onChange({ ...DEFAULT_SLO_BUDGETS })}
              className="btn"
              style={{ padding: '2px 10px', fontSize: '0.72rem' }}
              title={t('slo.resetTooltip')}
            >
              {t('slo.reset')}
            </button>
          </div>
        </>
      )}
    </section>
  );
}
