import React from 'react';
import { HelpCircle, Gauge, Zap, Play, Bot } from 'lucide-react';
import { demoUrl } from '../utils/urlState';
import { FAQ_DEMOS } from '../utils/faqDemos';
import { scrollToHashAnchor } from '../utils/hashAnchor';
import { t, tArray, tPlain } from '../i18n/strings';
import Analogy from './Analogy';
import TemplateGallery from './TemplateGallery';
import Jargon from './Jargon';
import JargonGlossary from './JargonGlossary';
import { plainify } from '../i18n/strings';

export default function TheoryGuide() {
  // Glossary popovers across the app deep-link here via ?tab=theory#<anchor>;
  // scroll to the anchored section once this tab has mounted. Issue #589:
  // scrolling alone leaves keyboard/AT focus at the top of the document, the
  // effect used to fire only on mount (same-document hash edits did nothing),
  // and smooth animation raced headless captures — so we now move focus onto
  // the section heading (tabIndex={-1} below), re-run on hashchange, and use
  // 'auto' behavior under prefers-reduced-motion.
  React.useEffect(() => {
    const apply = () => scrollToHashAnchor(window.location.hash);
    apply();
    window.addEventListener('hashchange', apply);
    return () => window.removeEventListener('hashchange', apply);
  }, []);
  const bulletStyle = { fontSize: '0.8rem', color: 'var(--text-muted)', display: 'flex', flexDirection: 'column', gap: '8px', paddingLeft: '18px', lineHeight: 1.55 };
  const formulaStyle = {
    fontFamily: 'var(--font-mono)',
    background: 'var(--bg-inset)',
    padding: '6px 10px',
    borderRadius: 'var(--radius-sm)',
    border: '1px solid var(--border-strong)',
    margin: '6px 0',
    fontWeight: 600,
    fontSize: '0.8rem'
  };

  return (
    <div className="stack">

      <section className="panel" aria-label={t('theory.panelAria')}>
        <h2 className="panel-title" style={{ marginBottom: '16px' }} tabIndex={-1} data-panel-heading>
          <HelpCircle size={16} />
          <span>{t('theory.panelTitle')}</span>
        </h2>

        {/* Template gallery (#111): one-click question cards that load a
            configured sim — the onboarding funnel sits above the theory. */}
        <TemplateGallery />

        {/* Progressive jargon disclosure (issue #79): every dense term below
            renders via <Jargon />, which plain-language mode swaps for a plain
            equivalent while the technical term stays on hover. The glossary
            is the expandable reverse lookup. */}
        <JargonGlossary />

        {/* Comparative Dual Cards */}
        <div className="grid-auto" style={{ '--grid-min': '20rem', marginBottom: '16px' }}>

          {/* Prefill Explanation */}
          <div id="theory-prefill" tabIndex={-1} className="panel-inset theory-anchor" style={{ borderLeft: '2px solid var(--prefill)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px' }}>
              <Zap size={16} style={{ color: 'var(--prefill)' }} />
              <h3 style={{ fontSize: '0.92rem', fontWeight: 700, color: 'var(--prefill)' }}>
                {t('theory.prefillHeading')}
                <Analogy term="prefill" />
              </h3>
            </div>

            <p className="hint-text" style={{ marginBottom: '12px' }}>
              {t('theory.prefillIntroBefore')}N<sub>{t('theory.subPrompt')}</sub>{tPlain('theory.prefillIntroAfter')}
            </p>

            <ul style={bulletStyle}>
              <li><strong style={{ color: 'var(--text-main)' }}>{t('theory.bottleneckLabel')}</strong> <Jargon term="computeBound" /></li>
              <li><strong style={{ color: 'var(--text-main)' }}>{t('theory.operationLabel')}</strong> <Jargon term="gemm">{t('theory.operationGemm')}</Jargon></li>
              <li><strong style={{ color: 'var(--text-main)' }}>{t('theory.userMetricLabel')}<Jargon term="ttft">{t('theory.metricTtft')}</Jargon></strong>
                <div style={{ ...formulaStyle, color: 'var(--prefill)' }}>
                  {t('theory.formulaTtft')}
                </div>
              </li>
            </ul>
          </div>

          {/* Decode Explanation */}
          <div id="theory-decode" tabIndex={-1} className="panel-inset theory-anchor" style={{ borderLeft: '2px solid var(--decode)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px' }}>
              <Gauge size={16} style={{ color: 'var(--decode)' }} />
              <h3 style={{ fontSize: '0.92rem', fontWeight: 700, color: 'var(--decode)' }}>
                {t('theory.decodeHeading')}
                <Analogy term="decode" />
              </h3>
            </div>

            <p className="hint-text" style={{ marginBottom: '12px' }}>
              {tPlain('theory.decodeIntroBefore')}
            </p>

            <ul style={bulletStyle}>
              <li><strong style={{ color: 'var(--text-main)' }}>{t('theory.bottleneckLabel')}</strong> <Jargon term="bandwidthBound" /></li>
              <li><strong style={{ color: 'var(--text-main)' }}>{t('theory.operationLabel')}</strong> <Jargon term="gemv">{t('theory.operationGemv')}</Jargon></li>
              <li><strong style={{ color: 'var(--text-main)' }}>{t('theory.userMetricLabel')}<Jargon term="tpot">{t('theory.metricTpot')}</Jargon></strong>
                <div style={{ ...formulaStyle, color: 'var(--decode)' }}>
                  {t('theory.formulaTpot')}
                </div>
              </li>
            </ul>
          </div>

        </div>

        {/* Agentic Loop Theory Section */}
        <div id="theory-agentic" tabIndex={-1} className="panel-inset theory-anchor" style={{ borderLeft: '2px solid var(--agent)', marginBottom: '16px' }}>
          <h3 style={{ fontSize: '0.92rem', fontWeight: 700, color: 'var(--agent)', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Bot size={16} />
            {t('theory.agenticHeading')}
          </h3>
          <p className="hint-text" style={{ marginBottom: '12px' }}>
            {t('theory.agenticIntroBefore')}<strong style={{ color: 'var(--text-main)' }}>{t('theory.loopStages')}</strong>{tPlain('theory.agenticIntroAfter')}
          </p>

          <div className="grid-auto" style={{ '--grid-min': '16.25rem' }}>
            <div className="panel-inset">
              <strong style={{ fontSize: '0.8rem', color: 'var(--text-main)' }}>
                {t('theory.withoutCaching')}
              </strong>
              <p className="hint-text" style={{ marginTop: '4px' }}>
                {tPlain('theory.withoutCachingBodyBefore')}P<sub>{t('theory.subK')}</sub>{tPlain('theory.withoutCachingBodyAfter')}
              </p>
            </div>
            <div className="panel-inset">
              <strong style={{ fontSize: '0.8rem', color: 'var(--text-main)' }}>
                {t('theory.withCaching')}
                <Analogy term="prefixCaching" />
              </strong>
              <p className="hint-text" style={{ marginTop: '4px' }}>
                {tPlain('theory.withCachingBodyBefore')}ΔP<sub>{t('theory.subK')}</sub>{tPlain('theory.withCachingBodyAfter')}
              </p>
            </div>
          </div>
        </div>

        {/* Community FAQ — sourced from recurring questions on X */}
        <div className="panel-inset">
          <h3 style={{ fontSize: '0.92rem', fontWeight: 700, color: 'var(--text-main)', marginBottom: '4px' }}>
            {t('theory.faqHeading')}
          </h3>
          <p className="hint-text" style={{ marginBottom: '14px' }}>
            {t('theory.faqIntro')}
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {tArray('theory.faq').map((item, i) => (
              <details
                key={i}
                style={{
                  background: 'var(--bg-panel)',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius-md)',
                  padding: '10px 14px'
                }}
              >
                <summary style={{ fontWeight: 600, fontSize: '0.85rem', color: 'var(--text-main)', cursor: 'pointer' }}>
                  {item.q}
                </summary>
                <p className="hint-text" style={{ marginTop: '8px' }}>
                  {plainify(item.a)}
                </p>
                {FAQ_DEMOS[item.id] && (
                  <button
                    onClick={() => { window.location.href = demoUrl(FAQ_DEMOS[i]); }}
                    className="btn btn-sm"
                    style={{ marginTop: '10px', padding: '5px 12px', fontSize: '0.76rem' }}
                  >
                    <Play size={12} />
                    {t('theory.tryIt')}
                  </button>
                )}
              </details>
            ))}
          </div>
        </div>

      </section>

    </div>
  );
}
