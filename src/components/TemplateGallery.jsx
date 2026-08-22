import React from 'react';
import { Play } from 'lucide-react';
import { TEMPLATE_GALLERY } from '../utils/templateGallery';
import { demoUrl } from '../utils/urlState';

// Template gallery (issue #111): one-click scenario cards rendered at the top
// of the theory tab. Each card is a single button that loads a fully-
// configured, autoplaying simulation via demoUrl(); the theory blurb sits on
// the card itself so the answer is visible before and after the click.
export default function TemplateGallery() {
  return (
    <section className="panel-inset" aria-label="Template gallery">
      <h3 style={{ fontSize: '0.92rem', fontWeight: 700, color: 'var(--text-main)', marginBottom: '4px' }}>
        Start with a question
      </h3>
      <p className="hint-text" style={{ marginBottom: '14px' }}>
        One-click templates: a common question, a short answer, and a
        fully-configured simulation that demonstrates it. No jargon required.
      </p>

      <div className="grid-auto" style={{ '--grid-min': '260px' }}>
        {TEMPLATE_GALLERY.map(tpl => (
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
              {tpl.question}
            </span>
            <span style={{ fontSize: '0.74rem', color: 'var(--text-muted)', lineHeight: 1.45 }}>
              {tpl.tagline}
            </span>
            <details style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>
              <summary style={{ cursor: 'pointer', color: 'var(--text-subtle)', outline: 'none' }}>
                Why?
              </summary>
              <p style={{ marginTop: '6px', lineHeight: 1.5 }}>{tpl.blurb}</p>
            </details>
            <span style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: 'auto' }}>
              {tpl.chips.map(chip => (
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
              aria-label={`${tpl.question} — load configured simulation`}
              className="btn"
              style={{ justifyContent: 'center', minHeight: '30px', padding: '5px 12px', fontSize: '0.76rem' }}
            >
              <Play size={12} />
              Load simulation
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}
