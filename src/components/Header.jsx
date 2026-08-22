import React, { useState } from 'react';
import { Cpu, Bot, Layers, MessageSquare, HelpCircle, BarChart3, Columns2, HardDrive, Link2, Check, Code2, GitCompare, ListFilter, GraduationCap } from 'lucide-react';
import { HARDWARE_PRESETS } from '../utils/presets';
import { t } from '../i18n/strings';
import AnalogyToggle from './AnalogyToggle';

export default function Header({
  activeTab,
  setActiveTab,
  selectedPreset,
  setSelectedPreset,
  onApplyPreset,
  onShare,
  onEmbed,
  shareTitle,
  onTour
}) {
  const [copied, setCopied] = useState(false);
  const [embedCopied, setEmbedCopied] = useState(false);

  const handleShare = async () => {
    await onShare();
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Issue #108: copy a ready-to-paste <iframe> snippet for the current view.
  const handleEmbed = async () => {
    await onEmbed();
    setEmbedCopied(true);
    setTimeout(() => setEmbedCopied(false), 2000);
  };

  const tabs = [
    { id: 'single', label: t('tabs.single.label'), icon: MessageSquare, hint: t('tabs.single.hint') },
    { id: 'agentic', label: t('tabs.agentic.label'), icon: Bot, hint: t('tabs.agentic.hint') },
    { id: 'compare', label: t('tabs.compare.label'), icon: BarChart3, hint: t('tabs.compare.hint') },
    { id: 'ab', label: t('tabs.ab.label'), icon: Columns2, hint: t('tabs.ab.hint') },
    { id: 'diff', label: t('tabs.diff.label'), icon: GitCompare, hint: t('tabs.diff.hint') },
    { id: 'kvcache', label: t('tabs.kvcache.label'), icon: HardDrive, hint: t('tabs.kvcache.hint') },
    { id: 'theory', label: t('tabs.theory.label'), icon: HelpCircle, hint: t('tabs.theory.hint') },
    { id: 'curriculum', label: t('tabs.curriculum.label'), icon: GraduationCap, hint: t('tabs.curriculum.hint') }
  ];

  return (
    <header className="site-header">
      <div className="app-frame">
        <div className="site-header-top">

          {/* Title & Brand */}
          <div className="brand-block">
            <div className="brand-mark">
              <Cpu size={19} />
            </div>
            <div>
              <h1 className="brand-title">{t('header.brandTitle')}</h1>
              <p className="brand-sub">
                {t('header.brandSubtitle')}
              </p>
            </div>
          </div>

          {/* Preset Hardware Selector */}
          <div className="header-controls">
            <label htmlFor="hw-preset" className="field-label" style={{ marginInlineEnd: '-4px' }}>{t('header.presetLabel')}</label>
            <select
              id="hw-preset"
              value={selectedPreset}
              onChange={(e) => {
                const pId = e.target.value;
                setSelectedPreset(pId);
                const found = HARDWARE_PRESETS.find(p => p.id === pId);
                if (found) onApplyPreset(found);
              }}
            >
              {selectedPreset.startsWith('lmx:') && (
                <option value={selectedPreset}>{t('header.localMaxxingRun')}</option>
              )}
              {HARDWARE_PRESETS.map(p => (
                <option key={p.id} value={p.id}>
                  {p.icon} {p.name}
                </option>
              ))}
            </select>

            {/* Replay the guided tour */}
            <button
              onClick={onTour}
              title="Replay the guided tour"
              aria-label="Replay the guided tour"
              className="btn btn-icon"
            >
              <HelpCircle size={15} />
            </button>

            {/* Everyday-analogy mode (issue #84) */}
            <AnalogyToggle />

            {/* Share exact settings — tooltip previews the auto-generated
                permalink title (#106) so users see how the link will read */}
            <button
              onClick={handleShare}
              title={shareTitle ? `${t('header.shareTooltip')} — "${shareTitle}"` : t('header.shareTooltip')}
              aria-label={shareTitle ? `${t('header.shareTooltip')} — "${shareTitle}"` : t('header.shareTooltip')}
              data-tooltip={shareTitle ? `${t('header.shareTooltip')} — "${shareTitle}"` : t('header.shareTooltip')}
              className="btn"
              style={copied ? { borderColor: 'var(--decode-border)', color: 'var(--decode)' } : undefined}
            >
              {copied ? <Check size={15} /> : <Link2 size={15} />}
              {copied ? t('common.copied') : t('common.share')}
            </button>

            {/* Embeddable iframe widget (issue #108) */}
            <button
              onClick={handleEmbed}
              title={t('header.embedTooltip')}
              aria-label={t('header.embedTooltip')}
              data-tooltip={t('header.embedTooltip')}
              className="btn"
              style={embedCopied ? { borderColor: 'var(--decode-border)', color: 'var(--decode)' } : undefined}
            >
              {embedCopied ? <Check size={15} /> : <Code2 size={15} />}
              {embedCopied ? t('common.copied') : t('common.embed')}
            </button>
          </div>

        </div>
      </div>

      {/* Navigation Tabs */}
      <nav className="tab-nav app-frame" aria-label="Visualizer sections">
        {[
          { id: 'single', label: 'Single-Turn Chat', icon: MessageSquare, hint: 'TTFT / TPOT' },
          { id: 'agentic', label: 'Agentic Loop', icon: Bot, hint: 'WALLTIME' },
          { id: 'batching', label: 'Continuous Batching', icon: Layers, hint: 'BATCH / ITL' },
          { id: 'compare', label: 'Hardware Compare', icon: BarChart3, hint: 'A / B' },
          { id: 'ab', label: 'A/B Replay', icon: Columns2, hint: 'SYNC' },
          { id: 'diff', label: 'Run Diff', icon: GitCompare, hint: 'RUN IDS' },
          { id: 'shortlist', label: 'Find Hardware', icon: ListFilter, hint: 'SHORTLIST' },
          { id: 'kvcache', label: 'KV Cache', icon: HardDrive, hint: 'VRAM' },
          { id: 'theory', label: 'Theory', icon: HelpCircle, hint: 'FLOPS vs BW' },
          { id: 'curriculum', label: 'Curriculum', icon: GraduationCap, hint: 'LESSONS' }
        ].map(tab => {
          const IconComponent = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              {...(tab.id === 'theory' ? { 'data-tour': 'tab-theory' } : {})}
              onClick={() => setActiveTab(tab.id)}
              className={`tab-btn${isActive ? ' active' : ''}`}
              aria-current={isActive ? 'page' : undefined}
            >
              <IconComponent size={15} />
              <span>{tab.label}</span>
              <span className="tab-hint">{tab.hint}</span>
            </button>
          );
        })}
      </nav>
    </header>
  );
}
