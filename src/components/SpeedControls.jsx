import React from 'react';
import { Play, Pause, RotateCcw, FastForward, Gauge, Zap } from 'lucide-react';
import { sanityWarnings } from '../../api/_math.js';
import SanityWarnings from './SanityWarnings';
import Analogy from './Analogy';
import { t } from '../i18n/strings';
import { TESTIDS } from '../utils/testids';

// Time-scale options (#76): rendered as an ARIA radiogroup with roving
// tabindex — one option is tabbable, arrow keys move and select.
const TIME_OPTIONS = [1, 2, 5, 20, 'instant'];

const timeOptionLabel = (mult) => (mult === 'instant' ? t('common.instant') : `${mult}x`);

// Slider ranges for the two speed controls. The number twins mirror them via
// min/max attributes and clamp on commit (#409) so the field can never display
// a value the simulation is not using.
export const PREFILL_RANGE = { min: 50, max: 50000 };
export const DECODE_RANGE = { min: 2, max: 1000 };

/** Number-twin onChange: ignore empty/garbage input, clamp the rest. */
const commitSpeedNumber = (setter, { min, max }) => (e) => {
  if (e.target.value === '') return;
  const n = Number(e.target.value);
  if (!Number.isFinite(n)) return;
  setter(clampNum(n, min, max));
};

export default function SpeedControls({
  prefillSpeed,
  setPrefillSpeed,
  decodeSpeed,
  setDecodeSpeed,
  simSpeedMultiplier,
  setSimSpeedMultiplier,
  isPlaying,
  setIsPlaying,
  onReset,
  hideSpeedInputs = false
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

        {/* Issue #405: the A/B replay ignores the global prefill/decode speeds
            (lanes use their own hardware profiles) — rendering editable inputs
            there made agents believe they had changed the simulation. Hide the
            two speed insets on that tab; time-scale + transport stay live. */}
        {!hideSpeedInputs && (
        <>
        {/* Prefill Speed Input */}
        <div className="panel-inset" data-testid="panel-prefill" style={{ borderInlineStart: '2px solid var(--prefill)' }}>          <div className="field-head" style={{ marginBottom: '10px' }}>
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
              data-testid={TESTIDS.prefillRange}
              aria-label={t('speedControls.prefillAria')}
              aria-valuetext={`${Number(prefillSpeed).toLocaleString()} tokens per second`}
              onChange={(e) => setPrefillSpeed(Number(e.target.value))}
              style={{ flex: 1 }}
            />
            <input
              type="number"
              min={PREFILL_RANGE.min}
              max={PREFILL_RANGE.max}
              value={prefillSpeed}
              data-testid={TESTIDS.prefillInput}
              aria-label={t('speedControls.prefillValueAria')}
              title={`Valid range ${PREFILL_RANGE.min}–${PREFILL_RANGE.max} tok/s; values outside it are clamped`}
              onChange={commitSpeedNumber(setPrefillSpeed, PREFILL_RANGE)}
              style={{ width: '5.5rem' }}
            />
            <span className="field-label">{t('common.tokPerSec')}</span>
          </div>
        </div>

        {/* Decode Speed Input */}
        <div className="panel-inset" data-testid="panel-decode" style={{ borderInlineStart: '2px solid var(--decode)' }}>          <div className="field-head" style={{ marginBottom: '10px' }}>
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
              data-testid={TESTIDS.decodeRange}
              aria-label={t('speedControls.decodeAria')}
              aria-valuetext={`${Number(decodeSpeed).toLocaleString()} tokens per second`}
              onChange={(e) => setDecodeSpeed(Number(e.target.value))}
              style={{ flex: 1 }}
            />
            <input
              type="number"
              min={DECODE_RANGE.min}
              max={DECODE_RANGE.max}
              value={decodeSpeed}
              data-testid={TESTIDS.decodeInput}
              aria-label={t('speedControls.decodeValueAria')}
              title={`Valid range ${DECODE_RANGE.min}–${DECODE_RANGE.max} tok/s; values outside it are clamped`}
              onChange={commitSpeedNumber(setDecodeSpeed, DECODE_RANGE)}
              style={{ width: '5.5rem' }}
            />
            <span className="field-label">{t('common.tokPerSec')}</span>
          </div>
        </div>
        </>
        )}

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
                  data-testid={`${TESTIDS.timeScaleOption}-${mult === 'instant' ? 'instant' : mult + 'x'}`}
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
              data-testid={TESTIDS.simToggle}
              style={{ flex: 1 }}
              aria-label={isPlaying ? t('speedControls.pauseChatAria') : t('speedControls.startChatAria')}
            >
              {isPlaying ? <Pause size={16} /> : <Play size={16} />}
              <span>{isPlaying ? t('common.pauseSimulation') : t('common.startSimulation')}</span>
            </button>

            <button
              onClick={onReset}
              title={t('speedControls.resetTooltip')}
              aria-label={t('speedControls.resetTooltip')}
              data-testid={TESTIDS.simReset}
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
