import React, { useState, useEffect } from 'react';
import Header from './components/Header';
import SpeedControls from './components/SpeedControls';
import SingleTurnVisualizer from './components/SingleTurnVisualizer';
import AgenticVisualizer from './components/AgenticVisualizer';
import HardwareComparison from './components/HardwareComparison';
import KVCacheCalculator from './components/KVCacheCalculator';
import TheoryGuide from './components/TheoryGuide';
import { readParam, writeParams } from './utils/urlState';

export default function App() {
  const [activeTab, setActiveTab] = useState(() => readParam('tab') || 'single');
  const [selectedPreset, setSelectedPreset] = useState(() => readParam('preset') || 'rtx4090_exl2');
  const [prefillSpeed, setPrefillSpeed] = useState(() => Number(readParam('prefill')) || 3800);
  const [decodeSpeed, setDecodeSpeed] = useState(() => Number(readParam('decode')) || 105);
  const [simSpeedMultiplier, setSimSpeedMultiplier] = useState(() => {
    const v = readParam('sim');
    return v === 'instant' ? 'instant' : (Number(v) || 1);
  });
  const [isPlaying, setIsPlaying] = useState(false);

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
  };

  const handleShare = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
    } catch (e) {
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
          />
        )}

        {activeTab === 'agentic' && (
          <AgenticVisualizer
            prefillSpeed={prefillSpeed}
            decodeSpeed={decodeSpeed}
            simSpeedMultiplier={simSpeedMultiplier}
            isPlaying={isPlaying}
            setIsPlaying={setIsPlaying}
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
