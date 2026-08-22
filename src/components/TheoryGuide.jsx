import React from 'react';
import { HelpCircle, Gauge, Zap, Play, Bot } from 'lucide-react';
import { demoUrl } from '../utils/urlState';
import { t, tArray } from '../i18n/strings';
import Analogy from './Analogy';
import TemplateGallery from './TemplateGallery';

// Demo deep-links per FAQ entry (index-aligned with theory.faq in strings.js).
const FAQ_DEMOS = [
  { tab: 'single', preset: 'rtx4090_exl2', prefill: 3800, decode: 105, prompt: 8192, output: 256, sim: 5 },
  { tab: 'compare', hwA: 'rtx3060_entry', hwB: 'rtx4090_exl2', cp: 4096, co: 512 },
  { tab: 'single', preset: 'rtx3060_entry', prefill: 920, decode: 32, prompt: 4096, output: 2048, sim: 20 },
  { tab: 'kvcache', model: 'llama70b', ctx: 32768, prec: 2 },
  { tab: 'kvcache', model: 'llama70b', ctx: 131072, prec: 2 },
  { tab: 'agentic', preset: 'rtx4090_exl2', prefill: 3800, decode: 105, turns: 6, sprompt: 4096, tool: 1024, thought: 256, sim: 20 },
  { tab: 'compare', hwA: 'rtx4090_exl2', hwB: 'dual_rtx3090', cp: 8192, co: 1024 },
  { tab: 'compare', hwA: 'mac_ultra', hwB: 'rtx4090_exl2', cp: 8192, co: 512 }
];

export default function TheoryGuide() {
  // Glossary popovers across the app deep-link here via ?tab=theory#<anchor>;
  // scroll to the anchored section once this tab has mounted.
  React.useEffect(() => {
    const id = window.location.hash.replace('#', '');
    if (!id) return;
    // Wait a frame so the tab content is laid out before scrolling.
    const t = requestAnimationFrame(() => {
      document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    return () => cancelAnimationFrame(t);
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

        {/* Comparative Dual Cards */}
        <div className="grid-auto" style={{ '--grid-min': '20rem', marginBottom: '16px' }}>

          {/* Prefill Explanation */}
          <div id="theory-prefill" className="panel-inset theory-anchor" style={{ borderLeft: '2px solid var(--prefill)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px' }}>
              <Zap size={16} style={{ color: 'var(--prefill)' }} />
              <h3 style={{ fontSize: '0.92rem', fontWeight: 700, color: 'var(--prefill)' }}>
                {t('theory.prefillHeading')}
                <Analogy term="prefill" />
              </h3>
            </div>

            <p className="hint-text" style={{ marginBottom: '12px' }}>
              {t('theory.prefillIntroBefore')}N<sub>{t('theory.subPrompt')}</sub>{t('theory.prefillIntroAfter')}
            </p>

            <ul style={bulletStyle}>
              <li><strong style={{ color: 'var(--text-main)' }}>{t('theory.bottleneckLabel')}</strong> {t('theory.bottleneckCompute')}</li>
              <li><strong style={{ color: 'var(--text-main)' }}>{t('theory.operationLabel')}</strong> {t('theory.operationGemm')}</li>
              <li><strong style={{ color: 'var(--text-main)' }}>{t('theory.userMetricLabel')}{t('theory.metricTtft')}</strong>
                <div style={{ ...formulaStyle, color: 'var(--prefill)' }}>
                  {t('theory.formulaTtft')}
                </div>
              </li>
            </ul>
          </div>

          {/* Decode Explanation */}
          <div id="theory-decode" className="panel-inset theory-anchor" style={{ borderLeft: '2px solid var(--decode)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px' }}>
              <Gauge size={16} style={{ color: 'var(--decode)' }} />
              <h3 style={{ fontSize: '0.92rem', fontWeight: 700, color: 'var(--decode)' }}>
                {t('theory.decodeHeading')}
                <Analogy term="decode" />
              </h3>
            </div>

            <p className="hint-text" style={{ marginBottom: '12px' }}>
              {t('theory.decodeIntroBefore')}
            </p>

            <ul style={bulletStyle}>
              <li><strong style={{ color: 'var(--text-main)' }}>{t('theory.bottleneckLabel')}</strong> {t('theory.bottleneckBandwidth')}</li>
              <li><strong style={{ color: 'var(--text-main)' }}>{t('theory.operationLabel')}</strong> {t('theory.operationGemv')}</li>
              <li><strong style={{ color: 'var(--text-main)' }}>{t('theory.userMetricLabel')}{t('theory.metricTpot')}</strong>
                <div style={{ ...formulaStyle, color: 'var(--decode)' }}>
                  {t('theory.formulaTpot')}
                </div>
              </li>
            </ul>
          </div>

        </div>

        {/* Agentic Loop Theory Section */}
        <div id="theory-agentic" className="panel-inset theory-anchor" style={{ borderLeft: '2px solid var(--agent)', marginBottom: '16px' }}>
          <h3 style={{ fontSize: '0.92rem', fontWeight: 700, color: 'var(--agent)', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Bot size={16} />
            {t('theory.agenticHeading')}
          </h3>
          <p className="hint-text" style={{ marginBottom: '12px' }}>
            {t('theory.agenticIntroBefore')}<strong style={{ color: 'var(--text-main)' }}>{t('theory.loopStages')}</strong>{t('theory.agenticIntroAfter')}
          </p>

          <div className="grid-auto" style={{ '--grid-min': '16.25rem' }}>
            <div className="panel-inset">
              <strong style={{ fontSize: '0.8rem', color: 'var(--text-main)' }}>
                {t('theory.withoutCaching')}
              </strong>
              <p className="hint-text" style={{ marginTop: '4px' }}>
                {t('theory.withoutCachingBodyBefore')}P<sub>{t('theory.subK')}</sub>{t('theory.withoutCachingBodyAfter')}
              </p>
            </div>
            <div className="panel-inset">
              <strong style={{ fontSize: '0.8rem', color: 'var(--text-main)' }}>
                {t('theory.withCaching')}
                <Analogy term="prefixCaching" />
              </strong>
              <p className="hint-text" style={{ marginTop: '4px' }}>
                {t('theory.withCachingBodyBefore')}ΔP<sub>{t('theory.subK')}</sub>{t('theory.withCachingBodyAfter')}
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
                  {item.a}
                </p>
                {FAQ_DEMOS[i] && (
                  <button
                    onClick={() => { window.location.href = demoUrl(FAQ_DEMOS[i]); }}
                    className="btn"
                    style={{ marginTop: '10px', minHeight: '30px', padding: '5px 12px', fontSize: '0.76rem' }}
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
