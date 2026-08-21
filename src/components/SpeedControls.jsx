import React from 'react';
import { Play, Pause, RotateCcw, FastForward, Gauge, Zap } from 'lucide-react';
import { sanityWarnings } from '../../api/_math.js';
import SanityWarnings from './SanityWarnings';
import Analogy from './Analogy';
import { t } from '../i18n/strings';

export default function SpeedControls({
  prefillSpeed,
  setPrefillSpeed,
  decodeSpeed,
  setDecodeSpeed,
  simSpeedMultiplier,
  setSimSpeedMultiplier,
  isPlaying,
  setIsPlaying,
  onReset
}) {
  // Same physical-bounds checks the /api/compute API applies — surfaced
  // inline so impossible speed inputs are flagged before running a sim.
  const speedWarnings = sanityWarnings({ prefillSpeed, decodeSpeed });

  return (
    <section className="panel" aria-label="Simulation speed controls">
      <SanityWarnings warnings={speedWarnings} />
      <div className="grid-auto" style={{ '--grid-min': '280px', alignItems: 'stretch' }}>

        {/* Prefill Speed Input */}
        <div className="panel-inset" data-tour="prefill-slider" style={{ borderInlineStart: '2px solid var(--prefill)' }}>          <div className="field-head" style={{ marginBottom: '10px' }}>
            <span className="panel-title" style={{ color: 'var(--prefill)' }}>
              <Zap size={15} style={{ color: 'var(--prefill)' }} />
              {t('speedControls.prefillSpeed')}
              <Analogy term="prefill" />
            </span>
            <span className="tag tag-prefill">{t('speedControls.computeBound')}</span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <input
              type="range"
              min="50"
              max="50000"
              step="50"
              value={prefillSpeed}
              aria-label={t('speedControls.prefillAria')}
              onChange={(e) => setPrefillSpeed(Number(e.target.value))}
              style={{ flex: 1 }}
            />
            <input
              type="number"
              value={prefillSpeed}
              aria-label={t('speedControls.prefillValueAria')}
              onChange={(e) => setPrefillSpeed(Number(e.target.value))}
              style={{ width: '88px' }}
            />
            <span className="field-label">{t('common.tokPerSec')}</span>
          </div>
          <p className="hint-text" style={{ marginTop: '8px' }}>
            {t('speedControls.prefillHint')}
          </p>
        </div>

        {/* Decode Speed Input */}
        <div className="panel-inset" data-tour="decode-slider" style={{ borderInlineStart: '2px solid var(--decode)' }}>          <div className="field-head" style={{ marginBottom: '10px' }}>
            <span className="panel-title" style={{ color: 'var(--decode)' }}>
              <Gauge size={15} style={{ color: 'var(--decode)' }} />
              {t('speedControls.decodeSpeed')}
              <Analogy term="decode" />
            </span>
            <span className="tag tag-decode">{t('speedControls.bandwidthBound')}</span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <input
              type="range"
              min="2"
              max="1000"
              step="1"
              value={decodeSpeed}
              aria-label={t('speedControls.decodeAria')}
              onChange={(e) => setDecodeSpeed(Number(e.target.value))}
              style={{ flex: 1 }}
            />
            <input
              type="number"
              value={decodeSpeed}
              aria-label={t('speedControls.decodeValueAria')}
              onChange={(e) => setDecodeSpeed(Number(e.target.value))}
              style={{ width: '88px' }}
            />
            <span className="field-label">{t('common.tokPerSec')}</span>
          </div>
          <p className="hint-text" style={{ marginTop: '8px' }}>
            {t('speedControls.decodeHint', {
              tpot: decodeSpeed > 0 ? (1000 / decodeSpeed).toFixed(1) : '∞'
            })}
          </p>
        </div>

        {/* Simulation Speed & Controls */}
        <div className="panel-inset" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between', gap: '12px' }}>
          <div className="field-head">
            <span className="panel-title">
              <FastForward size={15} />
              {t('speedControls.timeScale')}
            </span>
            <div className="seg" role="group" aria-label={t('speedControls.timeScaleAria')}>
              {[1, 2, 5, 20, 'instant'].map(mult => (
                <button
                  key={mult}
                  onClick={() => setSimSpeedMultiplier(mult)}
                  className={simSpeedMultiplier === mult ? 'active' : ''}
                  aria-pressed={simSpeedMultiplier === mult}
                >
                  {mult === 'instant' ? t('common.instant') : `${mult}x`}
                </button>
              ))}
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <button
              onClick={() => setIsPlaying(!isPlaying)}
              className={`btn ${isPlaying ? 'btn-warn' : 'btn-accent'}`}
              style={{ flex: 1 }}
            >
              {isPlaying ? <Pause size={16} /> : <Play size={16} />}
              <span>{isPlaying ? t('common.pauseSimulation') : t('common.startSimulation')}</span>
            </button>

            <button
              onClick={onReset}
              title={t('speedControls.resetTooltip')}
              aria-label={t('speedControls.resetTooltip')}
              className="btn btn-icon"
            >
              <RotateCcw size={16} />
            </button>
          </div>
        </div>

      </div>
    </section>
  );
}
