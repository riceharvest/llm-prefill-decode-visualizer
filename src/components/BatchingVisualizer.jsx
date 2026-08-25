import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Layers, Play, Pause, RotateCcw, FileDown, Copy, FileJson } from 'lucide-react';
import { formatTime, formatTokens } from '../utils/presets';
import { readParamNum, writeParams } from '../utils/urlState';
import { generateRequests, simulateBatching, simulateStaticBatching } from '../utils/batchScheduling';
import { clockToRunState, runStateToBusy } from '../utils/viewState';
import MisconceptionCallout, { isMisconceptionDismissed, dismissMisconception } from './MisconceptionCallout';
import Metric from './Metric';
import usePrefersReducedMotion from '../utils/usePrefersReducedMotion';
import { createFrameScheduler, runStateFor } from '../utils/playback';
import { t } from '../i18n/strings';
import { buildDeepLink, downloadMarkdown, copyMarkdownToClipboard } from '../utils/exportMarkdown';
import { downloadJson } from '../utils/exportJson';
import { buildBatchingMarkdown, buildBatchingJson } from '../utils/exportBatching';

// Chunk-size slider stops. 0 = chunked prefill OFF (whole prompt per step).
const CHUNK_STOPS = [0, 128, 256, 512, 1024, 2048, 4096, 8192];

export default function BatchingVisualizer({
  prefillSpeed,
  decodeSpeed,
  simSpeedMultiplier,
  isPlaying,
  setIsPlaying,
  resetKey
}) {
  // --- Workload & scheduler parameters (shareable via URL) ---
  const [numRequests, setNumRequests] = useState(() => readParamNum('breqs', 12));
  const [meanPromptTokens, setMeanPromptTokens] = useState(() => readParamNum('bprompt', 2000));
  const [meanOutputTokens, setMeanOutputTokens] = useState(() => readParamNum('bgen', 256));
  const [maxBatchSize, setMaxBatchSize] = useState(() => readParamNum('bmax', 8));
  const [chunkStopIndex, setChunkStopIndex] = useState(() => {
    const v = readParamNum('bchunk', 512);
    const idx = CHUNK_STOPS.indexOf(v);
    return idx >= 0 ? idx : 5;
  });
  const [arrivalIntervalMs, setArrivalIntervalMs] = useState(() => readParamNum('barr', 150));
  // Workload PRNG seed (issue #692): ?bseed= makes the ±40% length/arrival
  // jitter reproducible and lets agents sample different draws. Same default
  // (42) as generateRequests so existing links render identically.
  const [workloadSeed, setWorkloadSeed] = useState(() =>
    Math.max(0, Math.floor(readParamNum('bseed', 42)))
  );

  const chunkSize = CHUNK_STOPS[chunkStopIndex];
  const chunkingOn = chunkSize > 0;

  useEffect(() => {
    writeParams({
      breqs: numRequests,
      bprompt: meanPromptTokens,
      bgen: meanOutputTokens,
      bmax: maxBatchSize,
      bchunk: chunkSize,
      barr: arrivalIntervalMs,
      bseed: workloadSeed
    });
  }, [numRequests, meanPromptTokens, meanOutputTokens, maxBatchSize, chunkSize, arrivalIntervalMs, workloadSeed]);

  // --- Misconception callout: fires the moment chunked prefill is disabled ---
  const [showChunkCallout, setShowChunkCallout] = useState(false);
  const handleToggleChunking = () => {
    if (!chunkingOn) {
      // Turning ON — nothing to warn about.
    } else if (!isMisconceptionDismissed('chunked-prefill-stall')) {
      setShowChunkCallout(true);
    }
    setChunkStopIndex(chunkingOn ? 0 : 5);
    handleReset();
  };
  const handleDismissCallout = () => {
    dismissMisconception('chunked-prefill-stall');
    setShowChunkCallout(false);
  };

  // --- Deterministic workload + scheduling (pure functions over params) ---
  const requests = useMemo(() => generateRequests({
    numRequests,
    meanPromptTokens,
    meanOutputTokens,
    arrivalIntervalMs,
    seed: workloadSeed
  }), [numRequests, meanPromptTokens, meanOutputTokens, arrivalIntervalMs, workloadSeed]);

  const sim = useMemo(() => simulateBatching({
    requests,
    maxBatchSize,
    chunkSize,
    prefillSpeed,
    decodeSpeed
  }), [requests, maxBatchSize, chunkSize, prefillSpeed, decodeSpeed]);

  const staticSim = useMemo(() => simulateStaticBatching({
    requests,
    maxBatchSize,
    prefillSpeed,
    decodeSpeed
  }), [requests, maxBatchSize, prefillSpeed, decodeSpeed]);

  const { steps, summary, makespan } = sim;

  // Per-request timeline segments for the Gantt rows: queue → prefill chunks →
  // decode runs. Contiguous decode steps merge into one segment so a clean
  // run of decoding renders as a single block while interleaved prefill
  // chunks slice it apart.
  const rowSegments = useMemo(() => {
    const byId = new Map(requests.map(r => [r.id, []]));
    for (const step of steps) {
      if (step.prefill && !Array.isArray(step.prefill.id)) {
        byId.get(step.prefill.id)?.push({
          tStart: step.tStart, tEnd: step.tEnd, kind: 'prefill', tokens: step.prefill.tokens
        });
      }
      for (const id of step.decoded) {
        const segs = byId.get(id);
        const last = segs[segs.length - 1];
        if (last && last.kind === 'decode' && Math.abs(last.tEnd - step.tStart) < 1e-9) {
          last.tEnd = step.tEnd;
        } else {
          segs.push({ tStart: step.tStart, tEnd: step.tEnd, kind: 'decode' });
        }
      }
    }
    return byId;
  }, [steps, requests]);

  // --- Playback: rAF clock over the simulated makespan (same pattern as the
  // agentic visualizer). elapsedSim positions the playhead on every chart.
  // Ticks run through the shared frame scheduler (#860): while the tab is
  // hidden the scheduler drives them from a wall-clock timer so playback
  // advances instead of freezing at the first frame. ---
  const [elapsedSim, setElapsedSim] = useState(0);
  const framesRef = useRef(null);
  if (!framesRef.current) framesRef.current = createFrameScheduler();
  useEffect(() => () => framesRef.current?.dispose(), []);
  const animFrameRef = useRef(null);
  const lastTickRef = useRef(null);
  const simTimeRef = useRef(0);

  const resetKeyRef = useRef(resetKey);
  useEffect(() => {
    if (resetKeyRef.current !== resetKey) {
      resetKeyRef.current = resetKey;
      handleReset();
    }
  }, [resetKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleReset = () => {
    setIsPlaying(false);
    setElapsedSim(0);
    simTimeRef.current = 0;
  };

  const prefersReducedMotion = usePrefersReducedMotion();

  // Auto-start the simulation when the page was opened via a "try it" demo
  // link (#861: batching previously ignored ?autoplay=1 entirely).
  useEffect(() => {
    if (readParam('autoplay') === '1') {
      const timer = setTimeout(() => setIsPlaying(true), 250);
      return () => clearTimeout(timer);
    }
  }, [setIsPlaying]);

  useEffect(() => {
    if (!isPlaying) {
      if (animFrameRef.current) framesRef.current.cancel(animFrameRef.current);
      lastTickRef.current = null;
      return;
    }
    if (simTimeRef.current >= makespan) simTimeRef.current = 0; // replay from start

    const tick = (now) => {
      if (!lastTickRef.current) {
        lastTickRef.current = now;
        animFrameRef.current = framesRef.current.request(tick);
        return;
      }
      const realDelta = (now - lastTickRef.current) / 1000;
      lastTickRef.current = now;

      // Instant mode — or prefers-reduced-motion (issue #63): jump straight
      // to the final schedule instead of animating the playhead across it.
      if (simSpeedMultiplier === 'instant' || prefersReducedMotion || !Number.isFinite(makespan) || makespan <= 0) {
        setElapsedSim(makespan);
        setIsPlaying(false);
        return;
      }

      simTimeRef.current += realDelta * simSpeedMultiplier;
      if (simTimeRef.current >= makespan) {
        setElapsedSim(makespan);
        setIsPlaying(false);
        return;
      }
      setElapsedSim(simTimeRef.current);
      animFrameRef.current = framesRef.current.request(tick);
    };

    animFrameRef.current = framesRef.current.request(tick);
    return () => {
      if (animFrameRef.current) framesRef.current.cancel(animFrameRef.current);
    };
  }, [isPlaying, simSpeedMultiplier, prefersReducedMotion, makespan, setIsPlaying]);

  // Current engine step index at the playhead (binary search over steps).
  const currentStepIndex = useMemo(() => {
    if (!steps.length || elapsedSim <= 0) return -1;
    let lo = 0, hi = steps.length - 1, ans = steps.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (steps[mid].tEnd > elapsedSim) { ans = mid; hi = mid - 1; }
      else lo = mid + 1;
    }
    return ans;
  }, [steps, elapsedSim]);
  const currentStep = currentStepIndex >= 0 ? steps[currentStepIndex] : null;

  // Running batch composition at the playhead.
  const runningIds = useMemo(() => {
    if (!currentStep) return [];
    return currentStep.decoded
      .concat(currentStep.admitted)
      .filter((id, i, arr) => arr.indexOf(id) === i);
  }, [currentStep]);

  // Cumulative per-request decode-token counts indexed by step, precomputed in
  // one pass so the playhead readout never rescans the whole step list.
  const decodedCountsByStep = useMemo(() => {
    const counts = new Map(); // id -> Int32Array(steps.length)
    for (const req of sim.requests) counts.set(req.id, new Int32Array(steps.length));
    const totals = new Map();
    for (let i = 0; i < steps.length; i++) {
      for (const id of steps[i].decoded) {
        totals.set(id, (totals.get(id) || 0) + 1);
      }
      // Snapshot each active id's cumulative count at this step index.
      for (const [id, arr] of counts) {
        if (totals.has(id)) arr[i] = totals.get(id);
        else if (i > 0) arr[i] = arr[i - 1];
      }
    }
    return counts;
  }, [steps, sim.requests]);

  const runningProgress = useMemo(() => {
    const map = new Map();
    if (currentStep && currentStepIndex >= 0) {
      for (const id of runningIds) {
        map.set(id, decodedCountsByStep.get(id)?.[currentStepIndex] || 0);
      }
    }
    return map;
  }, [runningIds, decodedCountsByStep, currentStepIndex, currentStep]);

  const [selectedRequestId, setSelectedRequestId] = useState(null);
  const selectedRequest = useMemo(
    () => sim.requests.find(r => r.id === selectedRequestId) || sim.requests[0],
    [sim.requests, selectedRequestId]
  );
  const maxITL = selectedRequest?.itls.length ? Math.max(...selectedRequest.itls) : 0;

  // Batch occupancy strip: one thin bar per engine step (bucket-sampled when
  // there are too many steps to render individually).
  const occupancyBars = useMemo(() => {
    const MAX_BARS = 400;
    if (steps.length <= MAX_BARS) return steps.map(s => s.batchSize);
    const bucketSize = Math.ceil(steps.length / MAX_BARS);
    const bars = [];
    for (let i = 0; i < steps.length; i += bucketSize) {
      let sum = 0;
      for (let j = i; j < Math.min(i + bucketSize, steps.length); j++) sum += steps[j].batchSize;
      bars.push(sum / Math.min(bucketSize, steps.length - i));
    }
    return bars;
  }, [steps]);

  const timePct = (tSec) => (makespan > 0 ? Math.min(100, (tSec / makespan) * 100) : 0);

  const statusText = !currentStep
    ? t('batching.statusIdle')
    : elapsedSim >= makespan
      ? t('batching.statusDone')
      : t('batching.statusRunning', { step: currentStepIndex + 1, count: currentStep.batchSize });

  const continuousSaving = staticSim.makespan - makespan;
  const continuousSavingPct = staticSim.makespan > 0 ? (continuousSaving / staticSim.makespan) * 100 : 0;

  // Issue #398: machine-readable artifact of the batch run — same Export MD /
  // Export JSON / Copy MD affordances the single-turn view ships.
  const [exportCopied, setExportCopied] = useState(false);
  const [exportCopyFailed, setExportCopyFailed] = useState(false);
  const batchingExportArgs = () => ({
    numRequests,
    meanPromptTokens,
    meanOutputTokens,
    maxBatchSize,
    chunkSize,
    arrivalIntervalMs,
    prefillSpeed,
    decodeSpeed,
    summary,
    staticSummary: staticSim.summary,
    requests: sim.requests,
    deepLink: buildDeepLink('batching')
  });
  const handleExportMd = () => downloadMarkdown(buildBatchingMarkdown(batchingExportArgs()), 'batching-simulation.md');
  const handleExportJson = () => downloadJson(buildBatchingJson(batchingExportArgs()), 'batching-simulation.json');
  const handleCopyMd = async () => {
    const ok = await copyMarkdownToClipboard(buildBatchingMarkdown(batchingExportArgs()));
    // Issue #401 parity: never claim success over a failed clipboard write.
    setExportCopied(ok);
    setExportCopyFailed(!ok);
    setTimeout(() => { setExportCopied(false); setExportCopyFailed(false); }, 2000);
  };

  // Screen-reader run summary (issue #63): aria-live narration of the batch
  // playhead, bucket-rounded to 25% of the makespan so the rAF loop produces
  // a few announcements per run instead of one per frame.
  const srFinishedCount = requests.filter(
    r => r.finishTime !== null && r.finishTime <= elapsedSim
  ).length;
  const srElapsedBucket = Math.min(4, Math.floor((elapsedSim / Math.max(1e-9, makespan)) * 4));
  const srSummary = elapsedSim <= 0
    ? 'Batching simulation idle. Set the workload and press Start.'
    : elapsedSim >= makespan
      ? `Batch complete in ${formatTime(makespan)}: ${numRequests} requests finished, ${formatTokens(summary.totalOutputTokens)} output tokens generated.`
      : `${srFinishedCount} of ${numRequests} requests finished, ${runningIds.length} currently running. About ${srElapsedBucket * 25} percent of the ${formatTime(makespan)} schedule elapsed.`;

  return (
    <div
      className="stack"
      data-state={runStateFor({
        isPlaying,
        hasStarted: elapsedSim > 0,
        hasFinished: makespan > 0 && elapsedSim >= makespan
      })}
      aria-busy={isPlaying || undefined}
    >

      {/* Issue #63: live narration of the animated playhead for screen readers */}
      <div className="visually-hidden" role="status" aria-live="polite">{srSummary}</div>

      {/* Top Configuration Card */}
      <section className="panel" aria-label={t('batching.paramsPanelAria')}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px', marginBottom: '14px' }}>
          <h2 className="panel-title" tabIndex={-1} data-panel-heading>
            <Layers size={16} style={{ color: 'var(--agent)' }} />
            <span>{t('batching.paramsPanelTitle')}</span>
          </h2>

          {/* Chunked prefill toggle */}
          <button
            onClick={handleToggleChunking}
            className="btn"
            aria-pressed={chunkingOn}
            style={chunkingOn
              ? { borderColor: 'var(--decode-border)', color: 'var(--decode)', background: 'var(--decode-dim)' }
              : undefined}
          >
            <span>{t('batching.chunkedPrefill')}: <strong>
              {chunkingOn ? t('batching.chunkOn', { size: formatTokens(chunkSize) }) : t('batching.chunkOff')}
            </strong></span>
          </button>
        </div>

        <div className="grid-auto" style={{ '--grid-min': '15rem' }}>

          {/* Concurrent Requests (#397: slider+number share one field label) */}
          <div className="panel-inset field">
            <div className="field-head">
              <span className="field-label" id="batching-label-requests">{t('batching.concurrentRequests')}</span>
              <span className="field-value" style={{ color: 'var(--agent)' }}>{numRequests} {t('batching.requestsUnit')}</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <input type="range" min="2" max="48" step="1" value={numRequests}
                aria-labelledby="batching-label-requests"
                aria-valuetext={`${numRequests} concurrent ${numRequests === 1 ? 'request' : 'requests'}`}
                onChange={(e) => { setNumRequests(Number(e.target.value)); handleReset(); }}
                style={{ flex: 1 }} />
              <input type="number" value={numRequests}
                aria-labelledby="batching-label-requests"
                onChange={(e) => { setNumRequests(Number(e.target.value)); handleReset(); }}
                style={{ width: '4rem' }} />
            </div>
          </div>

          {/* Mean Prompt Tokens */}
          <div className="panel-inset field">
            <div className="field-head">
              <span className="field-label" id="batching-label-prompt">{t('batching.meanPrompt')}</span>
              <span className="field-value" style={{ color: 'var(--prefill)' }}>{formatTokens(meanPromptTokens)} tok</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              {/* #397: step 8 (was 128) so URL/default values like bprompt=2000
                  are exactly representable — with step=128 the browser clamped
                  the DOM .value to 2048 while state said 2000, so scrapers read
                  a stale number. aria-valuenow pins the true state regardless. */}
              <input type="range" min="128" max="32768" step="8" value={meanPromptTokens}
                aria-labelledby="batching-label-prompt"
                aria-valuenow={meanPromptTokens}
                aria-valuetext={`${meanPromptTokens.toLocaleString()} tokens`}
                onChange={(e) => { setMeanPromptTokens(Number(e.target.value)); handleReset(); }}
                style={{ flex: 1 }} />
              <input type="number" value={meanPromptTokens}
                aria-labelledby="batching-label-prompt"
                onChange={(e) => { setMeanPromptTokens(Number(e.target.value)); handleReset(); }}
                style={{ width: '5rem' }} />
            </div>
          </div>

          {/* Mean Output Tokens */}
          <div className="panel-inset field">
            <div className="field-head">
              <span className="field-label" id="batching-label-output">{t('batching.meanOutput')}</span>
              <span className="field-value" style={{ color: 'var(--decode)' }}>{formatTokens(meanOutputTokens)} tok</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <input type="range" min="32" max="4096" step="32" value={meanOutputTokens}
                aria-labelledby="batching-label-output"
                aria-valuenow={meanOutputTokens}
                aria-valuetext={`${meanOutputTokens.toLocaleString()} tokens`}
                onChange={(e) => { setMeanOutputTokens(Number(e.target.value)); handleReset(); }}
                style={{ flex: 1 }} />
              <input type="number" value={meanOutputTokens}
                aria-labelledby="batching-label-output"
                onChange={(e) => { setMeanOutputTokens(Number(e.target.value)); handleReset(); }}
                style={{ width: '5rem' }} />
            </div>
          </div>

          {/* Max Batch Size */}
          <div className="panel-inset field">
            <div className="field-head">
              <span className="field-label" id="batching-label-maxbatch">{t('batching.maxBatch')}</span>
              <span className="field-value" style={{ color: 'var(--agent)' }}>{maxBatchSize} {t('batching.maxBatchUnit')}</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <input type="range" min="1" max="32" step="1" value={maxBatchSize}
                aria-labelledby="batching-label-maxbatch"
                aria-valuetext={`batch size ${maxBatchSize}`}
                onChange={(e) => { setMaxBatchSize(Number(e.target.value)); handleReset(); }}
                style={{ flex: 1 }} />
              <input type="number" value={maxBatchSize}
                aria-labelledby="batching-label-maxbatch"
                onChange={(e) => { setMaxBatchSize(Number(e.target.value)); handleReset(); }}
                style={{ width: '4rem' }} />
            </div>
          </div>

          {/* Chunk size slider */}
          <div className="panel-inset field">
            <div className="field-head">
              <span className="field-label" id="batching-label-chunk">{t('batching.chunkedPrefill')}</span>
              <span className="field-value" style={{ color: chunkingOn ? 'var(--decode)' : 'var(--text-muted)' }}>
                {chunkingOn ? `${formatTokens(chunkSize)} tok` : 'OFF'}
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <input type="range" min="0" max={CHUNK_STOPS.length - 1} step="1" value={chunkStopIndex}
                aria-labelledby="batching-label-chunk"
                aria-valuenow={chunkStopIndex}
                aria-valuetext={chunkSize === 0
                  ? 'chunked prefill off'
                  : `${formatTokens(chunkSize)} tokens per prefill chunk`}
                onChange={(e) => { setChunkStopIndex(Number(e.target.value)); handleReset(); }}
                style={{ flex: 1 }} />
              <span style={{
                fontFamily: 'var(--font-mono)', fontSize: '0.68rem', color: 'var(--text-subtle)',
                whiteSpace: 'nowrap'
              }}>
                0=off · 8k=max
              </span>
            </div>
            <p className="hint-text" style={{ fontSize: '0.68rem', marginTop: '6px', marginBottom: 0 }}>
              {t('batching.chunkHint')}
            </p>
          </div>

          {/* Arrival Interval */}
          <div className="panel-inset field">
            <div className="field-head">
              <span className="field-label" id="batching-label-arrival">{t('batching.arrivalInterval')}</span>
              <span className="field-value">{arrivalIntervalMs} {t('batching.arrivalUnit')}</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <input type="range" min="0" max="2000" step="10" value={arrivalIntervalMs}
                aria-labelledby="batching-label-arrival"
                aria-valuenow={arrivalIntervalMs}
                aria-valuetext={`${arrivalIntervalMs} milliseconds between arrivals`}
                onChange={(e) => { setArrivalIntervalMs(Number(e.target.value)); handleReset(); }}
                style={{ flex: 1 }} />
              <input type="number" value={arrivalIntervalMs}
                aria-labelledby="batching-label-arrival"
                onChange={(e) => { setArrivalIntervalMs(Number(e.target.value)); handleReset(); }}
                style={{ width: '4rem' }} />
            </div>
          </div>

          {/* Workload Seed (issue #692) */}
          <div className="panel-inset field">
            <div className="field-head">
              <span className="field-label">Workload seed</span>
              <span className="field-value">#{workloadSeed}</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <input type="number" min="0" step="1" value={workloadSeed}
                aria-label="Workload random seed"
                aria-valuetext={`seed ${workloadSeed}`}
                onChange={(e) => {
                  const v = Math.max(0, Math.floor(Number(e.target.value) || 0));
                  setWorkloadSeed(v);
                  handleReset();
                }}
                style={{ flex: 1 }} />
              <button type="button" className="btn" style={{ padding: '4px 10px', fontSize: '0.72rem' }}
                aria-label="Re-roll workload seed"
                onClick={() => { setWorkloadSeed(Math.floor(Math.random() * 0x100000000)); handleReset(); }}>
                Re-roll
              </button>
            </div>
            <p className="hint-text" style={{ fontSize: '0.68rem', marginTop: '6px', marginBottom: 0 }}>
              URL param ?bseed= — same seed, same ±40% length/arrival jitter.
            </p>
          </div>

        </div>
      </section>

      {/* Misconception callout */}
      {showChunkCallout && (
        <MisconceptionCallout
          id="chunked-prefill-stall"
          onDismiss={handleDismissCallout}
        />
      )}

      {/* Main Batch Simulation Stage */}
      <section
        className="panel"
        aria-label={t('batching.simStageAria')}
        data-state={clockToRunState(elapsedSim, makespan)}
        aria-busy={runStateToBusy(clockToRunState(elapsedSim, makespan))}
      >

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '18px', flexWrap: 'wrap', gap: '12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span className="tag tag-agent" style={{ fontSize: '0.72rem', padding: '3px 9px' }}>
              {t('batching.continuousBatchingTag')}
            </span>
            <span className="hint-text" style={{ fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums' }}>
              {statusText}
            </span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <button
              onClick={() => setIsPlaying(!isPlaying)}
              className={`btn ${isPlaying ? 'btn-warn' : 'btn-accent'}`}
            >
              {isPlaying ? <Pause size={15} /> : <Play size={15} />}
              {isPlaying ? t('common.pause') : t('batching.simulateTag')}
            </button>

            <button
              onClick={handleReset}
              type="button"
              title={t('speedControls.resetTooltip')}
              aria-label={`${t('batching.resetTag')} — ${t('speedControls.resetTooltip')}`}
              className="btn"
            >
              <RotateCcw size={15} />
              {t('batching.resetTag')}
            </button>

            {/* Issue #398: export/copy the batch run as a scrapeable artifact */}
            <button onClick={handleExportMd} className="btn" title="Export this batch run as a markdown walkthrough (download)">
              <FileDown size={15} />
              Export MD
            </button>
            <button onClick={handleExportJson} className="btn" title="Export this batch run as machine-readable JSON (download)">
              <FileJson size={15} />
              Export JSON
            </button>
            <button
              onClick={handleCopyMd}
              className="btn"
              title="Copy the markdown walkthrough to the clipboard"
              aria-label="Copy batching walkthrough to clipboard"
            >
              <Copy size={15} />
              {exportCopied ? 'Copied!' : exportCopyFailed ? 'Copy failed' : 'Copy MD'}
            </button>
          </div>
        </div>

        {/* Continuous vs static batching banner */}
        {!chunkingOn ? (
          <div
            className="panel-inset"
            style={{
              borderColor: 'var(--agent-border)',
              background: 'var(--agent-dim)',
              marginBottom: '18px',
              fontSize: '0.82rem',
              color: 'var(--agent)'
            }}
          >
            <strong>{t('batching.chunkOffPrefix')}</strong> {t('batching.chunkOffBody')}
          </div>
        ) : (
          <div
            className="panel-inset"
            style={{
              borderColor: 'var(--decode-border)',
              background: 'var(--decode-dim)',
              marginBottom: '18px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '10px',
              flexWrap: 'wrap',
              fontSize: '0.82rem',
              color: 'var(--decode)'
            }}
          >
            <span>
              <strong>{t('batching.staticBannerPrefix')}</strong> {t('batching.staticBannerBody', {
                without: formatTime(staticSim.makespan),
                with: formatTime(makespan)
              })}
            </span>
            <span className="tag tag-decode">
              {t('batching.staticSavedTag', {
                time: formatTime(continuousSaving),
                pct: Math.max(0, continuousSavingPct).toFixed(0)
              })}
            </span>
          </div>
        )}

        {/* Headline metrics */}
        <div className="grid-auto" style={{ '--grid-min': '10.625rem', marginBottom: '20px' }}>
          <Metric term="batchMakespan" substitution={`${numRequests} requests · max batch ${maxBatchSize}`}>
            <strong style={{ color: 'var(--text-main)', fontSize: '1rem' }}>{formatTime(makespan)}</strong>
            <div className="metric-sub">{t('batching.metricMakespanSub')}</div>
          </Metric>
          <Metric term="batchAvgTtft" substitution={`arrivals staggered ${arrivalIntervalMs} ms apart`}>
            <strong style={{ color: 'var(--prefill)', fontSize: '1rem' }}>{formatTime(summary.avgTTFT)}</strong>
            <div className="metric-sub">{t('batching.metricAvgTtftSub')}</div>
          </Metric>
          <Metric term="batchWorstItl" substitution={`decode step = ${formatTime(1 / decodeSpeed)} · prefill chunk ≤ ${chunkingOn ? formatTokens(chunkSize) + ' tok' : '∞'}`}>
            <strong style={{ color: summary.maxITL > 2 / decodeSpeed ? 'var(--warn)' : 'var(--decode)', fontSize: '1rem' }}>
              {formatTime(summary.maxITL)}
            </strong>
            <div className="metric-sub">{t('batching.metricMaxItlSub')}</div>
          </Metric>
          <Metric term="batchThroughput" substitution={`${formatTokens(summary.totalOutputTokens)} output tok ÷ ${formatTime(makespan)}`}>
            <strong style={{ color: 'var(--agent)', fontSize: '1rem' }}>{summary.throughput.toFixed(1)} tok/s</strong>
            <div className="metric-sub">{t('batching.metricThroughputSub', { tokens: formatTokens(summary.totalOutputTokens) })}</div>
          </Metric>
          <Metric term="batchOccupancy" substitution={`avg running seqs ÷ ${maxBatchSize} slots`}>
            <strong style={{ color: 'var(--text-main)', fontSize: '1rem' }}>{summary.occupancyPct.toFixed(0)}%</strong>
            <div className="metric-sub">{t('batching.metricOccupancySub', { max: maxBatchSize })}</div>
          </Metric>
        </div>

        {/* Batch timeline Gantt: one row per request, x-axis = walltime */}
        <div className="panel-inset" style={{ marginBottom: '20px' }}>
          <div className="field-head" style={{ marginBottom: '14px', flexWrap: 'wrap' }}>
            <span className="section-label">{t('batching.timelineLabel')}</span>
            <div style={{ display: 'flex', gap: '14px', fontSize: '0.72rem', fontWeight: 600, alignItems: 'center' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: '5px', color: 'var(--text-muted)' }}>
                <span style={{ width: '10px', height: '10px', background: 'var(--bg-raised)', border: '1px dashed var(--border)', borderRadius: '2px' }} /> {t('batching.legendQueue')}
              </span>
              <span style={{ display: 'flex', alignItems: 'center', gap: '5px', color: 'var(--prefill)' }}>
                <span style={{ width: '10px', height: '10px', background: 'var(--prefill)', borderRadius: '2px' }} /> {t('batching.legendPrefill')}
              </span>
              <span style={{ display: 'flex', alignItems: 'center', gap: '5px', color: 'var(--decode)' }}>
                <span style={{ width: '10px', height: '10px', background: 'var(--decode)', borderRadius: '2px' }} /> {t('batching.legendDecode')}
              </span>
              <span style={{ fontSize: '0.66rem', color: 'var(--text-subtle)' }}>{t('batching.selectRequestHint')}</span>
            </div>
          </div>

          <div className="waterfall-rows">
            {sim.requests.map(req => {
              const isSelected = selectedRequest?.id === req.id;
              const isActiveRow = currentStep && elapsedSim < makespan &&
                req.arrivalTime <= elapsedSim && (req.finishTime === null || req.finishTime > elapsedSim);
              return (
                <div
                  key={req.id}
                  onClick={() => setSelectedRequestId(isSelected ? null : req.id)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '12px',
                    padding: '6px 10px',
                    borderRadius: 'var(--radius-md)',
                    background: isActiveRow ? 'var(--agent-dim)' : 'var(--bg-panel)',
                    border: `1px solid ${isSelected ? 'var(--agent-border)' : 'var(--border)'}`,
                    cursor: 'pointer',
                    transition: 'background 0.15s ease, border-color 0.15s ease'
                  }}
                >
                  <div style={{ width: '4.75rem', flexShrink: 0 }}>
                    <div style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-main)', fontFamily: 'var(--font-mono)' }}>
                      R{req.id}
                    </div>
                    <div style={{ fontSize: '0.64rem', color: 'var(--text-subtle)', whiteSpace: 'nowrap' }}>
                      {formatTokens(req.promptTokens)}→{formatTokens(req.outputTokens)}
                    </div>
                  </div>

                  <div style={{ flex: 1, height: '20px', background: 'var(--bg-raised)', borderRadius: 'var(--radius-sm)', position: 'relative', overflow: 'hidden', minWidth: 0 }}>
                    {/* Queue wait: arrival → first prefill segment */}
                    {rowSegments.get(req.id)?.length > 0 && (
                      <div
                        style={{
                          left: `${timePct(req.arrivalTime)}%`,
                          width: `${Math.max(0, timePct(rowSegments.get(req.id)[0].tStart) - timePct(req.arrivalTime))}%`,
                          top: 0, bottom: 0, position: 'absolute',
                          borderRight: '1px dashed var(--border)',
                          background: 'repeating-linear-gradient(45deg, transparent, transparent 4px, var(--bg-panel) 4px, var(--bg-panel) 8px)'
                        }}
                        data-tooltip={t('batching.rowTooltipQueue', { id: req.id, time: formatTime(rowSegments.get(req.id)[0].tStart - req.arrivalTime) })}
                      />
                    )}
                    {/* Prefill chunks + decode runs */}
                    {rowSegments.get(req.id)?.map((seg, i) => (
                      <div
                        key={i}
                        style={{
                          left: `${timePct(seg.tStart)}%`,
                          width: `${Math.max(0.15, timePct(seg.tEnd) - timePct(seg.tStart))}%`,
                          top: 0, bottom: 0, position: 'absolute',
                          background: seg.kind === 'prefill' ? 'var(--prefill)' : 'var(--decode)',
                          opacity: seg.kind === 'prefill' ? 1 : 0.85
                        }}
                        data-tooltip={seg.kind === 'prefill'
                          ? t('batching.rowTooltipPrefill', { id: req.id, tokens: seg.tokens })
                          : t('batching.rowTooltipDecode', { id: req.id })}
                      />
                    ))}
                  </div>

                  <div style={{ width: '5.375rem', textAlign: 'end', flexShrink: 0 }}>
                    <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-main)', fontVariantNumeric: 'tabular-nums' }}>
                      {Number.isFinite(req.ttft) ? formatTime(req.ttft) : '—'}
                    </div>
                    <div style={{ fontSize: '0.62rem', color: 'var(--text-subtle)' }}>TTFT</div>
                  </div>
                </div>
              );
            })}

            {/* Playhead across all rows */}
            {elapsedSim > 0 && (
              <div style={{ position: 'relative', height: 0 }}>
                <div style={{
                  position: 'absolute',
                  left: `calc(88px + (100% - 186px) * ${timePct(elapsedSim) / 100})`,
                  top: '-100%',
                  height: '200%',
                  width: '2px',
                  background: 'var(--agent)',
                  pointerEvents: 'none'
                }} />
              </div>
            )}
          </div>

          {/* Time axis labels */}
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '6px', paddingLeft: '88px', paddingRight: '98px', fontFamily: 'var(--font-mono)', fontSize: '0.62rem', color: 'var(--text-subtle)' }}>
            <span>0</span>
            <span>{formatTime(elapsedSim)} / {formatTime(makespan)}</span>
            <span>{formatTime(makespan)}</span>
          </div>
        </div>

        {/* Batch occupancy strip */}
        <div className="panel-inset" style={{ marginBottom: '20px' }}>
          <div className="field-head" style={{ marginBottom: '8px' }}>
            <span className="section-label">{t('batching.occupancyLabel')}</span>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', color: 'var(--agent)' }}>
              max {maxBatchSize}
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: '1px', height: '44px' }}>
            {occupancyBars.map((size, i) => (
              <div
                key={i}
                style={{
                  flex: 1,
                  minWidth: 0,
                  height: `${maxBatchSize > 0 ? Math.max(3, (size / maxBatchSize) * 100) : 0}%`,
                  background: 'var(--agent)',
                  opacity: 0.85,
                  borderRadius: '1px'
                }}
                title={`${size.toFixed(1)} seqs`}
              />
            ))}
          </div>
        </div>

        {/* ITL chart for the selected request */}
        {selectedRequest && selectedRequest.itls.length > 0 && (
          <div className="panel-inset">
            <div className="field-head" style={{ marginBottom: '4px', flexWrap: 'wrap' }}>
              <span className="section-label">{t('batching.itlLabel', { id: selectedRequest.id })}</span>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                avg {formatTime(selectedRequest.itls.reduce((a, b) => a + b, 0) / selectedRequest.itls.length)} · worst {formatTime(maxITL)}
              </span>
            </div>
            <p className="hint-text" style={{ fontSize: '0.68rem', margin: '0 0 10px' }}>
              {t('batching.itlSub')}
            </p>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: '1px', height: '56px' }}>
              {selectedRequest.itls.map((itl, i) => {
                const spike = itl > (1 / decodeSpeed) * 1.5;
                return (
                  <div
                    key={i}
                    style={{
                      flex: 1,
                      minWidth: 0,
                      height: `${maxITL > 0 ? Math.max(3, (itl / maxITL) * 100) : 0}%`,
                      background: spike ? 'var(--prefill)' : 'var(--decode)',
                      borderRadius: '1px'
                    }}
                    title={`+${formatTime(itl)}${spike ? ' · prefill in step' : ''}`}
                  />
                );
              })}
            </div>
          </div>
        )}

        {/* Running batch composition at the playhead */}
        {currentStep && elapsedSim < makespan && runningIds.length > 0 && (
          <div className="panel-inset" style={{ marginTop: '20px' }}>
            <div className="field-head" style={{ marginBottom: '10px' }}>
              <span className="section-label">
                {t('batching.currentBatchLabel', { step: currentStepIndex + 1 })}
              </span>
              <span className="tag tag-agent">
                {currentStep.batchSize} / {maxBatchSize}
              </span>
            </div>
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              {runningIds.map(id => {
                const done = runningProgress.get(id) || 0;
                const req = sim.requests.find(r => r.id === id);
                const pctDone = req && req.outputTokens > 0 ? Math.min(100, (done / req.outputTokens) * 100) : 0;
                return (
                  <div
                    key={id}
                    className="panel-inset"
                    style={{
                      padding: '6px 10px',
                      minWidth: '8.125rem',
                      borderColor: done === 0 ? 'var(--prefill-border)' : 'var(--decode-border)'
                    }}
                  >
                    <div className="field-head" style={{ marginBottom: '4px' }}>
                      <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: '0.74rem' }}>R{id}</span>
                      <span style={{ fontSize: '0.64rem', color: 'var(--text-muted)' }}>
                        {done === 0
                          ? t('batching.legendPrefill')
                          : t('batching.seqProgress', { done, total: req?.outputTokens ?? '?' })}
                      </span>
                    </div>
                    <div className="progress-track" style={{ height: '4px' }}>
                      <div className="progress-fill" style={{ width: `${done === 0 ? 100 : pctDone}%`, background: done === 0 ? 'var(--prefill)' : 'var(--decode)' }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

      </section>

    </div>
  );
}
