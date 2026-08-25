import React, { useState, useRef, useEffect } from 'react';
import { Cpu, Link2, Check, X } from 'lucide-react';
import { HARDWARE_PRESETS } from '../utils/presets';
import { t } from '../i18n/strings';
import { TESTIDS } from '../utils/testids';

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
  // Issue #501: the share button previously flashed ✓ unconditionally — even
  // when the clipboard write threw — and never signalled failure. Track both
  // states and announce them via an aria-live region so headless agents and
  // assistive tech can detect the outcome from the DOM alone.
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const copyTimer = useRef(null);

  useEffect(() => () => clearTimeout(copyTimer.current), []);

  const handleShare = async () => {
    const ok = await onShare();
    setCopied(ok);
    setCopyFailed(!ok);
    clearTimeout(copyTimer.current);
    copyTimer.current = setTimeout(() => { setCopied(false); setCopyFailed(false); }, 2000);
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
          data-testid={TESTIDS.viewSelect}
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
            data-testid={TESTIDS.hwPreset}
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

          <button
            onClick={handleShare}
            className="btn btn-icon"
            aria-label={t('header.shareTooltip')}
            title={copied ? t('header.shareCopied') : copyFailed ? t('header.shareCopyFailed') : t('header.shareTooltip')}
          >
            {copied ? <Check size={15} /> : copyFailed ? <X size={15} /> : <Link2 size={15} />}
          </button>
          {/* Issue #501: machine-detectable copy outcome for the share link */}
          <span role="status" aria-live="polite" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap' }}>
            {copied ? t('header.shareCopied') : copyFailed ? t('header.shareCopyFailed') : ''}
          </span>
        </div>
      </div>
    </header>
  );
}
