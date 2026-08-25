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
import SloBudgetsPanel, { useSloBudgets } from './components/SloBudgetsPanel';
import { sanitizeBudgets } from './utils/slo';
import { HARDWARE_PRESETS } from './utils/presets';
import { copyTextToClipboard } from './utils/clipboard';
import { toLocalPreset, hardwareName, lmxProvenance } from './utils/localMaxxing';
import {
  describeConfig, buildShareLink, readPermalinkTitle, documentTitleFor
} from './utils/permalink';
import { verifyShareLink } from './utils/shareIntegrity';
import { readParam, readSimSpeed, writeParams } from './utils/urlState';
import {
  findInvalidIdParams, invalidParamAttr, invalidParamLabel, warnInvalidParams
} from './utils/shareLinkParams';
import { copyTextToClipboard } from './utils/clipboard';
import {
  serializeSettings, parseSettings,
  createHistory, recordChange, undo as historyUndo, redo as historyRedo,
  clampPrefill, clampDecode
} from './utils/settingsHistory';
import SnapshotsSidebar from './components/SnapshotsSidebar';
import KeyboardShortcutsDialog from './components/KeyboardShortcutsDialog';
import { useFocusPanelHeading } from './utils/focus';
import { setLocale, syncDocument, t } from './i18n/strings';
import { installTouchTooltips } from './utils/touchTooltips';

// Every valid view id, in tab-bar order. Doubled as 1-9 keyboard-shortcut
// targets and as the allow-list for the `?tab=` query param: an unknown
// value falls back to 'single' instead of rendering a blank content area.
const TABS = ['single', 'agentic', 'batching', 'compare', 'ab', 'diff', 'shortlist', 'kvcache', 'theory'];

function readTabParam() {
  const v = readParam('tab');
  return TABS.includes(v) ? v : 'single';
}

export default function App() {
  const [activeTab, setActiveTab] = useState(readTabParam);
  // Shortcuts help dialog (#843): the `?` key toggles this; llms.txt and the
  // footer document the shortcut, so the dialog must actually mount.
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  // Last tab written to the URL (#830). A tab change pushes a history entry
  // so Back restores the previous view; settings-only changes keep using
  // replaceState so tweaking speeds doesn't spam history.
  const lastWrittenTabRef = useRef(activeTab);



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
  // Issue #876: an unknown ?preset= id is NOT silently swapped for
  // rtx4090_exl2 — the original value stays in state (and therefore in the
  // URL, since writeParams echoes it back), speeds fall back to the default
  // preset via `|| HARDWARE_PRESETS[0]` below, and an invalid-param notice +
  // data-invalid-param attribute + console.warn signal the mistake instead of
  // rewriting the link into a self-consistent-looking wrong config.
  const presetParam = readParam('preset');
  const presetParamValid = (p) => p?.startsWith('lmx:') || HARDWARE_PRESETS.some(x => x.id === p);
  const initialPreset = presetParamValid(presetParam) ? presetParam : 'rtx4090_exl2';
  const invalidShareParams = useMemo(() => findInvalidIdParams([
    { name: 'preset', value: presetParam, isValid: presetParamValid }
  ]) , [] /* read once on mount; the URL is not re-parsed */); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    warnInvalidParams(invalidShareParams);
  }, [invalidShareParams]);
  const initialPresetObj = HARDWARE_PRESETS.find(x => x.id === initialPreset) || HARDWARE_PRESETS[0];
  const [selectedPreset, setSelectedPreset] = useState(initialPreset);
  const [prefillSpeed, setPrefillSpeed] = useState(() => clampPrefill(Number(readParam('prefill')) || initialPresetObj.prefillSpeed, initialPresetObj.prefillSpeed));
  const [decodeSpeed, setDecodeSpeed] = useState(() => clampDecode(Number(readParam('decode')) || initialPresetObj.decodeSpeed, initialPresetObj.decodeSpeed));
  const [simSpeedMultiplier, setSimSpeedMultiplier] = useState(() => {
    const v = readParam('sim');
    return v === 'instant' ? 'instant' : (Number(v) || 1);
  });
  const [isPlaying, setIsPlaying] = useState(false);
  // #818: playback state must not carry across view switches — arriving on a
  // new tab with the old tab's run still "playing" starts that simulation
  // mid-flight. Reset whenever the active view changes.
  useEffect(() => {
    setIsPlaying(false);
  }, [activeTab]);
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
  // Single-turn workload (prompt/output tokens) lives HERE, not inside
  // SingleTurnVisualizer (#414): snapshots and undo entries serialize the
  // workload alongside preset/speeds/flags so restore + share links reproduce
  // the full configuration. The visualizer receives it as props.
  const [promptTokens, setPromptTokens] = useState(() => clampNum(readParamNum('prompt', 2048), 128, 32768));
  const [outputTokens, setOutputTokens] = useState(() => clampNum(readParamNum('output', 512), 32, 4096));
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
  // Measurement provenance for exports (#602): non-null only while an
  // lmx:<runId> preset is actually applied, so agents reading exported
  // JSON/Markdown can tell measured speeds from synthetic preset numbers.
  const lmxProvenanceBlock = useMemo(
    () => lmxProvenance(selectedPreset, selectedLmxRun),
    [selectedPreset, selectedLmxRun]
  );
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

  // Share-link tamper-evidence (#917): permalinkHref() signs the params it
  // shares; a loaded link's signature is checked once on mount. A signed link
  // whose params or ?title= were mutated surfaces a banner and loses its
  // ?title= privilege instead of being accepted verbatim. Unsigned links
  // (in-app navigation, legacy shares) are not flagged — no signature to
  // contradict.
  const [shareLinkTampered, setShareLinkTampered] = useState(false);
  const [shareSigGiven, setShareSigGiven] = useState('');
  const [shareSigExpected, setShareSigExpected] = useState('');
  useEffect(() => {
    let cancelled = false;
    verifyShareLink(window.location.search).then(result => {
      if (cancelled) return;
      if (result.status === 'tampered') {
        setShareLinkTampered(true);
        setShareSigGiven(result.given);
        setShareSigExpected(result.expected);
      }
    }).catch(() => { /* Web Crypto unavailable: degrade to old unsigned behavior */ });
    return () => { cancelled = true; };
  }, []);

  // An opened shared link shows its own encoded title; otherwise the derived
  // config title sits under the site brand. On a tampered link (#917) the
  // encoded title is ignored — it's attacker-controllable free text.
  useEffect(() => {
    document.title = documentTitleFor(
      readPermalinkTitle(window.location.search),
      permalinkTitle,
      t('header.brandTitle'),
      shareLinkTampered
    );
  }, [permalinkTitle, shareLinkTampered]);

  const comparisonPresets = useMemo(() => [
    ...localMaxxingContext.runs.map(run => toLocalPreset(run)),
    ...HARDWARE_PRESETS
  ], [localMaxxingContext.runs]);

  // Settings history + named snapshots (#96). Every change to the shareable
  // settings (preset, prefill, decode, sim multiplier, engine flags) is
  // recorded on an undo stack; snapshots are explicit named restore points
  // serialized to the same URL query format the share button uses.
  // The undo/redo stack persists to localStorage (#565) so a reload no longer
  // wipes the whole trail — restored on mount via loadHistory().
  const [settingsHistory, setSettingsHistory] = useState(loadHistory);
  useEffect(() => {
    saveHistory(settingsHistory);
  }, [settingsHistory]);
  const currentQs = useMemo(() => serializeSettings({
    preset: selectedPreset,
    prefill: prefillSpeed,
    decode: decodeSpeed,
    sim: simSpeedMultiplier,
    flags: selectedFlags,
    prompt: promptTokens,
    output: outputTokens
  }), [selectedPreset, prefillSpeed, decodeSpeed, simSpeedMultiplier, selectedFlags, promptTokens, outputTokens]);
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

  // Apply a serialized settings entry (from undo/redo or a snapshot). Restore
  // is TOTAL (#569): absent keys reset to the snapshot's preset defaults and
  // unresolved preset ids are reported instead of silently keeping the
  // current hardware. Returns a machine-readable report of what was applied.
  const applySettingsQs = useCallback((qs, { record = false } = {}) => {
    const plan = planRestore(qs, { presets: HARDWARE_PRESETS });
    const s = plan.settings;
    if (!record) applyingFromHistoryRef.current = true;
    if (plan.presetKnown && s.preset) {
      setSelectedPreset(s.preset);
    }
    // Absent speeds fall back to the resolved preset's own defaults, so the
    // same snapshot restores to the same state from any starting point.
    const anchorPreset = HARDWARE_PRESETS.find(p => p.id === s.preset)
      || HARDWARE_PRESETS.find(p => p.id === selectedPresetRef.current)
      || HARDWARE_PRESETS[0];
    if (s.prefill !== null) setPrefillSpeed(s.prefill);
    else setPrefillSpeed(anchorPreset.prefillSpeed);
    if (s.decode !== null) setDecodeSpeed(s.decode);
    else setDecodeSpeed(anchorPreset.decodeSpeed);
    setSimSpeedMultiplier(s.sim);
    setSelectedFlags(s.flags);
    setIsPlaying(false);
    const report = {
      applied: { preset: s.preset || null, prefill: s.prefill, decode: s.decode, sim: s.sim, flags: s.flags },
      resetToDefaults: plan.resets,
      unresolvedPreset: plan.unresolvedPreset
    };
    window.dispatchEvent(new CustomEvent('llmpdv:settings-restore', { detail: report }));
    return report;
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

  const [lastRestoreReport, setLastRestoreReport] = useState(null);
  const handleRestoreSnapshot = useCallback((qs, budgets) => {
    const report = applySettingsQs(qs, { record: true });
    // Surfaced in the sidebar (#569): absent keys reset to defaults and
    // unresolved preset ids are visible instead of silently merged.
    if (report.unresolvedPreset || report.resetToDefaults.length > 0) {
      setLastRestoreReport(report);
    } else {
      setLastRestoreReport(null);
    }
    // #613: a snapshot re-judges configs against the budgets that were active
    // at save time, not whatever happens to be set right now.
    if (budgets && typeof budgets === 'object') setSloBudgets(sanitizeBudgets(budgets));
  }, [applySettingsQs, setSloBudgets]);

  // Keep shareable settings in the URL. A view switch (#830) pushes a history
  // entry so browser Back returns to the previous view; every other change
  // rewrites in place with replaceState as before.
  useEffect(() => {
    const tabChanged = activeTab !== lastWrittenTabRef.current;
    lastWrittenTabRef.current = activeTab;
    writeParams({
      tab: activeTab,
      preset: selectedPreset,
      prefill: prefillSpeed,
      decode: decodeSpeed,
      sim: simSpeedMultiplier === 'instant' ? 'instant' : simSpeedMultiplier,
      flags: selectedFlags.length > 0 ? selectedFlags.join(',') : null
    }, { push: tabChanged });
  }, [activeTab, selectedPreset, prefillSpeed, decodeSpeed, simSpeedMultiplier, selectedFlags]);

  // URL -> state sync (#830): Back/Forward and any same-document navigation
  // (popstate also fires for hash changes) re-read `?tab=` and the shareable
  // settings from the location, so a programmatic pushState/replaceState of
  // ?tab=<valid> updates the rendered view instead of desyncing from it.
  // lastWrittenTabRef is advanced first so the URL-write effect treats this
  // as an in-place rewrite rather than pushing a duplicate history entry.
  useEffect(() => {
    const onPopState = () => {
      const tab = readTabParam();
      lastWrittenTabRef.current = tab;
      applySettingsQs(window.location.search);
      setActiveTab(tab);
      setIsPlaying(false);
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [applySettingsQs]);

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

  // Issue #410: switching presets used to silently discard manually edited
  // speeds. Detect overrides (current speeds ≠ current preset's defaults) and
  // surface a visible, SR-announced notice instead of a silent reset.
  const [presetNotice, setPresetNotice] = useState('');
  const handleApplyPreset = (preset) => {
    const previous = HARDWARE_PRESETS.find(p => p.id === selectedPreset);
    const overrode = previous
      && (prefillSpeed !== previous.prefillSpeed || decodeSpeed !== previous.decodeSpeed);
    setPresetNotice(overrode
      ? `Replaced manual speed overrides (prefill ${Number(prefillSpeed).toLocaleString()}, decode ${Number(decodeSpeed).toLocaleString()} tok/s) with the ${preset.name} preset (${Number(preset.prefillSpeed).toLocaleString()} / ${Number(preset.decodeSpeed).toLocaleString()} tok/s). Press Ctrl+Z to undo.`
      : '');
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
  useFocusPanelHeading(mainRef, activeTab);

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
      // While the shortcuts dialog is open only undo/redo stay live (#843):
      // the modal owns focus and plain-key shortcuts must not act behind it.
      if (shortcutsOpen) return;
      const tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
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
        // 1-9 map to the first nine views.
        setActiveTab(TABS[e.key === '0' ? 9 : Number(e.key) - 1]);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [handleUndo, handleRedo, shortcutsOpen]);

  // Issue #875: share a canonical permalink built by buildShareLink() — the
  // current query-string state (which already encodes preset, speeds, flags
  // and every tab's sim inputs) with `tab` pinned to the active view and
  // transient keys stripped. Titles stay display-only (#106): document.title
  // derives the readable config name, the link itself stays deterministic.
  // Issue #501: returns whether the copy actually succeeded so the header can
  // render an honest success/failure state instead of an unconditional ✓.
  const handleShare = async () => {
    // Shared helper (#1034): falls back to execCommand in blocked-clipboard
    // contexts instead of failing silently.
    const href = buildShareLink({
      origin: window.location.origin,
      pathname: window.location.pathname,
      search: window.location.search,
      tab: activeTab
    });
    return copyTextToClipboard(href);
  };

  // Issue #108: copy a ready-to-paste <iframe> snippet pointing at /embed
  // with the exact same settings query string as the share link, so what the
  // visitor sees embedded matches what the author configured.
  const handleEmbed = async () => {
    const src = `${window.location.origin}/embed${window.location.search}`;
    const snippet = `<iframe src="${src}" width="100%" height="520" frameborder="0" loading="lazy" title="${t('header.brandTitle')}"></iframe>`;
    return copyTextToClipboard(snippet);
  };

  return (
    <div className="app-shell" data-testid="app-root">

      {/* Navigation Header */}
      <Header
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        selectedPreset={selectedPreset}
        setSelectedPreset={setSelectedPreset}
        onApplyPreset={handleApplyPreset}
        onShare={handleShare}
      />

      {shareLinkTampered && (
        <div className="share-tamper-banner" role="alert" style={{
          margin: '0 auto', maxWidth: '72rem', padding: '0.6rem 1rem',
          border: '1px solid #b45309', borderRadius: 8,
          background: '#fffbeb', color: '#92400e'
        }}>
          <strong>This link was modified.</strong> Its settings no longer match the
          signature it was shared with, so its title is not shown. Verify any claims
          by recomputing via /api/calc with a <code>calc_</code> id.
          {' '}<small>(signature <code>{shareSigGiven}</code> ≠ expected <code>{shareSigExpected}</code>)</small>
        </div>
      )}

      {invalidShareParams.length > 0 && (
        <div className="invalid-param-notice" role="alert" style={{
          border: '1px solid var(--warn, #f59e0b)',
          background: 'rgba(245, 158, 11, 0.10)',
          color: 'var(--warn, #f59e0b)',
          borderRadius: '8px',
          padding: '10px 14px',
          fontSize: '0.85rem'
        }}>
          Unknown share-link parameter{invalidShareParams.length > 1 ? 's' : ''}:{' '}
          <code>{invalidParamLabel(invalidShareParams)}</code> — kept in the URL but not
          applied; default speeds are shown instead. Valid <code>preset</code> ids are listed
          in <a href="/llms.txt">/llms.txt</a> and served by <code>/api/presets</code>.
        </div>
      )}

      {/* data-view (#839): machine-readable active-view marker so a static
          HTML scrape can identify the rendered view without JS evaluation. */}
      <main className="app-frame stack" ref={mainRef} data-view={activeTab} data-invalid-param={invalidShareParams.length > 0 ? invalidParamAttr(invalidShareParams) : undefined}>
        <CollapsibleSection id="localmaxxing" title={t('common.localMaxxingTitle') || 'LocalMaxxing measured presets'} badge="LIVE">
          <LocalMaxxingPresetPicker
            selectedPreset={selectedPreset}
            onApplyRun={handleApplyLocalMaxxingRun}
            onContextChange={handleLocalMaxxingContext}
          />
        </CollapsibleSection>

        {/* Speed controls only make sense on tabs that run a simulation */}
        {TABS.slice(0, 5).includes(activeTab) && (
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
              hideSpeedInputs={activeTab === 'ab'}
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
            activeTab={activeTab}
            budgets={sloBudgets}
            onRestore={handleRestoreSnapshot}
            restoreReport={lastRestoreReport}
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
            promptTokens={promptTokens}
            setPromptTokens={setPromptTokens}
            outputTokens={outputTokens}
            setOutputTokens={setOutputTokens}
            engineFlags={selectedFlags}
            lmxProvenance={lmxProvenanceBlock}
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
      </main>

      {/* First-run guided tour overlay */}

      
      {/* Keyboard-shortcuts help dialog (#76/#843): opened with `?` */}
      {shortcutsOpen && (
        <KeyboardShortcutsDialog onClose={() => setShortcutsOpen(false)} />
      )}

      <footer className="site-footer" style={{ padding: '12px 0' }}>
        <p style={{ fontSize: '0.72rem', color: 'var(--text-subtle)' }}>
          {t('header.brandTitle')} · <a href="/llms.txt">API</a> · <a href="/api/spec">OpenAPI</a> · <kbd>Space</kbd> play · <kbd>R</kbd> reset
        </p>
      </footer>

    </div>
  );
}
