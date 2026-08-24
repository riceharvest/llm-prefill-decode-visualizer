import React from 'react';
import { Play, Pause, RotateCcw, FastForward, Gauge, Zap } from 'lucide-react';
import { sanityWarnings } from '../../api/_math.js';
import SanityWarnings from './SanityWarnings';
import Analogy from './Analogy';
import { t } from '../i18n/strings';
import { formatNum } from '../utils/numerals';

// Time-scale options (#76): rendered as an ARIA radiogroup with roving
// tabindex — one option is tabbable, arrow keys move and select.
const TIME_OPTIONS = [1, 2, 5, 20, 'instant'];

const timeOptionLabel = (mult) => (mult === 'instant' ? t('common.instant') : `${mult}x`);

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

  // Roving-tabindex arrow-key navigation for the time-scale radiogroup.
  // Selection follows focus (the standard radio pattern); Home/End jump to
  // the ends. Unknown URL-injected multipliers clamp to the first option.
  const currentTimeIndex = Math.max(0, TIME_OPTIONS.indexOf(simSpeedMultiplier));
  const handleTimeRadioKey = (e) => {
    let nextIndex = null;
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') nextIndex = (currentTimeIndex + 1) % TIME_OPTIONS.length;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') nextIndex = (currentTimeIndex - 1 + TIME_OPTIONS.length) % TIME_OPTIONS.length;
    else if (e.key === 'Home') nextIndex = 0;
    else if (e.key === 'End') nextIndex = TIME_OPTIONS.length - 1;
    if (nextIndex !== null) {
      e.preventDefault();
      setSimSpeedMultiplier(TIME_OPTIONS[nextIndex]);
    }
  };

  return (
    <section className="panel" aria-label="Simulation speed controls">
      <SanityWarnings warnings={speedWarnings} />
      <div className="grid-auto" style={{ '--grid-min': '17.5rem', alignItems: 'stretch' }}>

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
              aria-valuetext={`${formatNum(Number(prefillSpeed))} tokens per second`}
              onChange={(e) => setPrefillSpeed(Number(e.target.value))}
              style={{ flex: 1 }}
            />
            <input
              type="number"
              value={prefillSpeed}
              aria-label={t('speedControls.prefillValueAria')}
              onChange={(e) => setPrefillSpeed(Number(e.target.value))}
              style={{ width: '5.5rem' }}
            />
            <span className="field-label">{t('common.tokPerSec')}</span>
          </div>
        </div>

        {/* Decode Speed Input */}
        <div className="panel-inset" data-tour="decode-slider" style={{ borderInlineStart: '2px solid var(--decode)' }}>          <div className="field-head" style={{ marginBottom: '10px' }}>
            <span className="panel-title" style={{ color: 'var(--decode)' }}>
              <Gauge size={15} style={{ color: 'var(--decode)' }} />
              {t('speedControls.decodeSpeed')}
              <Analogy term="decode" />
            </span>
            <span className="tag tag-decode">{t('speedControls.bandwidthBound')} · {decodeSpeed > 0 ? (1000 / decodeSpeed).toFixed(1) : '∞'} ms/tok</span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <input
              type="range"
              min="2"
              max="1000"
              step="1"
              value={decodeSpeed}
              aria-label={t('speedControls.decodeAria')}
              aria-valuetext={`${formatNum(Number(decodeSpeed))} tokens per second`}
              onChange={(e) => setDecodeSpeed(Number(e.target.value))}
              style={{ flex: 1 }}
            />
            <input
              type="number"
              value={decodeSpeed}
              aria-label={t('speedControls.decodeValueAria')}
              onChange={(e) => setDecodeSpeed(Number(e.target.value))}
              style={{ width: '5.5rem' }}
            />
            <span className="field-label">{t('common.tokPerSec')}</span>
          </div>
        </div>

        {/* Simulation Speed & Controls */}
        <div className="panel-inset" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between', gap: '12px' }}>
          <div className="field-head">
            <span className="panel-title">
              <FastForward size={15} />
              {t('speedControls.timeScale')}
            </span>
            <div className="seg" role="radiogroup" aria-label={t('speedControls.timeScaleAria')} onKeyDown={handleTimeRadioKey}>
              {TIME_OPTIONS.map(mult => (
                <button
                  key={mult}
                  onClick={() => setSimSpeedMultiplier(mult)}
                  role="radio"
                  aria-checked={simSpeedMultiplier === mult}
                  tabIndex={TIME_OPTIONS[currentTimeIndex] === mult ? 0 : -1}
                  className={simSpeedMultiplier === mult ? 'active' : ''}
                >
                  {timeOptionLabel(mult)}
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
