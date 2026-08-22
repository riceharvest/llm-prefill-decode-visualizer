import React, { useCallback, useMemo, useState, useEffect, useRef } from 'react';
import Header from './components/Header';
import LocalMaxxingPresetPicker from './components/LocalMaxxingPresetPicker';
import EngineFlagPicker from './components/EngineFlagPicker';
import CollapsibleSection from './components/CollapsibleSection';
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
import KeyboardShortcutsDialog from './components/KeyboardShortcutsDialog';
import { HARDWARE_PRESETS } from './utils/presets';
import { toLocalPreset, hardwareName } from './utils/localMaxxing';
import {
  describeConfig, permalinkHref, readPermalinkTitle, documentTitleFor
} from './utils/permalink';
import { readParam, writeParams } from './utils/urlState';
import {
  serializeSettings, parseSettings,
  createHistory, recordChange, undo as historyUndo, redo as historyRedo
} from './utils/settingsHistory';
import SnapshotsSidebar from './components/SnapshotsSidebar';
import ChangelogBanner from './components/ChangelogBanner';
import { useFocusPanelHeading } from './utils/focus';
import { setLocale, syncDocument, t } from './i18n/strings';
import { installTouchTooltips } from './utils/touchTooltips';

export default function App() {
  const [activeTab, setActiveTab] = useState(() => readParam('tab') || 'single');

  // First-run guided tour: shown once, skippable, re-launchable from the header '?' button.
  const [tourOpen, setTourOpen] = useState(() => !hasSeenTour());

  // Keyboard-shortcuts help dialog (#76): opened with the header keyboard
  // button or the `?` key. While it's open the global plain-key shortcuts
  // below stand down so typing behind the modal can't switch tabs or reset.
  const [shortcutsOpen, setShortcutsOpen] = useState(false);

  // Locale + touch tooltips: one-time setup. `?lang=` overrides the default
  // locale; direction is applied to <html> so RTL locales flip the layout.
  useEffect(() => {
    const lang = readParam('lang');
    if (lang) setLocale(lang);
    syncDocument();
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

  // Titled permalinks (issue #106): derive a human-readable title for the
  // current config so share links and document.title read like content —
  // "Qwen3 32B Q4 on RTX 4090 24GB, 8K agentic loop" — instead of a query
  // string. Prompt tokens live in per-tab URL state, which is always fresh by
  // share time because every visualizer writeParams() on change.
  const selectedLmxRun = useMemo(() => (
    localMaxxingContext.runs.find(r => r.id === localMaxxingContext.selectedRunId) || null
  ), [localMaxxingContext]);
  const permalinkTitle = useMemo(() => describeConfig({
    presetId: selectedPreset,
    hardwareLabel: selectedPreset.startsWith('lmx:') && selectedLmxRun
      ? hardwareName(selectedLmxRun)
      : undefined,
    modelId: selectedLmxRun?.model?.hfId || localMaxxingContext.modelId,
    quantization: selectedLmxRun?.engine?.quantization || localMaxxingContext.quantization,
    promptTokens: Number(readParam('prompt')) || undefined,
    activeTab
  }), [selectedPreset, selectedLmxRun, localMaxxingContext.modelId, localMaxxingContext.quantization, activeTab]);

  // An opened shared link shows its own encoded title; otherwise the derived
  // config title sits under the site brand.
  useEffect(() => {
    document.title = documentTitleFor(
      readPermalinkTitle(window.location.search),
      permalinkTitle,
      t('header.brandTitle')
    );
  }, [permalinkTitle]);

  const comparisonPresets = useMemo(() => [
    ...localMaxxingContext.runs.map(run => toLocalPreset(run)),
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

  // OG chart image (#105): point the og:image / twitter:image meta tags at
  // /api/og with the current config so shared links preview the actual chart.
  // Crawlers that don't run JS still get the static defaults from index.html.
  useEffect(() => {
    const qs = new URLSearchParams({ preset: selectedPreset });
    qs.set('prefill', String(prefillSpeed));
    qs.set('decode', String(decodeSpeed));
    const ogUrl = `/api/og?${qs.toString()}`;
    for (const selector of ['meta[property="og:image"]', 'meta[name="twitter:image"]']) {
      document.querySelector(selector)?.setAttribute('content', ogUrl);
    }
    const title = document.querySelector('meta[property="og:title"]');
    if (title) {
      const hw = HARDWARE_PRESETS.find(p => p.id === selectedPreset);
      if (hw) title.setAttribute('content', `${hw.name} — ${decodeSpeed} tok/s decode`);
    }
  }, [selectedPreset, prefillSpeed, decodeSpeed]);

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

  // Quantization matrix (issue #47): clicking a measured quant row bakes its
  // best-run speeds straight into the sim, same as applying a preset.
  const handleApplyMeasuredSpeeds = useCallback((prefill, decode) => {
    const p = Number(prefill);
    const d = Number(decode);
    if (!Number.isFinite(p) || !Number.isFinite(d) || p <= 0 || d <= 0) return;
    setPrefillSpeed(p);
    setDecodeSpeed(d);
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
  // play/pause, R = reset, 1-9 + 0 = tabs, ? = shortcuts help dialog.
  // Guards: modifier-held plain keys are ignored; typing in inputs/selects/
  // textareas never triggers plain-key shortcuts; Space on a focused button
  // lets the button handle it (the global toggle would double-fire and cancel
  // itself out); while the shortcuts dialog is open only undo/redo stay live.
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
      if (shortcutsOpen) return;
      if (e.key === '?') {
        e.preventDefault();
        setShortcutsOpen(true);
      } else if (e.code === 'Space') {
        if (tag === 'BUTTON') return; // the button's own activation handles it
        e.preventDefault(); // stop page scroll
        setIsPlaying(p => !p);
      } else if (e.key === 'r' || e.key === 'R') {
        handleReset();
      } else if (/^[0-9]$/.test(e.key)) {
        const tabs = ['single', 'agentic', 'batching', 'compare', 'ab', 'diff', 'shortlist', 'kvcache', 'theory', 'curriculum'];
        // 1-9 map to the first nine tabs; 0 wraps to the tenth (Curriculum).
        setActiveTab(tabs[e.key === '0' ? 9 : Number(e.key) - 1]);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [handleUndo, handleRedo, shortcutsOpen]);

  // Issue #106: share a titled permalink — the current query-string state
  // (which already encodes preset, speeds, flags and every tab's sim inputs)
  // plus the auto-generated human-readable `title` param and #s/<slug>.
  const handleShare = async () => {
    try {
      const href = permalinkHref({
        origin: window.location.origin,
        pathname: window.location.pathname,
        search: window.location.search
      }, permalinkTitle);
      await navigator.clipboard.writeText(href);
    } catch {
      // clipboard may be unavailable; no-op
    }
  };

  // Issue #108: copy a ready-to-paste <iframe> snippet pointing at /embed
  // with the exact same settings query string as the share link, so what the
  // visitor sees embedded matches what the author configured.
  const handleEmbed = async () => {
    try {
      const src = `${window.location.origin}/embed${window.location.search}`;
      const snippet = `<iframe src="${src}" width="100%" height="520" frameborder="0" loading="lazy" title="${t('header.brandTitle')}"></iframe>`;
      await navigator.clipboard.writeText(snippet);
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
        onEmbed={handleEmbed}
        shareTitle={permalinkTitle}
        onTour={() => setTourOpen(true)}
        onShortcuts={() => setShortcutsOpen(true)}
      />

      {/* What's-new banner (#112): newest /changelog.json entry, dismissible */}
      <ChangelogBanner />

      <main className="app-frame stack" ref={mainRef}>
        <CollapsibleSection id="localmaxxing" title={t('common.localMaxxingTitle') || 'LocalMaxxing measured presets'} badge="LIVE">
          <LocalMaxxingPresetPicker
            selectedPreset={selectedPreset}
            onApplyRun={handleApplyLocalMaxxingRun}
            onContextChange={handleLocalMaxxingContext}
          />
        </CollapsibleSection>

        {/* Speed controls only make sense on tabs that run a simulation */}
        {['single', 'agentic', 'batching', 'compare', 'ab'].includes(activeTab) && (
          <>
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
            <CollapsibleSection id="engine-flags" title="Engine flags" badge="SIMULATED DELTAS">
              <EngineFlagPicker
                prefillSpeed={prefillSpeed}
                decodeSpeed={decodeSpeed}
                selectedFlags={selectedFlags}
                onToggleFlag={handleToggleFlag}
                onApplyFlags={handleApplyFlags}
              />
            </CollapsibleSection>
          </>
        )}

        {/* Settings history + named snapshots (#96) — collapsed by default */}
        <CollapsibleSection id="snapshots" title="Snapshots & history">
          <SnapshotsSidebar
            currentQs={currentQs}
            onRestore={handleRestoreSnapshot}
            canUndo={settingsHistory.past.length > 0}
            canRedo={settingsHistory.future.length > 0}
            onUndo={handleUndo}
            onRedo={handleRedo}
          />
        </CollapsibleSection>

        {/* SLO budgets (issue #64): persisted targets checked on every tab */}
        <CollapsibleSection id="slo-budgets" title="SLO budgets">
          <SloBudgetsPanel budgets={sloBudgets} onChange={setSloBudgets} />
        </CollapsibleSection>

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
            onApplySpeeds={handleApplyMeasuredSpeeds}
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

      {/* Keyboard-shortcuts help dialog (#76) */}
      {shortcutsOpen && (
        <KeyboardShortcutsDialog onClose={() => setShortcutsOpen(false)} />
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
