import React, { useRef, useState, useEffect } from 'react';
import { HARDWARE_PRESETS, formatTime, formatTokens } from '../utils/presets';
import { BarChart3, Users, PlugZap, ClipboardCopy, FileDown } from 'lucide-react';
import { readParam, readParamNum, readParamBool, writeParams } from '../utils/urlState';
import { methodologyMismatch } from '../utils/localMaxxing';
import { buildSizingReport, buildSizingReportJson, buildSizingReportYaml, buildSizingReportMarkdown, downloadSizingReport } from '../utils/sizingReport';
import { buildDeepLink } from '../utils/exportMarkdown';
import QuantTradeoffMatrix from './QuantTradeoffMatrix';
import ChartDataTable from './ChartDataTable';
import Metric from './Metric';
import SloBadge from './SloBadge';
import { estimateFromLabel } from '../utils/streetPricing';
import { exportNodeAsPng } from '../utils/exportPng';
import { copyTextToClipboard } from '../utils/clipboard';
import EmbedDialog from './EmbedDialog';
import { buildCompareBatchBody, buildSnippet } from '../utils/copyAsCode';
import { evaluateSlo } from '../utils/slo.js';
import { estimatePower } from '../utils/powerThermal';
import { t } from '../i18n/strings';


// Fallback whole-rig wattage under inference load for profiles without
// measured/curated power data (LocalMaxxing runs, custom profiles). Curated
// presets carry their own `loadWatts` (issue #69).
const DEFAULT_LOAD_WATTS = 400;
const defaultWattsFor = (preset) =>
  (Number.isFinite(preset?.loadWatts) ? preset.loadWatts : DEFAULT_LOAD_WATTS);

/**
 * Power/thermal facts for a compare card (#69). Built-in presets carry the
 * fields directly; LocalMaxxing community runs are estimated from the run's
 * own hardware fields via the shared estimator. Returns null when nothing
 * is known — we never invent a wattage.
 */
function powerInfoFor(preset) {
  if (Number.isFinite(preset?.tdpWatts) || Number.isFinite(preset?.loadWatts)
    || Number.isFinite(preset?.psuWatts) || preset?.powerNote) {
    const perCard = /\bdual\b|\b2\s*[x×]\b/i.test(preset.name || '') ? 2 : 1;
    return {
      tdpWatts: Number.isFinite(preset.tdpWatts) ? preset.tdpWatts : null,
      perCard,
      loadWatts: Number.isFinite(preset.loadWatts) ? preset.loadWatts : null,
      psuWatts: Number.isFinite(preset.psuWatts) ? preset.psuWatts : null,
      note: preset.powerNote || null
    };
  }
  const hw = preset?.run?.hardware;
  if (!hw) return null;
  return estimatePower({
    gpu: hw.gpuName,
    hwClass: hw.hwClass,
    gpuCount: hw.gpuCount,
    chip: hw.chipVariant || hw.chipFamily
  });
}

export default function HardwareComparison({ presets = HARDWARE_PRESETS, localMaxxingContext, sloBudgets, onApplySpeeds }) {
  const [hardwareA, setHardwareA] = useState(() => readParam('hwA') || 'groq');
  const [hardwareB, setHardwareB] = useState(() => readParam('hwB') || 'rtx4090_exl2');
  const [batchSize, setBatchSize] = useState(() => Math.max(1, Math.round(readParamNum('batch', 1))));
  const sharedPair = useRef({
    hardwareA,
    hardwareB,
    // Any pair the URL carried in (shared permalink OR the user's own
    // persisted selection from a previous visit to this tab) must survive
    // the LMX auto-select below — otherwise switching tabs away and back
    // clobbers an explicit hwA/hwB choice with lmx defaults.
    preserve: readParam('hwA') !== null || readParam('hwB') !== null
  });
  const [testPromptTokens, setTestPromptTokens] = useState(() => readParamNum('cp', 4096));
  const [testOutputTokens, setTestOutputTokens] = useState(() => readParamNum('co', 512));
  // Optional pricing: $ per 1M tokens (input/output) per system. Leave blank
  // for local hardware where marginal cost is electricity, not tokens.
  const [priceAIn, setPriceAIn] = useState(() => readParam('piA') ?? '');
  const [priceAOut, setPriceAOut] = useState(() => readParam('poA') ?? '');
  const [priceBIn, setPriceBIn] = useState(() => readParam('piB') ?? '');
  const [priceBOut, setPriceBOut] = useState(() => readParam('poB') ?? '');

  // TCO: local electricity vs cloud pricing. Marginal cost of a local rig is
  // watts-under-load × $/kWh; cloud cost is a single blended $/M token input.
  const [tcoHw, setTcoHw] = useState(() => readParam('tcoHw') || 'rtx4090_exl2');
  const [tcoWatts, setTcoWatts] = useState(() => readParam('tcoW') ?? String(defaultWattsFor(presets.find(p => p.id === (readParam('tcoHw') || 'rtx4090_exl2')))));
  const [tcoKwh, setTcoKwh] = useState(() => readParam('tcoKwh') ?? '0.30');
  const [tcoCloud, setTcoCloud] = useState(() => readParam('tcoCloud') ?? '');
  const [tcoCapex, setTcoCapex] = useState(() => readParam('tcoCapex') ?? '2500');
  const [tcoAmortMonths, setTcoAmortMonths] = useState(() => Math.max(1, Math.round(readParamNum('tcoAmort', 24))));

  const handleTcoHwChange = (id) => {
    setTcoHw(id);
    setTcoWatts(String(defaultWattsFor(presets.find(p => p.id === id))));
  };

  // Shareable per-tab settings
  useEffect(() => {
    writeParams({
      hwA: hardwareA, hwB: hardwareB, cp: testPromptTokens, co: testOutputTokens,
      batch: batchSize === 1 ? '' : batchSize,
      piA: priceAIn, poA: priceAOut, piB: priceBIn, poB: priceBOut,
      tcoHw, tcoW: tcoWatts, tcoKwh, tcoCloud, tcoCapex, tcoAmort: tcoAmortMonths
    });
  }, [hardwareA, hardwareB, testPromptTokens, testOutputTokens, batchSize, priceAIn, priceAOut, priceBIn, priceBOut, tcoHw, tcoWatts, tcoKwh, tcoCloud, tcoCapex, tcoAmortMonths]);

  useEffect(() => {
    const localPresets = presets.filter(preset => preset.localMaxxing);
    if (!localPresets.length) return;

    if (sharedPair.current.preserve) {
      // Check against the full presets list: an explicit non-LMX pair is just
      // as preserved as an LMX one; only stale/unknown ids fall through.
      const sharedPairIsAvailable = presets.some(preset => preset.id === sharedPair.current.hardwareA)
        && presets.some(preset => preset.id === sharedPair.current.hardwareB);
      sharedPair.current.preserve = false;
      if (sharedPairIsAvailable) return;
    }

    const preferredId = localMaxxingContext?.selectedRunId
      ? `lmx:${localMaxxingContext.selectedRunId}`
      : localPresets[0].id;
    const primary = localPresets.find(preset => preset.id === preferredId) || localPresets[0];
    const comparison = localPresets.find(preset => preset.hardwareKey !== primary.hardwareKey)
      || localPresets.find(preset => preset.id !== primary.id)
      || primary;

    setHardwareA(primary.id);
    setHardwareB(comparison.id);
  }, [localMaxxingContext?.modelId, localMaxxingContext?.quantization, localMaxxingContext?.selectedRunId, presets]);

  const presetA = presets.find(p => p.id === hardwareA) || presets[0] || HARDWARE_PRESETS[0];
  const presetB = presets.find(p => p.id === hardwareB) || presets[1] || HARDWARE_PRESETS[2];

  // Street-price estimates: curated USD range plus direct eBay/Craigslist
  // search links and an as-of date, so a budget line can be verified against
  // live listings instead of trusted blindly.
  const pricingA = estimateFromLabel(presetA.name);
  const pricingB = estimateFromLabel(presetB.name);

  const renderPricing = (preset, pricing) => {
    if (!pricing) return null;
    return (
      <>
        <div style={{ ...rowStyle, ...rowDivider }}>
          <span>Street price</span>
          <span style={numStyle}>
            ${pricing.estimateUsd.toLocaleString()}
            <span style={{ color: 'var(--text-subtle)', fontWeight: 400 }}> (${pricing.lowUsd.toLocaleString()}–${pricing.highUsd.toLocaleString()})</span>
          </span>
        </div>
        {/* rowDivider styling lives on the price row; links sit directly under it */}
        <div style={{ fontSize: '0.72rem' }}>
          <a href={pricing.links.ebay} target="_blank" rel="noreferrer" aria-label={`eBay listings for ${preset.name}`}>eBay ↗</a>
          {' · '}
          <a href={pricing.links.ebayUsed} target="_blank" rel="noreferrer" aria-label={`used eBay listings for ${preset.name}`}>used ↗</a>
          {' · '}
          <a href={pricing.links.craigslist} target="_blank" rel="noreferrer" aria-label={`Craigslist listings for ${preset.name}`}>Craigslist ↗</a>
          <span style={{ color: 'var(--text-subtle)' }}> · est. as of {pricing.asOf}</span>
        </div>
      </>
    );
  };

  const safeCp = Math.max(0, testPromptTokens || 0);
  const safeCo = Math.max(0, testOutputTokens || 0);

  // Batched serving model: prefill throughput scales near-linearly with batch
  // (compute-bound, still GEMM), while decode per-user throughput degrades with
  // batch size (bandwidth shared across sequences — the classic batch tradeoff:
  // aggregate tok/s grows sub-linearly, per-user latency grows ~linearly).
  // Decode efficiency factor: empirical ~1/sqrt(B) per-user decay is too harsh
  // for small B; use B^0.25 penalty which matches measured llama.cpp/vLLM
  // single-GPU curves reasonably in the 1-64 range.
  const decodeEffA = Math.pow(batchSize, -0.25);
  const decodeEffB = decodeEffA; // same relative penalty for both systems
  // Power/thermal rows (#69): board power (TDP), whole-rig inference draw
  // and PSU guidance — hidden entirely when nothing is known about the
  // hardware, so cloud/edge/custom cards stay clean.
  const renderPower = (preset) => {
    const p = powerInfoFor(preset);
    if (!p) return null;
    return (
      <>
        {p.tdpWatts != null && (
          <div style={rowStyle}>
            <span>GPU TDP{p.perCard > 1 ? ` × ${p.perCard}` : ''}</span>
            <span style={numStyle}>{p.tdpWatts} W{p.perCard > 1 ? ' / card' : ''}</span>
          </div>
        )}
        {p.loadWatts != null && (
          <div style={rowStyle}>
            <span>Rig draw under load</span>
            <span style={numStyle}>{p.loadWatts} W</span>
          </div>
        )}
        {p.psuWatts != null && (
          <div style={rowStyle}>
            <span>PSU guidance</span>
            <span style={numStyle}>≥ {p.psuWatts} W</span>
          </div>
        )}
        {p.note && (
          <p className="hint-text" style={{ margin: 0 }} aria-label={`Power notes for ${preset.name}`}>{p.note}</p>
        )}
      </>
    );
  };

  const batchedPerUserDecodeA = presetA.decodeSpeed * decodeEffA;
  const batchedPerUserDecodeB = presetB.decodeSpeed * decodeEffB;

  const ttftA = safeCp / presetA.prefillSpeed;
  const decodeTimeA = safeCo / batchedPerUserDecodeA;
  const totalTimeA = ttftA + decodeTimeA;

  const ttftB = safeCp / presetB.prefillSpeed;
  const decodeTimeB = safeCo / batchedPerUserDecodeB;
  const totalTimeB = ttftB + decodeTimeB;

  // Aggregate throughput across the batch. Mirrors api/_math.js batched()
  // (b × perUserDecode) so it stays correct at outputTokens=0 — deriving it
  // from output tokens / decode time would collapse to 0 there.
  const aggregateTokPerSecA = batchSize * batchedPerUserDecodeA;
  const aggregateTokPerSecB = batchSize * batchedPerUserDecodeB;

  // Cost per request: (prompt/1M × $in) + (output/1M × $out). Blank prices → null.
  const costPerRequest = (pIn, pOut) => {
    const inP = parseFloat(pIn), outP = parseFloat(pOut);
    if (!Number.isFinite(inP) && !Number.isFinite(outP)) return null;
    return (safeCp / 1e6) * (Number.isFinite(inP) ? inP : 0)
         + (safeCo / 1e6) * (Number.isFinite(outP) ? outP : 0);
  };
  const costA = costPerRequest(priceAIn, priceAOut);
  const costB = costPerRequest(priceBIn, priceBOut);

  // ---- TCO: electricity vs cloud -----------------------------------------
  // Marginal local cost is electricity only: (W/1000 × $/kWh) ÷ aggregate
  // decode tok/s → $ per token. The rig draws power whenever it is on, so
  // monthly electricity assumes 24/7 load. Break-even answers: how many
  // tokens/month make cloud spend equal owning the rig (capex amortized +
  // always-on electricity)? Below that volume, renting wins.
  const tcoPreset = presets.find(p => p.id === tcoHw) || presets[0] || HARDWARE_PRESETS[0];
  const tcoWattsNum = parseFloat(tcoWatts);
  const tcoKwhNum = parseFloat(tcoKwh);
  const tcoCloudNum = parseFloat(tcoCloud);
  const tcoCapexNum = parseFloat(tcoCapex);
  const tcoValid = Number.isFinite(tcoWattsNum) && tcoWattsNum > 0 && tcoPreset.decodeSpeed > 0;

  const tcoThroughput = tcoValid
    ? tcoPreset.decodeSpeed * Math.pow(Math.max(1, batchSize), 0.75) // aggregate tok/s
    : 0;
  // kW × $/kWh is dollars per hour of full-load runtime.
  const tcoCostPerHour = tcoValid ? (tcoWattsNum / 1000) * (Number.isFinite(tcoKwhNum) ? tcoKwhNum : 0) : 0;
  const tcoLocalPerMtok = tcoThroughput > 0 ? ((tcoCostPerHour / 3600) / tcoThroughput) * 1e6 : null;
  const tcoMonthlyElectricity = tcoCostPerHour * 24 * 30; // 720 h month at constant load
  const tcoMonthlyCapex = Number.isFinite(tcoCapexNum) ? tcoCapexNum / tcoAmortMonths : 0;
  // Cloud must beat the marginal electricity cost for any break-even to exist.
  const tcoBreakEven = (tcoLocalPerMtok !== null && Number.isFinite(tcoCloudNum) && tcoCloudNum > tcoLocalPerMtok)
    ? ((tcoMonthlyCapex + tcoMonthlyElectricity) * 1e6) / (tcoCloudNum - tcoLocalPerMtok)
    : null;

  const speedupTotal = totalTimeA > 0 ? totalTimeB / totalTimeA : 0;
  const speedupPrefill = ttftA > 0 ? ttftB / ttftA : 0;
  const speedupDecode = decodeTimeA > 0 ? decodeTimeB / decodeTimeA : 0;

  // Chart-to-table alternative (#75): System A vs System B metrics with the
  // per-row advantage ratio, so exact values are readable without the bars.
  // For "lower is better" timings the factor is inverted so "A faster" always
  // means A wins that row; speeds compare directly (higher wins).
  const advantageCell = (valueA, valueB, lowerIsBetter) => {
    const a = Number(valueA);
    const b = Number(valueB);
    if (!Number.isFinite(a) || !Number.isFinite(b) || a <= 0 || b <= 0) {
      return t('chartTable.notComparable');
    }
    const aWins = lowerIsBetter ? a <= b : a >= b;
    const factor = aWins ? (lowerIsBetter ? b / a : a / b) : (lowerIsBetter ? a / b : b / a);
    return t(aWins ? 'chartTable.ratioSuffix' : 'chartTable.inverseRatioSuffix', { factor: factor.toFixed(2) });
  };
  const compareRows = [
    {
      id: 'prefillSpeed',
      label: t('compare.prefillSpeed'),
      cells: {
        a: `${presetA.prefillSpeed.toLocaleString()} tok/s`,
        b: `${presetB.prefillSpeed.toLocaleString()} tok/s`,
        advantage: advantageCell(presetA.prefillSpeed, presetB.prefillSpeed, false)
      }
    },
    {
      id: 'decodeSpeed',
      label: `${t('compare.decodeSpeed')} (${t('compare.perUserSuffix')})`,
      cells: {
        a: `${Math.round(batchedPerUserDecodeA).toLocaleString()} tok/s`,
        b: `${Math.round(batchedPerUserDecodeB).toLocaleString()} tok/s`,
        advantage: advantageCell(batchedPerUserDecodeA, batchedPerUserDecodeB, false)
      }
    },
    {
      id: 'ttft',
      label: 'TTFT (prompt)',
      cells: {
        a: formatTime(ttftA),
        b: formatTime(ttftB),
        advantage: advantageCell(ttftA, ttftB, true)
      }
    },
    {
      id: 'decodeTime',
      label: t('compare.decodeTime'),
      cells: {
        a: formatTime(decodeTimeA),
        b: formatTime(decodeTimeB),
        advantage: advantageCell(decodeTimeA, decodeTimeB, true)
      }
    },
    {
      id: 'totalWalltime',
      label: t('compare.totalWalltime'),
      cells: {
        a: formatTime(totalTimeA),
        b: formatTime(totalTimeB),
        advantage: advantageCell(totalTimeA, totalTimeB, true)
      }
    },
    ...(costA !== null && costB !== null
      ? [
          {
            id: 'costPerRequest',
            label: t('compare.costPerRequest'),
            cells: {
              a: `$${costA.toFixed(4)}`,
              b: `$${costB.toFixed(4)}`,
              advantage: advantageCell(costA, costB, true)
            }
          }
        ]
      : [])
  ];

  // SLO check (issue #64): badge each system's TTFT / TPOT / walltime against
  // the user's persisted budgets. Disabled budgets → null → no badge.
  const sloResultsA = evaluateSlo(
    {
      ttftSec: ttftA,
      tpotMs: batchedPerUserDecodeA > 0 ? 1000 / batchedPerUserDecodeA : Infinity,
      walltimeSec: totalTimeA
    },
    sloBudgets
  );
  const sloResultsB = evaluateSlo(
    {
      ttftSec: ttftB,
      tpotMs: batchedPerUserDecodeB > 0 ? 1000 / batchedPerUserDecodeB : Infinity,
      walltimeSec: totalTimeB
    },
    sloBudgets
  );

  const rowStyle = { display: 'flex', justifyContent: 'space-between', gap: '8px', fontSize: '0.82rem' };
  const rowDivider = { paddingTop: '8px', borderTop: '1px solid var(--border)' };
  const numStyle = { fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums', fontWeight: 600 };

  // Freshness tiers match the API contract (issue #38): fresh <90d, aging <1y,
  // stale ≥1y. Measured presets carry the source run's date + engine version.
  const tierColors = { fresh: 'var(--decode)', aging: 'var(--agent)', stale: 'var(--danger)' };
  const measuredLabel = preset => {
    if (!preset?.localMaxxing) return null;
    if (!preset.measuredAt) return 'date unknown';
    const version = preset.engineVersion ? ` · ${preset.run?.engine?.engineName || ''} ${preset.engineVersion}` : '';
    return `${preset.measuredAt.slice(0, 10)} · ${preset.ageDays}d (${preset.staleness})${version}`;
  };
  const mismatchReasons = methodologyMismatch(presetA, presetB);

  // Copy-as-code + PNG export (#17). The copied snippet is a runnable
  // batched POST that reproduces this exact A/B comparison against
  // /api/compute — the same request the API validates, and with
  // "dry_run": true it previews without executing.
  const chartRef = useRef(null);
  const [copiedLang, setCopiedLang] = useState('');
  const [copyFailedLang, setCopyFailedLang] = useState('');
  const [pngExportNote, setPngExportNote] = useState('');
  const [embedOpen, setEmbedOpen] = useState(false);
  const copyTimer = useRef(null);

  const snippetBody = buildCompareBatchBody({
    prefillSpeedA: presetA.prefillSpeed,
    decodeSpeedA: presetA.decodeSpeed,
    prefillSpeedB: presetB.prefillSpeed,
    decodeSpeedB: presetB.decodeSpeed,
    batchSize,
    promptTokens: safeCp,
    outputTokens: safeCo
  });

  // Issue #501: surface the failure too — a bare `catch {}` left headless
  // agents with zero signal on either outcome. Success keeps the transient
  // "Copied!" state; failure shows "Copy failed" + an aria-live announcement.
  const copySnippet = async (lang) => {
    const ok = await copyTextToClipboard(buildSnippet(lang, { origin: window.location.origin, body: snippetBody }));
    setCopiedLang(ok ? lang : '');
    setCopyFailedLang(ok ? '' : lang);
    clearTimeout(copyTimer.current);
    copyTimer.current = setTimeout(() => { setCopiedLang(''); setCopyFailedLang(''); }, 2000);
  };

  // Issue #497: PNG rasterization fails in headless/software-rendering
  // browsers (uncaught 'SVG rasterization failed', no download, no UI).
  // exportNodeAsPng now falls back to a raw SVG download and reports what
  // happened so the row can show a machine-detectable status message.
  const exportChartPng = async () => {
    if (!chartRef.current) return;
    try {
      const outcome = await exportNodeAsPng(chartRef.current, 'hardware-compare.png');
      setPngExportNote(outcome === 'svg-fallback'
        ? t('compare.pngFallbackNote')
        : '');
    } catch {
      setPngExportNote(t('compare.exportFailedNote'));
    }
  };

  const exportBtnStyle = { padding: '2px 8px', fontSize: '0.68rem' };

  // ---- Sizing report export (issue #49) ------------------------------------
  // One canonical snapshot of the current scenario feeds all three formats
  // (JSON / YAML / Markdown), so they can never disagree about a number.
  const sizingSystem = (role, preset, m) => {
    const run = preset.run || {};
    const hw = run.hardware || {};
    return {
      id: role,
      name: preset.name,
      engine: run.engine?.engineName || null,
      engineVersion: preset.engineVersion || null,
      measuredAt: preset.measuredAt || null,
      ageDays: Number.isFinite(preset.ageDays) ? preset.ageDays : undefined,
      staleness: preset.staleness || null,
      prefillSpeed: preset.prefillSpeed,
      decodeSpeed: preset.decodeSpeed,
      batchedPerUserDecode: m.batchedPerUserDecode,
      aggregateDecode: m.aggregateDecode,
      ttftSeconds: m.ttft,
      decodeSeconds: m.decodeTime,
      totalWalltimeSeconds: m.totalTime,
      hwClass: hw.hwClass || null,
      gpuName: hw.gpuName || null,
      gpuCount: hw.gpuCount,
      totalVramGb: hw.vramGb,
      unifiedMemoryGb: hw.unifiedMemoryGb,
      vramNote: preset.localMaxxing ? null : 'curated profile — memory not tracked per model; see the KV cache tab',
      costPerRequestUsd: m.cost ?? undefined,
      streetPriceUsd: m.pricing?.estimateUsd,
      streetPriceRangeUsd: m.pricing ? [m.pricing.lowUsd, m.pricing.highUsd] : undefined,
      sourceUrl: preset.sourceUrl || null
    };
  };

  const primaryRun = presetA.run || {};
  const handleExportSizingReport = (format) => {
    const report = buildSizingReport({
      generatedAt: new Date().toISOString(),
      deepLink: buildDeepLink('compare'),
      scenario: {
        modelId: localMaxxingContext?.modelId || primaryRun.model?.displayName || primaryRun.model?.hfId || null,
        quantization: localMaxxingContext?.quantization || primaryRun.engine?.quantization || null,
        contextTokens: safeCp,
        outputTokens: safeCo,
        concurrency: batchSize
      },
      systemA: sizingSystem('A', presetA, {
        ttft: ttftA, decodeTime: decodeTimeA, totalTime: totalTimeA,
        batchedPerUserDecode: batchedPerUserDecodeA, aggregateDecode: aggregateTokPerSecA,
        cost: costA, pricing: pricingA
      }),
      systemB: sizingSystem('B', presetB, {
        ttft: ttftB, decodeTime: decodeTimeB, totalTime: totalTimeB,
        batchedPerUserDecode: batchedPerUserDecodeB, aggregateDecode: aggregateTokPerSecB,
        cost: costB, pricing: pricingB
      }),
      tco: tcoValid ? {
        rigName: tcoPreset.name,
        watts: tcoWattsNum,
        kwh: tcoKwhNum,
        cloudPerMtok: tcoCloudNum,
        monthlyElectricity: tcoMonthlyElectricity,
        monthlyCapex: tcoMonthlyCapex,
        localPerMtok: tcoLocalPerMtok,
        breakEvenTokens: tcoBreakEven
      } : null,
      notes: [
        ...(mismatchReasons.length ? [`Methodology mismatch: ${mismatchReasons.join('; ')}.`] : []),
        `Batched decode applies a B^0.25 bandwidth-sharing penalty to measured single-stream speed at concurrency ${batchSize}.`
      ]
    });
    if (format === 'json') downloadSizingReport(buildSizingReportJson(report), 'sizing-report.json', 'application/json;charset=utf-8');
    else if (format === 'yaml') downloadSizingReport(buildSizingReportYaml(report), 'sizing-report.yaml', 'application/yaml;charset=utf-8');
    else downloadSizingReport(buildSizingReportMarkdown(report), 'sizing-report.md', 'text/markdown;charset=utf-8');
  };

  return (
    <div className="stack">

      <section className="panel" aria-label={t('compare.panelAria')} ref={chartRef}>
        <div className="field-head" style={{ marginBottom: '14px', flexWrap: 'wrap', gap: '8px' }}>
          <h2 className="panel-title" style={{ margin: 0 }} tabIndex={-1} data-panel-heading>
            <BarChart3 size={16} />
            <span>{t('compare.panelTitle')}</span>
          </h2>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.68rem', fontWeight: 600, marginLeft: 'auto' }}>
            <span style={{ color: 'var(--text-subtle)', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
              <ClipboardCopy size={12} />
              {t('compare.exportRowLabel')}
            </span>
            <button
              onClick={exportChartPng}
              className="btn"
              style={exportBtnStyle}
              title={t('compare.exportPngTooltip')}
            >
              {t('compare.exportPng')}
            </button>
            <button
              onClick={() => setEmbedOpen(true)}
              className="btn"
              style={exportBtnStyle}
              title={t('embed.buttonTooltip')}
            >
              {t('embed.button')}
            </button>
            {['curl', 'python', 'typescript'].map(lang => (
              <button
                key={lang}
                onClick={() => copySnippet(lang)}
                className="btn"
                style={{
                  ...exportBtnStyle,
                  color: copiedLang === lang ? 'var(--decode)' : copyFailedLang === lang ? 'var(--agent)' : undefined
                }}
                title={copiedLang === lang
                  ? t('compare.copiedFeedback')
                  : copyFailedLang === lang
                    ? t('compare.copyFailedFeedback')
                    : t('compare.copySnippetTooltip')}
              >
                {copiedLang === lang
                  ? `✓ ${t('compare.copiedFeedback')}`
                  : copyFailedLang === lang
                    ? `✗ ${t('compare.copyFailedFeedback')}`
                    : t(`compare.copy${lang === 'curl' ? 'Curl' : lang === 'python' ? 'Python' : 'TypeScript'}`)}
              </button>
            ))}
          </div>
        </div>

        {/* Issue #501/#497: machine-detectable outcome for copy + PNG export */}
        {(copyFailedLang || pngExportNote) && (
          <p role="status" aria-live="polite" style={{ fontSize: '0.72rem', color: 'var(--agent)', margin: '4px 0 0' }}>
            {copyFailedLang && !copiedLang ? `${t('compare.copyFailedFeedback')} (${copyFailedLang})` : ''}
            {copyFailedLang && pngExportNote ? ' · ' : ''}
            {pngExportNote}
          </p>
        )}

        {localMaxxingContext?.runs?.length > 0 && (
          <div className="panel-inset" style={{ marginBottom: '14px', borderColor: 'var(--prefill-border)', background: 'var(--accent-dim)', color: 'var(--accent)', fontSize: '0.76rem', fontWeight: 600 }}>
            {t('compare.comparingBanner', {
              model: localMaxxingContext.modelId,
              quant: localMaxxingContext.quantization,
              runs: localMaxxingContext.runs.length
            })}
          </div>
        )}

        {/* Benchmark Test Parameters */}
        <div className="grid-auto" style={{ '--grid-min': '15rem', marginBottom: '16px' }}>
          <div className="panel-inset field">
            <div className="field-head">
              <span className="field-label">{t('compare.testPromptLength')}</span>
              <span className="field-value" style={{ color: 'var(--prefill)' }}>{formatTokens(testPromptTokens)} tok</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <input
                type="range"
                min="512"
                max="32768"
                step="512"
                value={testPromptTokens}
                aria-label={t('compare.testPromptAria')}
                aria-valuetext={`${testPromptTokens.toLocaleString()} tokens`}
                onChange={(e) => setTestPromptTokens(Number(e.target.value))}
                style={{ flex: 1 }}
              />
              <input
                type="number"
                value={testPromptTokens}
                aria-label={t('compare.testPromptValueAria')}
                onChange={(e) => setTestPromptTokens(Number(e.target.value))}
                style={{ width: '5rem' }}
              />
            </div>
          </div>

          <div className="panel-inset field">
            <div className="field-head">
              <span className="field-label">{t('compare.testOutputGeneration')}</span>
              <span className="field-value" style={{ color: 'var(--decode)' }}>{formatTokens(testOutputTokens)} tok</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <input
                type="range"
                min="64"
                max="4096"
                step="64"
                value={testOutputTokens}
                aria-label={t('compare.testOutputAria')}
                aria-valuetext={`${testOutputTokens.toLocaleString()} tokens`}
                onChange={(e) => setTestOutputTokens(Number(e.target.value))}
                style={{ flex: 1 }}
              />
              <input
                type="number"
                value={testOutputTokens}
                aria-label={t('compare.testOutputValueAria')}
                onChange={(e) => setTestOutputTokens(Number(e.target.value))}
                style={{ width: '5rem' }}
              />
            </div>
          </div>

          {/* Concurrent batch size */}
          <div className="panel-inset field">
            <div className="field-head">
              <span className="field-label">
                <Users size={13} style={{ verticalAlign: '-2px', marginInlineEnd: '4px' }} />
                {t('compare.concurrentUsers')}
              </span>
              <span className="field-value" style={{ color: 'var(--agent)' }}>{batchSize}×</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <input
                type="range"
                min="1"
                max="64"
                step="1"
                value={batchSize}
                aria-label={t('compare.batchAria')}
                aria-valuetext={`batch of ${batchSize} ${batchSize === 1 ? 'request' : 'requests'}`}
                onChange={(e) => setBatchSize(Number(e.target.value))}
                style={{ flex: 1 }}
              />
              <input
                type="number"
                value={batchSize}
                aria-label={t('compare.batchValueAria')}
                onChange={(e) => setBatchSize(Math.max(1, Math.round(Number(e.target.value) || 1)))}
                style={{ width: '5rem' }}
              />
            </div>
            <p className="hint-text" style={{ marginTop: '6px' }}>
              {batchSize === 1
                ? t('compare.batchHintSingle')
                : t('compare.batchHintShared', { batch: batchSize })}
            </p>
          </div>
        </div>

        {/* Hardware Selectors */}
        <div className="grid-auto" style={{ '--grid-min': '18.75rem' }}>

          {/* Hardware Config A */}
          <div className="panel-inset" style={{ borderColor: 'var(--prefill-border)', borderInlineStart: '2px solid var(--accent)' }}>
            <div className="section-label" style={{ color: 'var(--accent)', marginBottom: '8px' }}>
              {t('compare.systemAPrimary')}
            </div>
            <select
              value={hardwareA}
              onChange={(e) => setHardwareA(e.target.value)}
              aria-label={t('compare.systemAProfileAria')}
              style={{ width: '100%', marginBottom: '14px' }}
            >
              {presets.map(p => (
                <option key={p.id} value={p.id}>{p.icon} {p.name}</option>
              ))}
            </select>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '9px', color: 'var(--text-muted)' }}>
              <div style={rowStyle}>
                <span>{t('compare.prefillSpeed')}</span>
                <span style={{ ...numStyle, color: 'var(--prefill)' }}>{presetA.prefillSpeed.toLocaleString()} tok/s</span>
              </div>
              {measuredLabel(presetA) && (
                <div style={rowStyle}>
                  <span>Measured</span>
                  <span style={{ fontSize: '0.72rem', fontWeight: 600, color: tierColors[presetA.staleness] || 'var(--text-muted)' }}>
                    {measuredLabel(presetA)}
                  </span>
                </div>
              )}
              {presetA.sourceUrl && <a href={presetA.sourceUrl} target="_blank" rel="noreferrer" style={{ fontSize: '0.72rem', fontWeight: 600 }}>View LocalMaxxing source run ↗</a>}
              {renderPricing(presetA, pricingA)}
              {renderPower(presetA)}
              <div style={rowStyle}>
                <span>{t('compare.decodeSpeed')} <em style={{ color: 'var(--text-subtle)', fontStyle: 'normal', fontSize: '0.72rem' }}>({t('compare.perUserSuffix')})</em></span>
                <span style={{ ...numStyle, color: 'var(--decode)' }}>{Math.round(batchedPerUserDecodeA).toLocaleString()} tok/s</span>
              </div>
              {batchSize > 1 && (
                <div style={rowStyle}>
                  <span>{t('compare.aggregateDecodeThroughput')}</span>
                  <span style={{ ...numStyle, color: 'var(--agent)' }}>{Math.round(aggregateTokPerSecA).toLocaleString()} tok/s</span>
                </div>
              )}
              <div style={{ ...rowStyle, ...rowDivider }}>
                <span>TTFT (prompt)</span>
                <span style={{ ...numStyle, color: 'var(--prefill)' }}>
                  <Metric term="ttft" substitution={`${presetA.name}: ${safeCp.toLocaleString()} tok ÷ ${presetA.prefillSpeed.toLocaleString()} tok/s = ${formatTime(ttftA)}`} align="left">
                    {formatTime(ttftA)}
                  </Metric>
                  {' '}<SloBadge result={sloResultsA.ttft} label={t('slo.shortTtft')} />
                </span>
              </div>
              <div style={rowStyle}>
                <span>{t('compare.decodeTime')}</span>
                <span style={{ ...numStyle, color: 'var(--decode)' }}>
                  {formatTime(decodeTimeA)} <SloBadge result={sloResultsA.tpot} label={t('slo.shortTpot')} />
                </span>
              </div>
              <div style={{ ...rowStyle, ...rowDivider, fontWeight: 700, fontSize: '0.95rem', color: 'var(--text-main)' }}>
                <span>{t('compare.totalWalltime')}</span>
                <span style={{ ...numStyle, color: 'var(--accent)' }}>
                  {formatTime(totalTimeA)} <SloBadge result={sloResultsA.walltime} label={t('slo.shortWalltime')} />
                </span>
              </div>
              {/* Optional per-request cost */}
              <div style={{ ...rowStyle, marginTop: '6px', alignItems: 'center' }}>
                <span style={{ fontSize: '0.72rem' }}>{t('compare.priceLabel')}</span>
                <span style={{ display: 'flex', gap: '4px' }}>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    placeholder={t('compare.priceInPlaceholder')}
                    value={priceAIn}
                    aria-label={t('compare.priceInAria', { system: 'A' })}
                    onChange={(e) => setPriceAIn(e.target.value)}
                    style={{ width: '3.625rem', padding: '3px 5px', fontSize: '0.72rem' }}
                  />
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    placeholder={t('compare.priceOutPlaceholder')}
                    value={priceAOut}
                    aria-label={t('compare.priceOutAria', { system: 'A' })}
                    onChange={(e) => setPriceAOut(e.target.value)}
                    style={{ width: '3.625rem', padding: '3px 5px', fontSize: '0.72rem' }}
                  />
                </span>
              </div>
              {costA !== null && (
                <div style={rowStyle}>
                  <span>{t('compare.costPerRequest')}</span>
                  <span style={{ ...numStyle, color: 'var(--agent)' }}>${costA.toFixed(4)}</span>
                </div>
              )}
            </div>
          </div>

          {/* Hardware Config B */}
          <div className="panel-inset" style={{ borderInlineStart: '2px solid var(--border-strong)' }}>
            <div className="section-label" style={{ marginBottom: '8px' }}>
              {t('compare.systemBComparison')}
            </div>
            <select
              value={hardwareB}
              onChange={(e) => setHardwareB(e.target.value)}
              aria-label={t('compare.systemBProfileAria')}
              style={{ width: '100%', marginBottom: '14px' }}
            >
              {presets.map(p => (
                <option key={p.id} value={p.id}>{p.icon} {p.name}</option>
              ))}
            </select>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '9px', color: 'var(--text-muted)' }}>
              <div style={rowStyle}>
                <span>{t('compare.prefillSpeed')}</span>
                <span style={{ ...numStyle, color: 'var(--prefill)' }}>{presetB.prefillSpeed.toLocaleString()} tok/s</span>
              </div>
              {measuredLabel(presetB) && (
                <div style={rowStyle}>
                  <span>Measured</span>
                  <span style={{ fontSize: '0.72rem', fontWeight: 600, color: tierColors[presetB.staleness] || 'var(--text-muted)' }}>
                    {measuredLabel(presetB)}
                  </span>
                </div>
              )}
              {presetB.sourceUrl && <a href={presetB.sourceUrl} target="_blank" rel="noreferrer" style={{ fontSize: '0.72rem', fontWeight: 600 }}>View LocalMaxxing source run ↗</a>}
              {renderPricing(presetB, pricingB)}
              {renderPower(presetB)}
              <div style={rowStyle}>
                <span>{t('compare.decodeSpeed')} <em style={{ color: 'var(--text-subtle)', fontStyle: 'normal', fontSize: '0.72rem' }}>({t('compare.perUserSuffix')})</em></span>
                <span style={{ ...numStyle, color: 'var(--decode)' }}>{Math.round(batchedPerUserDecodeB).toLocaleString()} tok/s</span>
              </div>
              {batchSize > 1 && (
                <div style={rowStyle}>
                  <span>{t('compare.aggregateDecodeThroughput')}</span>
                  <span style={{ ...numStyle, color: 'var(--agent)' }}>{Math.round(aggregateTokPerSecB).toLocaleString()} tok/s</span>
                </div>
              )}
              <div style={{ ...rowStyle, ...rowDivider }}>
                <span>TTFT (prompt)</span>
                <span style={{ ...numStyle, color: 'var(--prefill)' }}>
                  <Metric term="ttft" substitution={`${presetB.name}: ${safeCp.toLocaleString()} tok ÷ ${presetB.prefillSpeed.toLocaleString()} tok/s = ${formatTime(ttftB)}`} align="left">
                    {formatTime(ttftB)}
                  </Metric>
                  {' '}<SloBadge result={sloResultsB.ttft} label={t('slo.shortTtft')} />
                </span>
              </div>
              <div style={rowStyle}>
                <span>{t('compare.decodeTime')}</span>
                <span style={{ ...numStyle, color: 'var(--decode)' }}>
                  {formatTime(decodeTimeB)} <SloBadge result={sloResultsB.tpot} label={t('slo.shortTpot')} />
                </span>
              </div>
              <div style={{ ...rowStyle, ...rowDivider, fontWeight: 700, fontSize: '0.95rem', color: 'var(--text-main)' }}>
                <span>{t('compare.totalWalltime')}</span>
                <span style={numStyle}>
                  {formatTime(totalTimeB)} <SloBadge result={sloResultsB.walltime} label={t('slo.shortWalltime')} />
                </span>
              </div>
              {/* Optional per-request cost */}
              <div style={{ ...rowStyle, marginTop: '6px', alignItems: 'center' }}>
                <span style={{ fontSize: '0.72rem' }}>{t('compare.priceLabel')}</span>
                <span style={{ display: 'flex', gap: '4px' }}>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    placeholder={t('compare.priceInPlaceholder')}
                    value={priceBIn}
                    aria-label={t('compare.priceInAria', { system: 'B' })}
                    onChange={(e) => setPriceBIn(e.target.value)}
                    style={{ width: '3.625rem', padding: '3px 5px', fontSize: '0.72rem' }}
                  />
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    placeholder={t('compare.priceOutPlaceholder')}
                    value={priceBOut}
                    aria-label={t('compare.priceOutAria', { system: 'B' })}
                    onChange={(e) => setPriceBOut(e.target.value)}
                    style={{ width: '3.625rem', padding: '3px 5px', fontSize: '0.72rem' }}
                  />
                </span>
              </div>
              {costB !== null && (
                <div style={rowStyle}>
                  <span>{t('compare.costPerRequest')}</span>
                  <span style={{ ...numStyle, color: 'var(--agent)' }}>${costB.toFixed(4)}</span>
                </div>
              )}
            </div>
          </div>

        </div>

        {mismatchReasons.length > 0 && (
          <div
            className="panel-inset"
            role="note"
            aria-label="Methodology mismatch warning"
            style={{ marginTop: '16px', borderColor: 'var(--danger)', color: 'var(--text-muted)', fontSize: '0.76rem' }}
          >
            <strong style={{ color: 'var(--danger)' }}>Methodology mismatch:</strong>{' '}
            System A and System B differ in {mismatchReasons.join('; ')}. The speedup ratios below compare numbers that may not be directly comparable.
          </div>
        )}

        {/* Speedup Ratio Summary */}
        <div className="metric-grid" style={{ marginTop: '16px' }}>
          <div
            className="metric"
            style={{ borderInlineStartColor: speedupTotal >= 1 ? 'var(--decode)' : 'var(--danger)', textAlign: 'center' }}
          >
            <div className="metric-label">{t('compare.metricOverall')}</div>
            <div className="metric-value" style={{ color: speedupTotal >= 1 ? 'var(--decode)' : 'var(--danger)', fontSize: '1.5rem' }}>
              <Metric
                term="speedupTotal"
                substitution={`${formatTime(totalTimeB)} ÷ ${formatTime(totalTimeA)} = ${speedupTotal > 0 ? `${speedupTotal.toFixed(2)}x` : '—'}`}
              >
                {speedupTotal > 0 ? (speedupTotal >= 1 ? `${speedupTotal.toFixed(2)}x faster` : `${(1 / speedupTotal).toFixed(2)}x slower`) : '—'}
              </Metric>
            </div>
            <div className="metric-sub">{t('compare.metricOverallSub')}</div>
          </div>

          <div className="metric" style={{ borderInlineStartColor: 'var(--prefill)', textAlign: 'center' }}>
            <div className="metric-label">{t('compare.metricPrefillAdvantage')}</div>
            <div className="metric-value" style={{ color: 'var(--prefill)' }}>
              <Metric term="speedupPrefill" substitution={`${formatTime(ttftB)} ÷ ${formatTime(ttftA)} = ${speedupPrefill.toFixed(2)}x`}>
                {speedupPrefill.toFixed(2)}x
              </Metric>
            </div>
          </div>

          <div className="metric" style={{ borderInlineStartColor: 'var(--decode)', textAlign: 'center' }}>
            <div className="metric-label">{t('compare.metricDecodeAdvantage')}</div>
            <div className="metric-value" style={{ color: 'var(--decode)' }}>
              <Metric term="speedupDecode" substitution={`${formatTime(decodeTimeB)} ÷ ${formatTime(decodeTimeA)} = ${speedupDecode.toFixed(2)}x`}>
                {speedupDecode.toFixed(2)}x
              </Metric>
            </div>
          </div>
        </div>

        {/* Chart-to-table alternative (#75): exact A-vs-B values behind the
            metric cards, with a per-row advantage ratio. */}
        <ChartDataTable
          caption={t('chartTable.compareCaption')}
          rowHeaderLabel={t('chartTable.metric')}
          columns={[
            { key: 'a', label: t('chartTable.systemA'), numeric: true },
            { key: 'b', label: t('chartTable.systemB'), numeric: true },
            { key: 'advantage', label: t('chartTable.aAdvantage') }
          ]}
          rows={compareRows}
          mode="disclosure"
        />

        {/* Sizing report export (issue #49): the full scenario config as a
            machine-readable artifact for infra-as-code repos, procurement
            tickets, and deployment runbooks. */}
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px', marginTop: '16px' }}>
          <span className="section-label" style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', marginInlineEnd: '4px' }}>
            <FileDown size={15} />
            <span>Export sizing report</span>
          </span>
          <button
            className="btn"
            onClick={() => handleExportSizingReport('json')}
            title="Download the current scenario as a machine-readable JSON sizing report"
          >
            JSON
          </button>
          <button
            className="btn"
            onClick={() => handleExportSizingReport('yaml')}
            title="Download the current scenario as a YAML sizing report"
          >
            YAML
          </button>
          <button
            className="btn"
            onClick={() => handleExportSizingReport('markdown')}
            title="Download the current scenario as a Markdown sizing report"
          >
            Markdown
          </button>
        </div>

      </section>

      {/* Quantization tradeoff matrix (issue #47): measured tok/s per quant
          for one model family; rows load into the sim via onApplySpeeds. */}
      <QuantTradeoffMatrix
        localMaxxingContext={localMaxxingContext}
        onApplySpeeds={onApplySpeeds}
      />

      {/* TCO: Local Electricity vs Cloud */}
      <section className="panel" aria-label="Total cost of ownership electricity versus cloud">
        <h2 className="panel-title" style={{ marginBottom: '14px' }}>
          <PlugZap size={16} />
          <span>TCO · Local Electricity vs Cloud</span>
        </h2>

        <div className="grid-auto" style={{ '--grid-min': '15rem', marginBottom: '16px' }}>
          <div className="panel-inset field">
            <div className="field-head">
              <span className="field-label">Local rig</span>
            </div>
            <select
              value={tcoHw}
              onChange={(e) => handleTcoHwChange(e.target.value)}
              aria-label="TCO local hardware profile"
              style={{ width: '100%' }}
            >
              {presets.map(p => (
                <option key={p.id} value={p.id}>{p.icon} {p.name}</option>
              ))}
            </select>
          </div>

          <div className="panel-inset field">
            <div className="field-head">
              <span className="field-label">Wattage under load</span>
              <span className="field-value" style={{ color: 'var(--agent)' }}>{tcoWatts || '—'} W</span>
            </div>
            <input
              type="number"
              min="1"
              step="10"
              value={tcoWatts}
              aria-label="Rig wattage under inference load"
              onChange={(e) => setTcoWatts(e.target.value)}
              style={{ width: '100%' }}
            />
          </div>

          <div className="panel-inset field">
            <div className="field-head">
              <span className="field-label">Electricity price</span>
              <span className="field-value" style={{ color: 'var(--agent)' }}>${tcoKwh || '—'}/kWh</span>
            </div>
            <input
              type="number"
              min="0"
              step="0.01"
              value={tcoKwh}
              aria-label="Local electricity price per kilowatt-hour"
              onChange={(e) => setTcoKwh(e.target.value)}
              style={{ width: '100%' }}
            />
          </div>

          <div className="panel-inset field">
            <div className="field-head">
              <span className="field-label">Cloud price</span>
              <span className="field-value" style={{ color: 'var(--agent)' }}>${tcoCloud || '—'}/Mtok</span>
            </div>
            <input
              type="number"
              min="0"
              step="0.10"
              placeholder="blended $ / 1M tok"
              value={tcoCloud}
              aria-label="Cloud price per million tokens"
              onChange={(e) => setTcoCloud(e.target.value)}
              style={{ width: '100%' }}
            />
          </div>

          <div className="panel-inset field">
            <div className="field-head">
              <span className="field-label">Rig cost</span>
              <span className="field-value" style={{ color: 'var(--agent)' }}>${tcoCapex || '—'}</span>
            </div>
            <input
              type="number"
              min="0"
              step="100"
              value={tcoCapex}
              aria-label="Local rig purchase price"
              onChange={(e) => setTcoCapex(e.target.value)}
              style={{ width: '100%' }}
            />
          </div>

          <div className="panel-inset field">
            <div className="field-head">
              <span className="field-label">Amortize over</span>
              <span className="field-value" style={{ color: 'var(--agent)' }}>{tcoAmortMonths} mo</span>
            </div>
            <input
              type="number"
              min="1"
              step="1"
              value={tcoAmortMonths}
              aria-label="Amortization period in months"
              onChange={(e) => setTcoAmortMonths(Math.max(1, Math.round(Number(e.target.value) || 1)))}
              style={{ width: '100%' }}
            />
          </div>
        </div>

        {tcoValid ? (
          <>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '9px', color: 'var(--text-muted)', maxWidth: '480px' }}>
              <div style={rowStyle}>
                <span>Aggregate decode throughput</span>
                <span style={{ ...numStyle, color: 'var(--decode)' }}>{Math.round(tcoThroughput).toLocaleString()} tok/s</span>
              </div>
              <div style={rowStyle}>
                <span>Local marginal cost (electricity only)</span>
                <span style={{ ...numStyle, color: 'var(--prefill)' }}>
                  {tcoLocalPerMtok !== null ? `$${tcoLocalPerMtok < 0.01 ? tcoLocalPerMtok.toFixed(4) : tcoLocalPerMtok.toFixed(2)} / Mtok` : '—'}
                </span>
              </div>
              {Number.isFinite(tcoCloudNum) && tcoLocalPerMtok !== null && (
                <div style={rowStyle}>
                  <span>Cloud cost</span>
                  <span style={{ ...numStyle, color: 'var(--agent)' }}>${tcoCloudNum.toFixed(2)} / Mtok</span>
                </div>
              )}
              <div style={{ ...rowStyle, ...rowDivider }}>
                <span>Always-on electricity (24/7 load)</span>
                <span style={numStyle}>${tcoMonthlyElectricity.toFixed(2)} / mo</span>
              </div>
              {tcoMonthlyCapex > 0 && (
                <div style={rowStyle}>
                  <span>Rig amortized over {tcoAmortMonths} mo</span>
                  <span style={numStyle}>${tcoMonthlyCapex.toFixed(2)} / mo</span>
                </div>
              )}
            </div>

            <div className="metric-grid" style={{ marginTop: '16px' }}>
              <div className="metric" style={{ borderLeftColor: tcoBreakEven !== null ? 'var(--decode)' : 'var(--prefill)', textAlign: 'center' }}>
                <div className="metric-label">Break-even volume</div>
                <div className="metric-value" style={{ color: tcoBreakEven !== null ? 'var(--decode)' : 'var(--prefill)', fontSize: '1.5rem' }}>
                  {tcoBreakEven !== null
                    ? `${formatTokens(Math.round(tcoBreakEven))} tok/mo`
                    : (Number.isFinite(tcoCloudNum) ? 'Cloud wins at any volume' : '—')}
                </div>
                <div className="metric-sub">
                  {tcoBreakEven !== null
                    ? 'above this, the local rig is cheaper than cloud'
                    : (Number.isFinite(tcoCloudNum) ? 'cloud $/Mtok is at or below the electricity cost per Mtok' : 'enter a cloud $/Mtok to compute')}
                </div>
              </div>

              {tcoBreakEven !== null && (
                <div className="metric" style={{ borderLeftColor: 'var(--agent)', textAlign: 'center' }}>
                  <div className="metric-label">Cloud spend at break-even</div>
                  <div className="metric-value" style={{ color: 'var(--agent)' }}>
                    ${(tcoBreakEven / 1e6 * tcoCloudNum).toFixed(0)}/mo
                  </div>
                  <div className="metric-sub">monthly cloud bill the rig must beat</div>
                </div>
              )}
            </div>

            <p className="hint-text" style={{ marginTop: '12px' }}>
              Marginal local cost = (watts ÷ 1000 × $/kWh) ÷ aggregate decode tok/s. The rig draws power whenever it is on,
              so monthly electricity assumes 24/7 load; break-even adds the rig price amortized over the chosen period.
              Idle draw, cooling, and internet are not modeled.
            </p>
          </>
        ) : (
          <p className="hint-text">Enter a positive wattage to compute the local rig's electricity cost per million tokens.</p>
        )}
      </section>

      <EmbedDialog
        open={embedOpen}
        onClose={() => setEmbedOpen(false)}
        getNode={() => chartRef.current}
        title={t('compare.panelTitle')}
        sourceUrl={typeof window !== 'undefined' ? window.location.href : ''}
      />
    </div>
  );
}
