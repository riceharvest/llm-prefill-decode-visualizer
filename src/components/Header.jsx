import React, { useState } from 'react';
import { Cpu, Bot, MessageSquare, HelpCircle, BarChart3, HardDrive, Link2, Check } from 'lucide-react';
import { HARDWARE_PRESETS } from '../utils/presets';

export default function Header({
  activeTab,
  setActiveTab,
  selectedPreset,
  setSelectedPreset,
  onApplyPreset,
  onShare,
  onTour
}) {
  const [copied, setCopied] = useState(false);

  const handleShare = async () => {
    await onShare();
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

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
              <h1 className="brand-title">LLM Prefill &amp; Decode Speed Visualizer</h1>
              <p className="brand-sub">
                Measure walltime, TTFT &amp; TPOT across single-turn chat and multi-turn agentic loops
              </p>
            </div>
          </div>

          {/* Preset Hardware Selector */}
          <div className="header-controls">
            <label htmlFor="hw-preset" className="field-label" style={{ marginRight: '-4px' }}>Preset</label>
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
                <option value={selectedPreset}>LocalMaxxing measured run</option>
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

            {/* Share exact settings */}
            <button
              onClick={handleShare}
              title="Copy share link with current settings"
              className="btn"
              style={copied ? { borderColor: 'var(--decode-border)', color: 'var(--decode)' } : undefined}
            >
              {copied ? <Check size={15} /> : <Link2 size={15} />}
              {copied ? 'Copied' : 'Share'}
            </button>
          </div>

        </div>
      </div>

      {/* Navigation Tabs */}
      <nav className="tab-nav app-frame" aria-label="Visualizer sections">
        {[
          { id: 'single', label: 'Single-Turn Chat', icon: MessageSquare, hint: 'TTFT / TPOT' },
          { id: 'agentic', label: 'Agentic Loop', icon: Bot, hint: 'WALLTIME' },
          { id: 'compare', label: 'Hardware Compare', icon: BarChart3, hint: 'A / B' },
          { id: 'kvcache', label: 'KV Cache', icon: HardDrive, hint: 'VRAM' },
          { id: 'theory', label: 'Theory', icon: HelpCircle, hint: 'FLOPS vs BW' }
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
