import React, { useCallback, useMemo, useState, useEffect, useRef } from 'react';
import Header from './components/Header';
import LocalMaxxingPresetPicker from './components/LocalMaxxingPresetPicker';
import EngineFlagPicker from './components/EngineFlagPicker';
import SpeedControls from './components/SpeedControls';
import SingleTurnVisualizer from './components/SingleTurnVisualizer';
import AgenticVisualizer from './components/AgenticVisualizer';
import BatchingVisualizer from './components/BatchingVisualizer';
import HardwareComparison from './components/HardwareComparison';
import ABReplay from './components/ABReplay';
import RunDiff from './components/RunDiff';
import HardwareShortlist from './components/HardwareShortlist';
import KVCacheCalculator from './components/KVCacheCalculator';
import TheoryGuide from './components/TheoryGuide';
import CurriculumMode from './components/CurriculumMode';
import SloBudgetsPanel, { useSloBudgets } from './components/SloBudgetsPanel';
import GuidedTour, { hasSeenTour } from './components/GuidedTour';
import { HARDWARE_PRESETS } from './utils/presets';
import { toLocalPreset } from './utils/localMaxxing';
import { readParam, writeParams } from './utils/urlState';
import {
  serializeSettings, parseSettings,
  createHistory, recordChange, undo as historyUndo, redo as historyRedo
} from './utils/settingsHistory';
import SnapshotsSidebar from './components/SnapshotsSidebar';
import { useFocusPanelHeading } from './utils/focus';
import { setLocale, getLocale, getDirection, t } from './i18n/strings';
import { installTouchTooltips } from './utils/touchTooltips';

export default function App() {
  const [activeTab, setActiveTab] = useState(() => readParam('tab') || 'single');

  // First-run guided tour: shown once, skippable, re-launchable from the header '?' button.
  const [tourOpen, setTourOpen] = useState(() => !hasSeenTour());

  // Locale + touch tooltips: one-time setup. `?lang=` overrides the default
  // locale; direction is applied to <html> so RTL locales flip the layout.
  useEffect(() => {
    const lang = readParam('lang');
    if (lang) setLocale(lang);
    document.documentElement.lang = getLocale();
    document.documentElement.dir = getDirection();
    installTouchTooltips();
  }, []);
  // Preset from the URL drives both the dropdown label AND the default speeds,
  // unless explicit prefill/decode params override them.
  const initialPreset = (() => {
    const p = readParam('preset');
    if (p?.startsWith('lmx:')) return p;
    return HARDWARE_PRESETS.find(x => x.id === p) ? p : 'rtx4090_exl2';
  })();
  const initialPresetObj = HARDWARE_PRESETS.find(x => x.id === initialPreset) || HARDWARE_PRESETS[0];
  const [selectedPreset, setSelectedPreset] = useState(initialPreset);
  const [prefillSpeed, setPrefillSpeed] = useState(() => Number(readParam('prefill')) || initialPresetObj.prefillSpeed);
  const [decodeSpeed, setDecodeSpeed] = useState(() => Number(readParam('decode')) || initialPresetObj.decodeSpeed);
  const [simSpeedMultiplier, setSimSpeedMultiplier] = useState(() => {
    const v = readParam('sim');
    return v === 'instant' ? 'instant' : (Number(v) || 1);
  });
  const [isPlaying, setIsPlaying] = useState(false);
  // Engine flags (issue #70): comma-separated ids persisted in the URL. The
  // picker shows their documented deltas; "Apply to simulation" bakes the
  // composed speeds into prefill/decode and clears the selection so toggling
  // again never double-applies on top of already-adjusted speeds.
  const [selectedFlags, setSelectedFlags] = useState(() => {
    const raw = readParam('flags');
    return raw ? raw.split(',').filter(Boolean) : [];
  });
  // Incremented by the global Reset button; visualizers watch it and clear
  // ALL sim state (phase, token progress, streams, elapsed time).
  const [resetKey, setResetKey] = useState(0);

  // SLO budgets (issue #64): user-defined TTFT/TPOT/walltime targets persisted
  // in localStorage, checked against every simulation via pass/fail badges.
  const [sloBudgets, setSloBudgets] = useSloBudgets();
  const [localMaxxingContext, setLocalMaxxingContext] = useState({
    modelId: '',
    quantization: '',
    runs: [],
    selectedRunId: ''
  });

  const comparisonPresets = useMemo(() => [
    ...localMaxxingContext.runs.map(toLocalPreset),
    ...HARDWARE_PRESETS
  ], [localMaxxingContext.runs]);

  // Settings history + named snapshots (#96). Every change to the shareable
  // settings (preset, prefill, decode, sim multiplier, engine flags) is
  // recorded on an undo stack; snapshots are explicit named restore points
  // serialized to the same URL query format the share button uses.
  const [settingsHistory, setSettingsHistory] = useState(createHistory);
  const currentQs = useMemo(() => serializeSettings({
    preset: selectedPreset,
    prefill: prefillSpeed,
    decode: decodeSpeed,
    sim: simSpeedMultiplier,
    flags: selectedFlags
  }), [selectedPreset, prefillSpeed, decodeSpeed, simSpeedMultiplier, selectedFlags]);
  // Last state the history stack knows about; null until the first effect run.
  const lastCommittedQsRef = useRef(null);
  // Set while undo/redo/snapshot-restore is applying values so the recording
  // effect treats the resulting state as the new baseline instead of pushing.
  const applyingFromHistoryRef = useRef(false);

  // Record every out-of-history settings transition (batched updates collapse
  // into a single entry because the effect runs once per committed render).
  useEffect(() => {
    if (lastCommittedQsRef.current === null) {
      lastCommittedQsRef.current = currentQs;
      return;
    }
    if (applyingFromHistoryRef.current) {
      applyingFromHistoryRef.current = false;
      lastCommittedQsRef.current = currentQs;
      return;
    }
    if (currentQs === lastCommittedQsRef.current) return;
    const previousQs = lastCommittedQsRef.current;
    lastCommittedQsRef.current = currentQs;
    setSettingsHistory(h => recordChange(h, previousQs));
  }, [currentQs]);

  // Apply a serialized settings entry (from undo/redo or a snapshot). Unknown
  // hardware ids fall back like the URL loader instead of blanking the picker.
  const applySettingsQs = useCallback((qs, { record = false } = {}) => {
    const s = parseSettings(qs);
    if (!record) applyingFromHistoryRef.current = true;
    if (s.preset && (s.preset.startsWith('lmx:') || HARDWARE_PRESETS.some(p => p.id === s.preset))) {
      setSelectedPreset(s.preset);
    }
    if (s.prefill !== null) setPrefillSpeed(s.prefill);
    if (s.decode !== null) setDecodeSpeed(s.decode);
    setSimSpeedMultiplier(s.sim);
    setSelectedFlags(s.flags);
    setIsPlaying(false);
  }, []);

  const handleUndo = useCallback(() => {
    const res = historyUndo(settingsHistory, currentQs);
    if (!res) return;
    applySettingsQs(res.qs);
    setSettingsHistory(res.history);
  }, [settingsHistory, currentQs, applySettingsQs]);

  const handleRedo = useCallback(() => {
    const res = historyRedo(settingsHistory, currentQs);
    if (!res) return;
    applySettingsQs(res.qs);
    setSettingsHistory(res.history);
  }, [settingsHistory, currentQs, applySettingsQs]);

  const handleRestoreSnapshot = useCallback((qs) => {
    applySettingsQs(qs, { record: true });
  }, [applySettingsQs]);

  // Keep shareable settings in the URL
  useEffect(() => {
    writeParams({
      tab: activeTab,
      preset: selectedPreset,
      prefill: prefillSpeed,
      decode: decodeSpeed,
      sim: simSpeedMultiplier === 'instant' ? 'instant' : simSpeedMultiplier,
      flags: selectedFlags.length > 0 ? selectedFlags.join(',') : null
    });
  }, [activeTab, selectedPreset, prefillSpeed, decodeSpeed, simSpeedMultiplier, selectedFlags]);

  const handleApplyPreset = (preset) => {
    setPrefillSpeed(preset.prefillSpeed);
    setDecodeSpeed(preset.decodeSpeed);
    setIsPlaying(false);
  };

  const handleApplyLocalMaxxingRun = useCallback((run) => {
    setSelectedPreset(`lmx:${run.id}`);
    setPrefillSpeed(run.tokSPrefill);
    setDecodeSpeed(run.tokSOut);
    setIsPlaying(false);
  }, []);

  const handleLocalMaxxingContext = useCallback((context) => {
    setLocalMaxxingContext(context);
  }, []);

  const handleReset = () => {
    setIsPlaying(false);
    setResetKey(k => k + 1);
  };

  // Issue #77: on tab switches, move focus to the new panel's heading so
  // screen-reader and keyboard users land inside the content they just
  // opened. The guided tour drives tabs itself while it's open — its dialog
  // owns focus, so panel focusing is suspended until it closes.
  const mainRef = useRef(null);
  useFocusPanelHeading(mainRef, activeTab, { enabled: !tourOpen });

  const handleToggleFlag = useCallback((id) => {
    setSelectedFlags(prev => prev.includes(id) ? prev.filter(f => f !== id) : [...prev, id]);
  }, []);

  // Bake the flag-adjusted speeds into the main controls and clear the
  // toggles, so re-toggling can never apply the same delta twice on top of
  // already-adjusted speeds.
  const handleApplyFlags = useCallback((prefill, decode) => {
    setPrefillSpeed(prefill);
    setDecodeSpeed(decode);
    setSelectedFlags([]);
    setIsPlaying(false);
  }, []);

  // Keyboard shortcuts: Ctrl/Cmd+Z undo, Ctrl/Cmd+Shift+Z redo, Space =
  // play/pause, R = reset, 1-8 = tabs. Plain-key shortcuts are ignored while
  // typing in inputs/selects or with modifier keys held.
  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) handleRedo(); else handleUndo();
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
      if (e.code === 'Space') {
        e.preventDefault(); // stop page scroll
        setIsPlaying(p => !p);
      } else if (e.key === 'r' || e.key === 'R') {
        handleReset();
      } else if (/^[1-9]$/.test(e.key)) {
        const tabs = ['single', 'agentic', 'batching', 'compare', 'ab', 'diff', 'shortlist', 'kvcache', 'theory', 'curriculum'];
        setActiveTab(tabs[Number(e.key) - 1]);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [handleUndo, handleRedo]);

  const handleShare = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
    } catch {
      // clipboard may be unavailable; no-op
    }
  };

  return (
    <div className="app-shell">

      {/* Navigation Header */}
      <Header
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        selectedPreset={selectedPreset}
        setSelectedPreset={setSelectedPreset}
        onApplyPreset={handleApplyPreset}
        onShare={handleShare}
        onTour={() => setTourOpen(true)}
      />

      <main className="app-frame stack" ref={mainRef}>
        <LocalMaxxingPresetPicker
          selectedPreset={selectedPreset}
          onApplyRun={handleApplyLocalMaxxingRun}
          onContextChange={handleLocalMaxxingContext}
        />

        {/* Speed & Control Panel */}
        <SpeedControls
        prefillSpeed={prefillSpeed}
        setPrefillSpeed={setPrefillSpeed}
        decodeSpeed={decodeSpeed}
        setDecodeSpeed={setDecodeSpeed}
        simSpeedMultiplier={simSpeedMultiplier}
        setSimSpeedMultiplier={setSimSpeedMultiplier}
        isPlaying={isPlaying}
        setIsPlaying={setIsPlaying}
        onReset={handleReset}
        />

        {/* Engine flag modeling: documented llama.cpp/vLLM flag deltas */}
        <EngineFlagPicker
          prefillSpeed={prefillSpeed}
          decodeSpeed={decodeSpeed}
          selectedFlags={selectedFlags}
          onToggleFlag={handleToggleFlag}
          onApplyFlags={handleApplyFlags}
        />

        {/* Settings history + named snapshots (#96) */}
        <SnapshotsSidebar
          currentQs={currentQs}
          onRestore={handleRestoreSnapshot}
          canUndo={settingsHistory.past.length > 0}
          canRedo={settingsHistory.future.length > 0}
          onUndo={handleUndo}
          onRedo={handleRedo}
        />
        {/* SLO budgets (issue #64): persisted targets checked on every tab */}
        <SloBudgetsPanel budgets={sloBudgets} onChange={setSloBudgets} />

      {/* Tab Content */}
        {activeTab === 'single' && (
          <SingleTurnVisualizer
            prefillSpeed={prefillSpeed}
            decodeSpeed={decodeSpeed}
            simSpeedMultiplier={simSpeedMultiplier}
            isPlaying={isPlaying}
            setIsPlaying={setIsPlaying}
            resetKey={resetKey}
            sloBudgets={sloBudgets}
          />
        )}

        {activeTab === 'agentic' && (
          <AgenticVisualizer
            prefillSpeed={prefillSpeed}
            decodeSpeed={decodeSpeed}
            simSpeedMultiplier={simSpeedMultiplier}
            isPlaying={isPlaying}
            setIsPlaying={setIsPlaying}
            resetKey={resetKey}
            sloBudgets={sloBudgets}
          />
        )}

        {activeTab === 'batching' && (
          <BatchingVisualizer
            prefillSpeed={prefillSpeed}
            decodeSpeed={decodeSpeed}
            simSpeedMultiplier={simSpeedMultiplier}
            isPlaying={isPlaying}
            setIsPlaying={setIsPlaying}
            resetKey={resetKey}
          />
        )}

        {activeTab === 'compare' && (
          <HardwareComparison
            presets={comparisonPresets}
            localMaxxingContext={localMaxxingContext}
            sloBudgets={sloBudgets}
          />
        )}

        {activeTab === 'ab' && (
          <ABReplay
            presets={comparisonPresets}
            simSpeedMultiplier={simSpeedMultiplier}
            isPlaying={isPlaying}
            setIsPlaying={setIsPlaying}
            resetKey={resetKey}
          />
        )}

        {activeTab === 'diff' && (
          <RunDiff />
        )}

        {activeTab === 'shortlist' && (
          <HardwareShortlist />
        )}

        {activeTab === 'kvcache' && (
          <KVCacheCalculator />
        )}

        {activeTab === 'theory' && (
          <TheoryGuide />
        )}

        {activeTab === 'curriculum' && (
          <CurriculumMode />
        )}
      </main>

      {/* First-run guided tour overlay */}
      {tourOpen && (
        <GuidedTour
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          prefillSpeed={prefillSpeed}
          decodeSpeed={decodeSpeed}
          onClose={() => setTourOpen(false)}
        />
      )}

      {/* Footer */}
      <footer className="site-footer">
        <p>
          <strong>{t('header.brandTitle')}</strong> · {t('app.footerTagline')}
        </p>
        <p style={{ fontSize: '0.7rem', marginTop: '4px', color: 'var(--text-subtle)' }}>
          {t('app.shortcutsPrefix')} <kbd>Space</kbd> {t('app.shortcutPlay')} · <kbd>R</kbd> {t('app.shortcutReset')} · <kbd>Ctrl</kbd>+<kbd>Z</kbd> {t('app.shortcutUndo')} · <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Z</kbd> {t('app.shortcutRedo')} · <kbd>1</kbd>–<kbd>9</kbd> {t('app.shortcutTabs')}
        </p>
        <p style={{ fontSize: '0.7rem', marginTop: '4px', color: 'var(--text-subtle)' }}>
          {t('app.agentsLinePrefix')} <a href="/llms.txt">/llms.txt</a> · <a href="/api/spec">OpenAPI</a> · <a href="/api/compute">/api/compute</a> · <a href="/api/best">/api/best</a> · <a href="/api/localmaxxing">/api/localmaxxing</a> · <a href="/api/diff">/api/diff</a>        </p>
      </footer>

    </div>
  );
}
