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
import { toLocalPreset, hardwareName } from './utils/localMaxxing';
import {
  describeConfig, permalinkHref, readPermalinkTitle, documentTitleFor
} from './utils/permalink';
import { verifyShareLink } from './utils/shareIntegrity';
import { readParam, writeParams } from './utils/urlState';
import {
  serializeSettings,
  recordChange, undo as historyUndo, redo as historyRedo,
  loadHistory, saveHistory, planRestore
} from './utils/settingsHistory';
// Issue #876 helpers (inlined; the shared module is owned by another
// resolution branch): unknown string ids in deep links keep their original
// value in state/URL while an explicit invalid-param signal is surfaced —
// a visible notice, a machine-readable data attribute, and a console.warn.
function findInvalidIdParams(entries) {
  return entries
    .filter(e => {
      if (e.value == null || e.value === '') return false;
      return typeof e.isValid === 'function' ? !e.isValid(e.value) : !e.isValid;
    })
    .map(e => ({ name: e.name, value: e.value }));
}

function invalidParamAttr(invalid) {
  return invalid.map(i => `${i.name}=${i.value}`).join(',');
}

function invalidParamLabel(invalid) {
  return invalid.map(i => `${i.name}="${i.value}"`).join(', ');
}

function warnInvalidParams(invalid, log = console.warn.bind(console)) {
  if (!invalid || invalid.length === 0) return;
  log(
    `[share-link] unknown id param(s): ${invalidParamLabel(invalid)} — kept in`
    + ' the URL but not applied; the app fell back to defaults. Valid id'
    + ' values are documented in /llms.txt (deep links) and served by'
    + ' /api/presets.'
  );
}

// Shared clipboard write helper (#1034, inlined): async Clipboard API first,
// then a hidden readOnly <textarea> + execCommand('copy') fallback. Resolves
// true on success, false when every strategy failed. Never rejects.
function execCommandCopy(text) {
  try {
    if (typeof document === 'undefined') return false;
    const ta = document.createElement('textarea');
    ta.value = String(text ?? '');
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.top = '0';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    const selection = typeof document.getSelection === 'function' ? document.getSelection() : null;
    const saved = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
    ta.select();
    ta.setSelectionRange(0, ta.value.length);
    let ok = false;
    try {
      ok = document.execCommand('copy') === true;
    } catch {
      ok = false;
    }
    ta.remove();
    if (saved && selection) {
      selection.removeAllRanges();
      selection.addRange(saved);
    }
    return ok;
  } catch {
    return false;
  }
}

async function copyTextToClipboard(text) {
  if (typeof navigator !== 'undefined' && navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Permission denied, insecure context… fall through to the legacy path.
    }
  }
  return execCommandCopy(text);
}
import SnapshotsSidebar from './components/SnapshotsSidebar';
import KeyboardShortcutsDialog from './components/KeyboardShortcutsDialog';
import { useFocusPanelHeading } from './utils/focus';
import { setLocale, syncDocument, t } from './i18n/strings';
import { installTouchTooltips } from './utils/touchTooltips';

// Web-font failure sentinel (#954, inlined; the shared module is owned by
// another resolution branch): index.html pulls Inter + JetBrains Mono from
// fonts.googleapis.com, but document.fonts reports 'loaded' even when the
// fetch fails. The sentinel measures REAL rendered widths of probe text in
// the web stack vs the bare fallback family and exposes the verdict via
// <html data-web-fonts="loaded|fallback|unknown"> plus one console.warn.
const FONT_PROBE_TEXT = 'mmmwww0000MMMMWWWW1111';
const FONT_PROBES = [
  { stack: '"JetBrains Mono", monospace', fallback: 'monospace' },
  { stack: 'Inter, sans-serif', fallback: 'sans-serif' }
];

function measureFontWidth(doc, fontFamily) {
  const el = doc.createElement('span');
  el.style.cssText =
    'position:absolute;left:-9999px;top:0;visibility:hidden;' +
    `white-space:pre;font-size:64px;font-family:${fontFamily};`;
  el.textContent = FONT_PROBE_TEXT;
  doc.body.appendChild(el);
  const width = el.getBoundingClientRect().width;
  el.remove();
  return width;
}

function fontStackApplied(widthOfStack, widthOfFallback) {
  return Number.isFinite(widthOfStack) && Number.isFinite(widthOfFallback) &&
    Math.abs(widthOfStack - widthOfFallback) > 0.5;
}

function detectWebFonts(doc) {
  if (!doc || !doc.body) return 'unknown';
  for (const probe of FONT_PROBES) {
    if (fontStackApplied(measureFontWidth(doc, probe.stack), measureFontWidth(doc, probe.fallback))) {
      return 'loaded';
    }
  }
  return 'fallback';
}

function installFontSentinel(
  doc = (typeof window !== 'undefined' ? window.document : null),
  log = console
) {
  if (!doc) return 'unknown';
  const applySentinel = () => {
    const state = detectWebFonts(doc);
    doc.documentElement.setAttribute('data-web-fonts', state);
    if (state === 'fallback') {
      log.warn(
        '[fonts] Web fonts (Inter / JetBrains Mono) unreachable or not applied — ' +
        'text metrics are fallback values; exported PNG/SVG measurements will differ.'
      );
    }
    return state;
  };
  if (doc.fonts?.ready?.then) {
    doc.fonts.ready.then(applySentinel);
    return 'pending';
  }
  return applySentinel();
}

// Every valid view id, in tab-bar order. Doubled as 1-9 keyboard-shortcut
// targets and as the allow-list for the `?tab=` query param: an unknown
// value falls back to 'single' instead of rendering a blank content area.
const TABS = ['single', 'agentic', 'batching', 'compare', 'ab', 'diff', 'shortlist', 'kvcache', 'theory'];

// Issue #450: unknown ?tab= values still fall back to 'single' (so the
// content area never renders blank) but the fallback is now detectable:
// a console.warn names the rejected value and the app shell carries
// data-tab-fallback for DOM-based consumers.
function resolveTabParam(value, validTabs, fallback = 'single') {
  if (value === null || value === '') return { tab: fallback, matched: true };
  if (validTabs.includes(value)) return { tab: value, matched: true };
  return { tab: fallback, matched: false };
}

// `?tab=` duplicate-key precedence (#950): the first VALID value wins, so
// ?tab=bogus&tab=diff opens Diff instead of silently falling back to 'single'
// because only the discarded first value was checked. Single-value links
// behave exactly as before.
function firstValidParam(search, name, isValid) {
  const values = new URLSearchParams(search || '').getAll(name);
  for (const v of values) if (isValid(v)) return v;
  return null;
}

function readTabParam() {
  const valid = firstValidParam(window.location.search, 'tab', t => TABS.includes(t));
  if (valid !== null) return valid;
  const v = readParam('tab');
  const resolved = resolveTabParam(v, TABS);
  if (!resolved.matched) {
    console.warn(`[urlState] unknown ?tab=${JSON.stringify(v)} — falling back to '${resolved.tab}' (valid: ${TABS.join('|')})`);
  }
  return resolved.tab;
}

const tabParamFallback = () => !resolveTabParam(readParam('tab'), TABS).matched;

// Declared slider ranges (#850/#1005): every path into prefillSpeed/
// decodeSpeed must land inside these so the slider thumb, the number twins,
// exports and og:image URLs can't drift.
const SPEED_RANGES = {
  prefill: { min: 50, max: 50000 },
  decode: { min: 2, max: 1000 }
};

function clampSpeed(kind, v) {
  const range = SPEED_RANGES[kind];
  const n = Number(v);
  if (!range || !Number.isFinite(n)) return n;
  return Math.min(range.max, Math.max(range.min, n));
}

const clampPrefill = (v) => clampSpeed('prefill', v);
const clampDecode = (v) => clampSpeed('decode', v);

// Build the /api/og query for og:image / twitter:image (#105/#435). Local
// helper mirroring the share-link fix's semantics: the card carries every
// workload param the OG endpoint honors so previews reflect the shared config.
function ogImageParams(currentSearch, { preset, prefill, decode }) {
  const sp = new URLSearchParams(currentSearch || '');
  const qs = new URLSearchParams({
    preset,
    prefill: String(prefill),
    decode: String(decode)
  });
  const promptRaw = Number(sp.get('prompt'));
  const prompt = Number.isFinite(promptRaw) && promptRaw > 0 ? promptRaw : null;
  if (prompt !== null) qs.set('prompt', String(prompt));
  return qs;
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
  const [tabFallback] = useState(tabParamFallback);



  // Locale + touch tooltips: one-time setup. `?lang=` overrides the default
  // locale; direction is applied to <html> so RTL locales flip the layout.
  useEffect(() => {
    const lang = readParam('lang');
    if (lang) setLocale(lang);
    syncDocument();
    installTouchTooltips();
    // Surface silent web-font fallback (#954): <html data-web-fonts=…> +
    // one console.warn when Google Fonts didn't actually apply.
    installFontSentinel();
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
  // Keep an unknown id verbatim in state so the URL is never rewritten (#876);
  // only a missing param boots the default preset.
  const [selectedPreset, setSelectedPreset] = useState(
    () => (presetParam ? presetParam : initialPreset)
  );
  // Ref mirror of selectedPreset so applySettingsQs (stable deps) can resolve
  // default-speed anchors without re-creating on every preset change.
  const selectedPresetRef = useRef(presetParam ? presetParam : initialPreset);
  useEffect(() => { selectedPresetRef.current = selectedPreset; }, [selectedPreset]);
  // Issue #434: prefill/decode are physical tok/s — non-finite, zero and
  // negative URL values fall back to the preset default instead of 0 silently
  // swapping for it or a negative value sticking in the number twin while the
  // slider clamps to its minimum.
  // Issue #1005: whatever survives lands inside the declared slider range so
  // the thumb, number twins and og:image URLs can't drift out of bounds.
  const [prefillSpeed, setPrefillSpeed] = useState(() => {
    const raw = Number(readParam('prefill'));
    const base = Number.isFinite(raw) && raw > 0 ? raw : initialPresetObj.prefillSpeed;
    return clampPrefill(base);
  });
  const [decodeSpeed, setDecodeSpeed] = useState(() => {
    const raw = Number(readParam('decode'));
    const base = Number.isFinite(raw) && raw > 0 ? raw : initialPresetObj.decodeSpeed;
    return clampDecode(base);
  });
  const [simSpeedMultiplier, setSimSpeedMultiplier] = useState(() => {
    const v = readParam('sim');
    // #892: accept 'inst' as an alias so the documented-shorter spelling
    // doesn't silently degrade to 1x.
    if (v === 'instant' || v === 'inst') return 'instant';
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : 1;
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
  // Per-tab inputs (e.g. ?prompt=) are written to the URL by the visualizers
  // via history.replaceState, which fires no event — without this subscription
  // the permalink title below kept citing the prompt length from mount time
  // (issue #727).
  const [promptParam, setPromptParam] = useState(() => readParam('prompt'));
  useEffect(() => {
    // URL params can change outside React state (Back/Forward navigation);
    // re-read the prompt so the workload context stays in sync (#727).
    const onPopState = () => setPromptParam(readParam('prompt'));
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);
  const permalinkTitle = useMemo(() => describeConfig({
    presetId: selectedPreset,
    hardwareLabel: selectedPreset.startsWith('lmx:') && selectedLmxRun
      ? hardwareName(selectedLmxRun)
      : undefined,
    modelId: selectedLmxRun?.model?.hfId || localMaxxingContext.modelId,
    quantization: selectedLmxRun?.engine?.quantization || localMaxxingContext.quantization,
    promptTokens: Number(promptParam) || undefined,
    activeTab
  }), [selectedPreset, selectedLmxRun, localMaxxingContext.modelId, localMaxxingContext.quantization, activeTab, promptParam]);

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
    // Issue #435: carry the workload params the OG endpoint honors (prompt
    // size changes the TTFT headline) so shared links preview the right chart.
    const ogUrl = `/api/og?${ogImageParams(window.location.search, {
      preset: selectedPreset,
      prefill: prefillSpeed,
      decode: decodeSpeed
    }).toString()}`;
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

  // Issue #106: share a titled permalink — the current query-string state
  // (which already encodes preset, speeds, flags and every tab's sim inputs)
  // plus the auto-generated human-readable `title` param and #s/<slug>.
  // Issue #726 / #501: report whether the copy actually succeeded so the
  // header can render an honest success/failure state instead of an
  // unconditional ✓.
  // Shared helper (#1034): falls back to execCommand in blocked-clipboard
  // contexts instead of failing silently.
  const handleShare = async () => {
    const href = permalinkHref({
      origin: window.location.origin,
      pathname: window.location.pathname,
      search: window.location.search,
      tab: activeTab
    }, permalinkTitle);
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
    <div className="app-shell" data-testid="app-root" data-tab-fallback={tabFallback || undefined}>

      {/* Navigation Header */}
      <Header
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        selectedPreset={selectedPreset}
        setSelectedPreset={setSelectedPreset}
        onApplyPreset={handleApplyPreset}
        onShare={handleShare}
      />

      {/* Share-link tamper-evidence (#917): a signed link whose params or
          ?title= were edited after signing is flagged here instead of being
          accepted silently — mirrors the loud failure of tampered calc ids. */}
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

      <main className="app-frame stack" ref={mainRef} id="main" tabIndex={-1} data-view={activeTab} data-active-tab={activeTab} data-invalid-param={invalidShareParams.length > 0 ? invalidParamAttr(invalidShareParams) : undefined}>
        {/* Skip-link target (#462): #root contains the banner, so the skip link
            pointed at a wrapper that skips nothing. #main starts below the
            header controls; tabindex=-1 lets it take focus on activation. */}
        {/* Issue #876: visible signal for unknown share-link ids — the URL
            keeps the original value, this banner explains the fallback. */}
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
        <CollapsibleSection id="localmaxxing" title={t('common.localMaxxingTitle') || 'LocalMaxxing measured presets'} badge="LIVE">
          <LocalMaxxingPresetPicker
            selectedPreset={selectedPreset}
            onApplyRun={handleApplyLocalMaxxingRun}
            onContextChange={handleLocalMaxxingContext}
          />
        </CollapsibleSection>

        {/* Speed controls only make sense on tabs that run a simulation */}
        {TABS.slice(0, 5).includes(activeTab) && (
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
        )}

        {/* Engine flag modeling: documented llama.cpp/vLLM flag deltas */}
        {TABS.slice(0, 5).includes(activeTab) && (
          <CollapsibleSection id="engine-flags" title="Engine flags" badge="SIMULATED DELTAS">
            <EngineFlagPicker
              prefillSpeed={prefillSpeed}
              decodeSpeed={decodeSpeed}
              selectedFlags={selectedFlags}
              onToggleFlag={handleToggleFlag}
              onApplyFlags={handleApplyFlags}
            />
          </CollapsibleSection>
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
