import React, { useState, useEffect } from 'react';
import { Cpu } from 'lucide-react';
import { readParam, readParamNum, writeParams } from '../utils/urlState';
import { GPU_CARDS, parseParamBillions, planSplit } from '../utils/multiGpu';
import { t } from '../i18n/strings';
import Metric from './Metric';

function fmtGb(v) {
  if (!Number.isFinite(v)) return '—';
  return `${v.toFixed(1)} GB`;
}

/**
 * Multi-GPU split planner (#48): sits under the KV Cache panel in the same
 * tab and reuses its computed KV total. Users pick 1×/2×/4× cards, a
 * parallelism mode (tensor vs pipeline), the interconnect and a weight quant,
 * and get per-GPU VRAM share, decode-speed penalty and a fit verdict.
 */
export default function MultiGpuPlanner({ preset, totalKvBytes }) {
  const [gpuCount, setGpuCount] = useState(() => readParamNum('gpus', 2));
  const [mode, setMode] = useState(() => readParam('par') || 'tp');
  const [interconnect, setInterconnect] = useState(() => readParam('bus') || 'pcie');
  const [cardId, setCardId] = useState(() => readParam('card') || 'rtx3090');
  const [weightBytes, setWeightBytes] = useState(() => {
    const w = readParamNum('wprec', 0.5);
    return [2, 1, 0.5].includes(w) ? w : 0.5; // 2 = FP16/BF16, 1 = FP8/INT8, 0.5 = INT4
  });

  // Shareable per-tab settings (writeParams merges into the shared query string)
  useEffect(() => {
    writeParams({ gpus: gpuCount, par: mode, bus: interconnect, card: cardId, wprec: weightBytes });
  }, [gpuCount, mode, interconnect, cardId, weightBytes]);

  const card = GPU_CARDS.find(c => c.id === cardId) || GPU_CARDS[0];
  const paramB = parseParamBillions(preset.params);
  const safeGpuCount = [1, 2, 4].includes(gpuCount) ? gpuCount : 2;

  const plan = paramB
    ? planSplit({
        paramB,
        weightBytesPerParam: weightBytes,
        totalKvBytes,
        kvHeads: preset.kvHeads ?? null,
        kvLayers: preset.kvLayers ?? null,
        gpuCount: safeGpuCount,
        mode,
        interconnect,
        cardVramGb: card.vramGb
      })
    : null;

  const kvSuffix = plan?.kvSharded
    ? t('multiGpu.kvShardedSuffix', { n: safeGpuCount })
    : t('multiGpu.kvReplicatedSuffix', { n: safeGpuCount });

  return (
    <section className="panel" aria-label={t('multiGpu.panelAria')} style={{ marginTop: '18px' }}>
      <h2 className="panel-title" style={{ marginBottom: '12px' }}>
        <Cpu size={16} />
        <span>{t('multiGpu.panelTitle')}</span>
      </h2>

      <p className="hint-text" style={{ marginBottom: '18px', maxWidth: '900px' }}>
        {t('multiGpu.intro')}
      </p>

      {/* Layout controls */}
      <div className="grid-auto" style={{ '--grid-min': '240px', marginBottom: '18px' }}>

        <div className="panel-inset field">
          <div className="field-head">
            <span className="field-label">{t('multiGpu.layoutLabel')}</span>
            <span className="field-value" style={{ color: 'var(--accent)' }}>
              {safeGpuCount}× · {card.vramGb} GB {t('multiGpu.gpuUnit')}
            </span>
          </div>
          <div className="seg" role="group" aria-label={t('multiGpu.layoutLabel')} style={{ marginTop: '2px' }}>
            {[1, 2, 4].map(n => (
              <button
                key={n}
                onClick={() => setGpuCount(n)}
                className={safeGpuCount === n ? 'active' : ''}
                aria-pressed={safeGpuCount === n}
                style={{ flex: 1, fontFamily: 'var(--font-mono)', fontSize: '0.76rem' }}
              >
                {n}×
              </button>
            ))}
          </div>
        </div>

        <div className="panel-inset field">
          <div className="field-head">
            <span className="field-label">{t('multiGpu.parallelismLabel')}</span>
            <span className="field-value" style={{ color: 'var(--prefill)', fontSize: '0.68rem' }}>
              {mode === 'tp' ? t('multiGpu.tpHint') : t('multiGpu.ppHint')}
            </span>
          </div>
          <div className="seg" role="group" aria-label={t('multiGpu.parallelismLabel')} style={{ marginTop: '2px' }}>
            {[
              { val: 'tp', label: t('multiGpu.modeTp') },
              { val: 'pp', label: t('multiGpu.modePp') }
            ].map(opt => (
              <button
                key={opt.val}
                onClick={() => setMode(opt.val)}
                className={mode === opt.val ? 'active' : ''}
                aria-pressed={mode === opt.val}
                style={{ flex: 1 }}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        <div className="panel-inset field">
          <div className="field-head">
            <span className="field-label">{t('multiGpu.interconnectLabel')}</span>
            <span className="field-value" style={{ color: 'var(--decode)' }}>
              {plan ? `−${plan.decodePenaltyPct}% decode` : '—'}
            </span>
          </div>
          <div className="seg" role="group" aria-label={t('multiGpu.interconnectLabel')} style={{ marginTop: '2px' }}>
            {[
              { val: 'pcie', label: t('multiGpu.busPcie') },
              { val: 'nvlink', label: t('multiGpu.busNvlink') }
            ].map(opt => (
              <button
                key={opt.val}
                onClick={() => setInterconnect(opt.val)}
                className={interconnect === opt.val ? 'active' : ''}
                aria-pressed={interconnect === opt.val}
                disabled={safeGpuCount === 1}
                style={{ flex: 1, opacity: safeGpuCount === 1 ? 0.5 : 1 }}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        <div className="panel-inset field">
          <div className="field-head">
            <span className="field-label">{t('multiGpu.cardLabel')}</span>
            <span className="field-value" style={{ color: 'var(--accent)' }}>{card.vramGb} GB</span>
          </div>
          <div className="seg" role="group" aria-label={t('multiGpu.cardLabel')} style={{ flexWrap: 'wrap', marginTop: '2px', gap: '2px' }}>
            {GPU_CARDS.map(c => (
              <button
                key={c.id}
                onClick={() => setCardId(c.id)}
                data-tooltip={c.name}
                className={cardId === c.id ? 'active' : ''}
                aria-pressed={cardId === c.id}
                style={{ fontFamily: 'var(--font-mono)', fontSize: '0.68rem', padding: '4px 7px' }}
              >
                {c.vramGb} GB
              </button>
            ))}
          </div>
        </div>

        <div className="panel-inset field">
          <div className="field-head">
            <span className="field-label">{t('multiGpu.weightPrecisionLabel')}</span>
            <span className="field-value" style={{ color: 'var(--prefill)' }}>
              {weightBytes === 2 ? 'FP16/BF16' : weightBytes === 1 ? 'FP8/INT8' : 'INT4'}
            </span>
          </div>
          <div className="seg" role="group" aria-label={t('multiGpu.weightPrecisionLabel')} style={{ marginTop: '2px' }}>
            {[
              { val: 2, label: t('multiGpu.wprecFp16') },
              { val: 1, label: t('multiGpu.wprecFp8') },
              { val: 0.5, label: t('multiGpu.wprecInt4') }
            ].map(opt => (
              <button
                key={opt.val}
                onClick={() => setWeightBytes(opt.val)}
                className={weightBytes === opt.val ? 'active' : ''}
                aria-pressed={weightBytes === opt.val}
                style={{ flex: 1 }}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

      </div>

      {plan && (
        <>
          {/* Results */}
          <div className="metric-grid">
            <div className="metric" style={{ borderInlineStartColor: 'var(--accent)' }}>
              <div className="metric-label">{t('multiGpu.metricWeightsPerGpu')}</div>
              <div className="metric-value" style={{ color: 'var(--accent)' }}>
                <Metric
                  term="gpuSplitVram"
                  substitution={`${preset.params} × ${weightBytes} B ÷ ${safeGpuCount} = ${fmtGb(plan.weightsPerGpuGb)}`}
                >
                  {fmtGb(plan.weightsPerGpuGb)}
                </Metric>
              </div>
            </div>

            <div className="metric" style={{ borderInlineStartColor: 'var(--prefill)' }}>
              <div className="metric-label">
                {t('multiGpu.metricKvPerGpu')} · {kvSuffix}
              </div>
              <div className="metric-value" style={{ color: 'var(--prefill)' }}>
                <Metric
                  term="gpuSplitVram"
                  substitution={`${fmtGb(plan.kvPerGpuGb * safeGpuCount)} total ${plan.kvSharded ? '÷' : '×'} ${safeGpuCount} = ${fmtGb(plan.kvPerGpuGb)}`}
                >
                  {fmtGb(plan.kvPerGpuGb)}
                </Metric>
              </div>
            </div>

            <div className="metric" style={{ borderInlineStartColor: 'var(--decode)' }}>
              <div className="metric-label">{t('multiGpu.metricVramPerGpu')}</div>
              <div className="metric-value" style={{ color: 'var(--decode)', fontSize: '1.55rem' }}>
                <Metric
                  term="gpuSplitVram"
                  substitution={`${fmtGb(plan.weightsPerGpuGb)} + ${fmtGb(plan.kvPerGpuGb)} + ${plan.overheadGb} overhead = ${fmtGb(plan.perGpuNeededGb)} vs ${fmtGb(plan.usableVramGb)} usable`}
                  align="left"
                >
                  {fmtGb(plan.perGpuNeededGb)}
                </Metric>
              </div>
            </div>

            <div className="metric" style={{ borderInlineStartColor: 'var(--decode)' }}>
              <div className="metric-label">{t('multiGpu.metricDecodePenalty')}</div>
              <div className="metric-value" style={{ color: plan.decodePenaltyPct > 0 ? 'var(--agent)' : 'var(--decode)' }}>
                <Metric
                  term="gpuDecodePenalty"
                  substitution={t('multiGpu.penaltySub', {
                    base: '100',
                    pct: plan.decodePenaltyPct,
                    bus: interconnect === 'pcie' ? t('multiGpu.busPcie') : t('multiGpu.busNvlink'),
                    effective: `${(plan.effectiveDecodeFactor * 100).toFixed(0)}`
                  })}
                >
                  −{plan.decodePenaltyPct}%
                </Metric>
              </div>
            </div>

            <div
              className="metric"
              style={{ borderInlineStartColor: plan.fits ? 'var(--accent)' : 'var(--agent)' }}
            >
              <div className="metric-label">{t('multiGpu.metricFit', { card: `${safeGpuCount}× ${card.vramGb} GB` })}</div>
              <div
                className="metric-value"
                style={{ color: plan.fits ? 'var(--accent)' : 'var(--agent)', fontSize: '1.55rem' }}
              >
                {plan.fits
                  ? t('multiGpu.fitYes', { headroom: fmtGb(plan.headroomGb) })
                  : t('multiGpu.fitNo', { over: fmtGb(-plan.headroomGb) })}
              </div>
            </div>
          </div>

          {/* Warnings */}
          {plan.warnings.includes('doesNotFit') && (
            <p style={{ fontSize: '0.76rem', color: 'var(--agent)', background: 'var(--agent-dim)', border: '1px solid var(--agent-border)', borderRadius: 'var(--radius-md)', padding: '8px 12px', marginTop: '14px' }}>
              {t('multiGpu.warnDoesNotFit', {
                needed: fmtGb(plan.perGpuNeededGb),
                usable: fmtGb(plan.usableVramGb),
                vram: `${card.vramGb} GB`
              })}
            </p>
          )}

          {plan.warnings.includes('kvReplicated') && (
            <p style={{ fontSize: '0.76rem', color: 'var(--agent)', background: 'var(--agent-dim)', border: '1px solid var(--agent-border)', borderRadius: 'var(--radius-md)', padding: '8px 12px', marginTop: '14px' }}>
              {t('multiGpu.warnKvReplicated', {
                kvHeads: preset.kvHeads ?? '—',
                n: safeGpuCount
              })}
            </p>
          )}

          {plan.warnings.includes('singleCardFaster') && plan.largerCard && (
            <p style={{ fontSize: '0.76rem', color: 'var(--agent)', background: 'var(--agent-dim)', border: '1px solid var(--agent-border)', borderRadius: 'var(--radius-md)', padding: '8px 12px', marginTop: '14px' }}>
              {t('multiGpu.warnSingleCardFaster', { card: plan.largerCard.name })}
            </p>
          )}

          <p style={{ fontSize: '0.7rem', color: 'var(--text-subtle)', marginTop: '12px' }}>
            {t('multiGpu.footnote')}
          </p>
        </>
      )}

    </section>
  );
}
