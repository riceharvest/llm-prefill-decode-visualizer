import React from 'react';
import { Play } from 'lucide-react';
import { TEMPLATE_GALLERY } from '../utils/templateGallery';
import { demoUrl } from '../utils/urlState';
import { t, tArray } from '../i18n/strings';

// Template gallery (issue #111): one-click scenario cards rendered at the top
// of the theory tab. Each card is a single button that loads a fully-
// configured, autoplaying simulation via demoUrl(); the theory blurb sits on
// the card itself so the answer is visible before and after the click.
// All copy routes through i18n (#587) — en/templates.json is the source of
// truth; other locales fall back to it key-by-key.
export default function TemplateGallery() {
  return (
    <section className="panel-inset" aria-label={t('templates.heading')}>
      <h3 style={{ fontSize: '0.92rem', fontWeight: 700, color: 'var(--text-main)', marginBottom: '4px' }}>
        {t('templates.heading')}
      </h3>
      <p className="hint-text" style={{ marginBottom: '14px' }}>
        {t('templates.intro')}
      </p>

      <div className="grid-auto" style={{ '--grid-min': '260px' }}>
        {TEMPLATE_GALLERY.map(tpl => {
          const question = t(`templates.templates.${tpl.id}.question`);
          return (
            <div
              key={tpl.id}
              className="panel-inset"
              style={{
                textAlign: 'left',
                display: 'flex',
                flexDirection: 'column',
                gap: '8px',
                padding: '12px 14px',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-md)',
                background: 'var(--bg-panel)'
              }}
            >
              <span style={{ fontSize: '1.2rem' }} aria-hidden="true">{tpl.icon}</span>
              <span style={{ fontWeight: 700, fontSize: '0.86rem', color: 'var(--text-main)', lineHeight: 1.35 }}>
                {question}
              </span>
              <span style={{ fontSize: '0.74rem', color: 'var(--text-muted)', lineHeight: 1.45 }}>
                {t(`templates.templates.${tpl.id}.tagline`)}
              </span>
              <details style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>
                <summary style={{ cursor: 'pointer', color: 'var(--text-subtle)', outline: 'none' }}>
                  {t('templates.why')}
                </summary>
                <p style={{ marginTop: '6px', lineHeight: 1.5 }}>{t(`templates.templates.${tpl.id}.blurb`)}</p>
              </details>
              <span style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: 'auto' }}>
                {tArray(`templates.templates.${tpl.id}.chips`).map(chip => (
                  <span
                    key={chip}
                    style={{
                      fontSize: '0.66rem',
                      fontFamily: 'var(--font-mono)',
                      padding: '2px 8px',
                      borderRadius: '999px',
                      border: '1px solid var(--border-strong)',
                      color: 'var(--text-muted)'
                    }}
                  >
                    {chip}
                  </span>
                ))}
              </span>
              <button
                type="button"
                onClick={() => { window.location.href = demoUrl(tpl.demo); }}
                aria-label={t('templates.loadAria', { question })}
                className="btn"
                style={{ justifyContent: 'center', minHeight: '30px', padding: '5px 12px', fontSize: '0.76rem' }}
              >
                <Play size={12} />
                {t('templates.loadSimulation')}
              </button>
            </div>
          );
        })}
      </div>
    </section>
  );
}
