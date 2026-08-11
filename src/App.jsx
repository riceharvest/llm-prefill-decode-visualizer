import React, { useState, useEffect } from 'react';
import Header from './components/Header';
import SpeedControls from './components/SpeedControls';
import SingleTurnVisualizer from './components/SingleTurnVisualizer';
import AgenticVisualizer from './components/AgenticVisualizer';
import HardwareComparison from './components/HardwareComparison';
import KVCacheCalculator from './components/KVCacheCalculator';
import TheoryGuide from './components/TheoryGuide';
import { HARDWARE_PRESETS } from './utils/presets';
import { readParam, writeParams } from './utils/urlState';

export default function App() {
  const [activeTab, setActiveTab] = useState(() => readParam('tab') || 'single');

  // Preset from the URL drives both the dropdown label AND the default speeds,
  // unless explicit prefill/decode params override them.
  const initialPreset = (() => {
    const p = readParam('preset');
    return HARDWARE_PRESETS.find(x => x.id === p) ? p : 'rtx4090_exl2';
  })();
  const initialPresetObj = HARDWARE_PRESETS.find(x => x.id === initialPreset);
  const [selectedPreset, setSelectedPreset] = useState(initialPreset);
  const [prefillSpeed, setPrefillSpeed] = useState(() => Number(readParam('prefill')) || initialPresetObj.prefillSpeed);
  const [decodeSpeed, setDecodeSpeed] = useState(() => Number(readParam('decode')) || initialPresetObj.decodeSpeed);
  const [simSpeedMultiplier, setSimSpeedMultiplier] = useState(() => {
    const v = readParam('sim');
    return v === 'instant' ? 'instant' : (Number(v) || 1);
  });
  const [isPlaying, setIsPlaying] = useState(false);
  // Incremented by the global Reset button; visualizers watch it and clear
  // ALL sim state (phase, token progress, streams, elapsed time).
  const [resetKey, setResetKey] = useState(0);

  // Keep shareable settings in the URL
  useEffect(() => {
    writeParams({
      tab: activeTab,
      preset: selectedPreset,
      prefill: prefillSpeed,
      decode: decodeSpeed,
      sim: simSpeedMultiplier === 'instant' ? 'instant' : simSpeedMultiplier
    });
  }, [activeTab, selectedPreset, prefillSpeed, decodeSpeed, simSpeedMultiplier]);

  const handleApplyPreset = (preset) => {
    setPrefillSpeed(preset.prefillSpeed);
    setDecodeSpeed(preset.decodeSpeed);
    setIsPlaying(false);
  };

  const handleReset = () => {
    setIsPlaying(false);
    setResetKey(k => k + 1);
  };

  const handleShare = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
    } catch {
      // clipboard may be unavailable; no-op
    }
  };

  return (
    <div style={{ minHeight: '100vh', background: '#F8FAFC', paddingBottom: '40px' }}>
      
      {/* Navigation Header */}
      <Header
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        selectedPreset={selectedPreset}
        setSelectedPreset={setSelectedPreset}
        onApplyPreset={handleApplyPreset}
        onShare={handleShare}
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

      {/* Tab Content */}
      <main style={{ maxWidth: '1400px', margin: '0 auto' }}>
        {activeTab === 'single' && (
          <SingleTurnVisualizer
            prefillSpeed={prefillSpeed}
            decodeSpeed={decodeSpeed}
            simSpeedMultiplier={simSpeedMultiplier}
            isPlaying={isPlaying}
            setIsPlaying={setIsPlaying}
            resetKey={resetKey}
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
          />
        )}

        {activeTab === 'compare' && (
          <HardwareComparison />
        )}

        {activeTab === 'kvcache' && (
          <KVCacheCalculator />
        )}

        {activeTab === 'theory' && (
          <TheoryGuide />
        )}
      </main>

      {/* Material Footer */}
      <footer style={{
        textAlign: 'center',
        padding: '24px 16px',
        marginTop: '40px',
        borderTop: '1px solid #E2E8F0',
        color: '#64748B',
        fontSize: '0.82rem'
      }}>
        <p>
          <strong>LLM Prefill & Decode Speed Visualizer</strong> • Material White Design • Open Source Benchmark Tool
        </p>
      </footer>

    </div>
  );
}
