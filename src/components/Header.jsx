import React, { useState } from 'react';
import { Cpu, Link2, Check } from 'lucide-react';
import { HARDWARE_PRESETS } from '../utils/presets';
import { t } from '../i18n/strings';

const MODES = [
  { id: 'single', label: 'Single-turn' },
  { id: 'agentic', label: 'Agentic loop' },
  { id: 'batching', label: 'Batching' },
  { id: 'compare', label: 'Compare' },
  { id: 'ab', label: 'A/B' },
  { id: 'diff', label: 'Diff' },
  { id: 'shortlist', label: 'Find HW' },
  { id: 'kvcache', label: 'KV cache' },
  { id: 'theory', label: 'Theory' }
];

/**
 * Minimal header — title, hardware preset, view switcher, share.
 * Everything else lives in the views themselves or is gone.
 */
export default function Header({
  activeTab,
  setActiveTab,
  selectedPreset,
  setSelectedPreset,
  onApplyPreset,
  onShare
}) {
  const [copied, setCopied] = useState(false);

  const handleShare = async () => {
    await onShare();
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <header className="site-header">
      <div className="app-frame site-header-top" style={{ display: 'flex', alignItems: 'center', gap: 16, paddingBlock: 10 }}>
        <div className="brand-block" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div className="brand-mark"><Cpu size={17} /></div>
          <h1 className="brand-title" style={{ fontSize: '0.95rem', margin: 0 }}>
            {t('header.brandTitle')}
          </h1>
        </div>

        <select
          id="view-select"
          aria-label={t('header.viewAriaLabel')}
          value={activeTab}
          onChange={(e) => setActiveTab(e.target.value)}
          style={{ maxWidth: 170 }}
        >
          {MODES.map(m => (
            <option key={m.id} value={m.id}>{m.label}</option>
          ))}
        </select>

        <div style={{ marginInlineStart: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
          <label htmlFor="hw-preset" className="field-label">{t('header.presetLabel')}</label>
          <select
            id="hw-preset"
            value={selectedPreset}
            onChange={(e) => {
              const pId = e.target.value;
              setSelectedPreset(pId);
              const found = HARDWARE_PRESETS.find(p => p.id === pId);
              if (found) onApplyPreset(found);
            }}
            style={{ maxWidth: 240 }}
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

          <button onClick={handleShare} className="btn btn-icon" aria-label={t('header.shareTooltip')} title={t('header.shareTooltip')}>
            {copied ? <Check size={15} /> : <Link2 size={15} />}
          </button>
        </div>
      </div>
    </header>
  );
}
