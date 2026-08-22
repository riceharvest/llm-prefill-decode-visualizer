import React from 'react';
import { PLAIN_TERMS } from '../utils/plainLanguage';
import { t } from '../i18n/strings';

/**
 * Expandable glossary of every term the plain-language mode rewrites
 * (issue #79). Lives on the Theory tab so a reader who meets an unfamiliar
 * plain phrase can unfold the technical meaning right where the dense
 * wording used to be — the "progressive disclosure" half of the feature.
 * Always visible regardless of mode: it doubles as the reverse lookup
 * (plain phrase → technical term).
 */
export default function JargonGlossary() {
  return (
    <details className="panel-inset" data-testid="jargon-glossary">
      <summary style={{ fontWeight: 700, fontSize: '0.88rem', color: 'var(--text-main)', cursor: 'pointer' }}>
        {t('plainLanguage.glossaryHeading')}
      </summary>
      <p className="hint-text" style={{ marginTop: '8px', marginBottom: '12px' }}>
        {t('plainLanguage.glossaryIntro')}
      </p>
      <dl style={{ display: 'flex', flexDirection: 'column', gap: '10px', margin: 0 }}>
        {PLAIN_TERMS.map((term) => (
          <div key={term} style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
            <dt style={{ fontSize: '0.82rem', color: 'var(--text-main)' }}>
              <strong>{t(`plainLanguage.terms.${term}.plain`)}</strong>
              <span style={{ color: 'var(--text-muted)' }}> ← {t(`plainLanguage.terms.${term}.short`)}</span>
            </dt>
            <dd style={{ margin: 0, paddingLeft: '14px', borderLeft: '2px solid var(--border)' }}>
              <span className="hint-text">{t(`plainLanguage.terms.${term}.long`)}</span>
            </dd>
          </div>
        ))}
      </dl>
    </details>
  );
}
