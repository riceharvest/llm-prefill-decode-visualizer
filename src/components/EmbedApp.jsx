import React, { useEffect, useState } from 'react';
import SingleTurnVisualizer from './SingleTurnVisualizer';
import AgenticVisualizer from './AgenticVisualizer';
import BatchingVisualizer from './BatchingVisualizer';
import HardwareComparison from './HardwareComparison';
import ABReplay from './ABReplay';
import RunDiff from './RunDiff';
import HardwareShortlist from './HardwareShortlist';
import KVCacheCalculator from './KVCacheCalculator';
import TheoryGuide from './TheoryGuide';
import CurriculumMode from './CurriculumMode';
import { HARDWARE_PRESETS } from '../utils/presets';
import { readParam, readParamNum, readParamBool, writeParams } from '../utils/urlState';
import { clampPrefill, clampDecode } from '../utils/settingsHistory';
import { setLocale, getLocale, getDirection, t, isKnownLocale } from '../i18n/strings';
import { EMBED_EVENTS, postEmbedEvent, installEmbedBridge } from '../utils/embedBridge';

// Embeddable widget view (issue #108): served at /embed?tab=…&preset=… it
// renders the same visualizer the main app shows for that tab, minus all
// chrome — no header, no controls stack, no footer — so the chart fits a
// compact <iframe>. It reads the identical URL params as App so an embed URL
// is just the share URL with /embed in the path.
const EMBED_TABS = new Set([
  'single', 'agentic', 'batching', 'compare', 'ab',
  'diff', 'shortlist', 'kvcache', 'theory', 'curriculum'
]);

export default function EmbedApp() {
  const [activeTab, setActiveTab] = useState(() => {
    const tab = readParam('tab');
    return EMBED_TABS.has(tab) ? tab : 'single';
  });

  // Locale handling mirrors App: ?lang= overrides, direction goes on <html>.
  // Unsupported lang values are reported (issue #533), not silently ignored.
  useEffect(() => {
    const lang = readParam('lang');
    if (lang) {
      setLocale(lang);
      if (!isKnownLocale(lang)) {
        // eslint-disable-next-line no-console
        console.warn(`[i18n] ?lang=${lang} has no translation catalog — staying in English (known: en, ar)`);
        document.documentElement.dataset.langFallback = 'true';
      }
    }
    document.documentElement.lang = getLocale();
    document.documentElement.dir = getDirection();
  }, []);

  // Preset + speeds resolve exactly like App's URL loaders: explicit
  // prefill/decode params win over the preset defaults.
  const initialPresetObj =
    HARDWARE_PRESETS.find(x => x.id === readParam('preset')) || HARDWARE_PRESETS[0];
  const [prefillSpeed] = useState(() => clampPrefill(readParamNum('prefill', initialPresetObj.prefillSpeed), initialPresetObj.prefillSpeed));
  const [decodeSpeed] = useState(() => clampDecode(readParamNum('decode', initialPresetObj.decodeSpeed), initialPresetObj.decodeSpeed));
  const [simSpeedMultiplier] = useState(() => {
    const v = readParam('sim');
    return v === 'instant' ? 'instant' : (readParamNum('sim', 1));
  });
  // autoplay=1 starts the simulation on load (same convention as demoUrl).
  const [isPlaying, setIsPlaying] = useState(() => readParamBool('autoplay', false));
  const [resetKey, bumpReset] = useState(0);

  // Keep the embed URL in sync with the visible tab so reloads and
  // copy-the-iframe-src behave like the main app.
  useEffect(() => {
    writeParams({ tab: activeTab });
  }, [activeTab]);

  // #894: window-message bridge so a cross-origin host page can observe state
  // and drive playback. Outbound: llmpdv:ready on mount, llmpdv:state whenever
  // tab/playback changes. Inbound: llmpdv:command from the direct parent only.
  useEffect(() => {
    postEmbedEvent(window.parent, EMBED_EVENTS.READY, { tab: activeTab });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    postEmbedEvent(window.parent, EMBED_EVENTS.STATE, { tab: activeTab, playing: isPlaying });
  }, [activeTab, isPlaying]);

  useEffect(() => {
    return installEmbedBridge({
      parent: typeof window !== 'undefined' ? window.parent : null,
      onCommand: (cmd) => {
        switch (cmd.action) {
          case 'play': setIsPlaying(true); break;
          case 'pause': setIsPlaying(false); break;
          case 'reset':
            setIsPlaying(false);
            bumpReset(k => k + 1);
            break;
          case 'setTab':
            if (EMBED_TABS.has(cmd.tab)) setActiveTab(cmd.tab);
            break;
          default:
            break;
        }
      }
    });
  }, []);

  const sloBudgets = {};

  return (
    <div className="embed-shell" data-testid="embed-root">
      <main className="embed-stage">
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
            presets={HARDWARE_PRESETS}
            localMaxxingContext={{ modelId: '', quantization: '', runs: [], selectedRunId: '' }}
            sloBudgets={sloBudgets}
            onApplySpeeds={() => {}}
          />
        )}
        {activeTab === 'ab' && (
          <ABReplay
            presets={HARDWARE_PRESETS}
            simSpeedMultiplier={simSpeedMultiplier}
            isPlaying={isPlaying}
            setIsPlaying={setIsPlaying}
            resetKey={resetKey}
          />
        )}
        {activeTab === 'diff' && <RunDiff />}
        {activeTab === 'shortlist' && <HardwareShortlist />}
        {activeTab === 'kvcache' && <KVCacheCalculator />}
        {activeTab === 'theory' && <TheoryGuide />}
        {activeTab === 'curriculum' && <CurriculumMode />}
      </main>

      {/* Single attribution line: every embed stays a discovery surface. */}
      <p className="embed-attribution">
        <a href="/" target="_blank" rel="noopener noreferrer">{t('header.brandTitle')}</a>
      </p>
    </div>
  );
}
