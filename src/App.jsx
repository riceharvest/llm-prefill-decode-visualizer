import React, { useState } from 'react';
import Header from './components/Header';
import SpeedControls from './components/SpeedControls';
import SingleTurnVisualizer from './components/SingleTurnVisualizer';
import AgenticVisualizer from './components/AgenticVisualizer';
import HardwareComparison from './components/HardwareComparison';
import KVCacheCalculator from './components/KVCacheCalculator';
import TheoryGuide from './components/TheoryGuide';
import { HARDWARE_PRESETS } from './utils/presets';

export default function App() {
  const [activeTab, setActiveTab] = useState('single');
  const [selectedPreset, setSelectedPreset] = useState('h100');
  const [prefillSpeed, setPrefillSpeed] = useState(9500);
  const [decodeSpeed, setDecodeSpeed] = useState(130);
  const [simSpeedMultiplier, setSimSpeedMultiplier] = useState(1);
  const [isPlaying, setIsPlaying] = useState(false);

  const handleApplyPreset = (preset) => {
    setPrefillSpeed(preset.prefillSpeed);
    setDecodeSpeed(preset.decodeSpeed);
    setIsPlaying(false);
  };

  const handleReset = () => {
    setIsPlaying(false);
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
