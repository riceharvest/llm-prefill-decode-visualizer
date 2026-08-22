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
import { setLocale, getLocale, getDirection, t } from '../i18n/strings';

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
  const activeTab = (() => {
    const tab = readParam('tab');
    return EMBED_TABS.has(tab) ? tab : 'single';
  })();

  // Locale handling mirrors App: ?lang= overrides, direction goes on <html>.
  useEffect(() => {
    const lang = readParam('lang');
    if (lang) setLocale(lang);
    document.documentElement.lang = getLocale();
    document.documentElement.dir = getDirection();
  }, []);

  // Preset + speeds resolve exactly like App's URL loaders: explicit
  // prefill/decode params win over the preset defaults.
  const initialPresetObj =
    HARDWARE_PRESETS.find(x => x.id === readParam('preset')) || HARDWARE_PRESETS[0];
  const [prefillSpeed] = useState(() => readParamNum('prefill', initialPresetObj.prefillSpeed));
  const [decodeSpeed] = useState(() => readParamNum('decode', initialPresetObj.decodeSpeed));
  const [simSpeedMultiplier] = useState(() => {
    const v = readParam('sim');
    return v === 'instant' ? 'instant' : (readParamNum('sim', 1));
  });
  // autoplay=1 starts the simulation on load (same convention as demoUrl).
  const [isPlaying, setIsPlaying] = useState(() => readParamBool('autoplay', false));
  const [resetKey] = useState(0);

  // Keep the embed URL in sync with the visible tab so reloads and
  // copy-the-iframe-src behave like the main app.
  useEffect(() => {
    writeParams({ tab: activeTab });
  }, [activeTab]);

  const sloBudgets = {};

  return (
    <div className="embed-shell">
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
