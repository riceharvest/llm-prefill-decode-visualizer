import React, { useState, useEffect, useRef } from 'react';
import { Play, Pause, Zap, Gauge, FileText } from 'lucide-react';
import { formatTime, formatTokens } from '../utils/presets';

export default function SingleTurnVisualizer({
  prefillSpeed,
  decodeSpeed,
  simSpeedMultiplier,
  isPlaying,
  setIsPlaying
}) {
  const [promptTokens, setPromptTokens] = useState(2048);
  const [outputTokens, setOutputTokens] = useState(512);

  // Simulation state
  const [phase, setPhase] = useState('idle'); // 'idle' | 'prefilling' | 'decoding' | 'completed'
  const [currentPrefillProgress, setCurrentPrefillProgress] = useState(0); // 0 to promptTokens
  const [currentDecodeTokens, setCurrentDecodeTokens] = useState(0); // 0 to outputTokens
  const [elapsedTime, setElapsedTime] = useState(0); // seconds
  const [generatedTokensStream, setGeneratedTokensStream] = useState([]);

  // Calculated benchmarks
  const expectedTTFT = promptTokens / prefillSpeed; // seconds
  const expectedDecodeTime = outputTokens / decodeSpeed; // seconds
  const expectedTotalTime = expectedTTFT + expectedDecodeTime;
  const tpotMs = 1000 / decodeSpeed;

  const sampleWords = [
    "The", "architecture", "of", "modern", "Large", "Language", "Models", "relies",
    "on", "transformer", "attention", "mechanisms.", "During", "prefill,", "tokens",
    "are", "processed", "in", "parallel", "to", "construct", "the", "KV", "cache.",
    "During", "decode,", "each", "token", "is", "generated", "autoregressively,", "fetching",
    "weights", "and", "KV", "cache", "from", "high-bandwidth", "VRAM.", "This", "makes",
    "prefill", "compute-bound", "and", "decode", "memory-bound.", "Optimizing", "both",
    "is", "key", "to", "low-latency", "LLM", "inference."
  ];

  // Ref for timer
  const animFrameRef = useRef(null);
  const lastTickRef = useRef(null);

  // Reset simulation
  const handleReset = () => {
    setPhase('idle');
    setCurrentPrefillProgress(0);
    setCurrentDecodeTokens(0);
    setElapsedTime(0);
    setGeneratedTokensStream([]);
    setIsPlaying(false);
  };

  // Start / Resume simulation
  useEffect(() => {
    if (!isPlaying) {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      lastTickRef.current = null;
      return;
    }

    if (phase === 'idle' || phase === 'completed') {
      setPhase('prefilling');
      setCurrentPrefillProgress(0);
      setCurrentDecodeTokens(0);
      setElapsedTime(0);
      setGeneratedTokensStream([]);
    }

    const tick = (now) => {
      if (!lastTickRef.current) {
        lastTickRef.current = now;
        animFrameRef.current = requestAnimationFrame(tick);
        return;
      }

      const realDeltaSec = (now - lastTickRef.current) / 1000;
      lastTickRef.current = now;

      // Handle instant mode
      if (simSpeedMultiplier === 'instant') {
        setCurrentPrefillProgress(promptTokens);
        setCurrentDecodeTokens(outputTokens);
        setElapsedTime(expectedTotalTime);
        setGeneratedTokensStream(
          Array.from({ length: Math.min(outputTokens, 80) }, (_, i) => sampleWords[i % sampleWords.length])
        );
        setPhase('completed');
        setIsPlaying(false);
        return;
      }

      const simDeltaSec = realDeltaSec * simSpeedMultiplier;

      setElapsedTime(prevTime => {
        const newTime = prevTime + simDeltaSec;

        // Check if in prefill phase
        if (newTime <= expectedTTFT) {
          setPhase('prefilling');
          const prefillProgress = Math.min(promptTokens, Math.floor(newTime * prefillSpeed));
          setCurrentPrefillProgress(prefillProgress);
        } else if (newTime < expectedTotalTime) {
          setPhase('decoding');
          setCurrentPrefillProgress(promptTokens);
          const decodeProgressTime = newTime - expectedTTFT;
          const decodeCount = Math.min(outputTokens, Math.floor(decodeProgressTime * decodeSpeed));
          setCurrentDecodeTokens(decodeCount);

          // Update text stream preview
          if (decodeCount > generatedTokensStream.length && decodeCount <= outputTokens) {
            const nextWord = sampleWords[(decodeCount - 1) % sampleWords.length];
            setGeneratedTokensStream(prev => [...prev.slice(-79), nextWord]);
          }
        } else {
          // Completed
          setPhase('completed');
          setCurrentPrefillProgress(promptTokens);
          setCurrentDecodeTokens(outputTokens);
          setIsPlaying(false);
          return expectedTotalTime;
        }

        return newTime;
      });

      animFrameRef.current = requestAnimationFrame(tick);
    };

    animFrameRef.current = requestAnimationFrame(tick);

    return () => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    };
  }, [isPlaying, simSpeedMultiplier, promptTokens, outputTokens, prefillSpeed, decodeSpeed, expectedTTFT, expectedTotalTime]);

  const prefillPct = (expectedTTFT / expectedTotalTime) * 100;
  const decodePct = (expectedDecodeTime / expectedTotalTime) * 100;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', padding: '16px' }}>
      
      {/* Top Parameter Cards */}
      <div className="material-card" style={{ padding: '20px', background: '#FFFFFF' }}>
        <h2 style={{ fontSize: '1.1rem', fontWeight: '800', color: '#0F172A', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <FileText size={20} color="#4F46E5" />
          <span>Single-Turn Chat Parameters</span>
        </h2>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '24px' }}>
          {/* Prompt Tokens Slider */}
          <div style={{ background: '#F8FAFC', padding: '16px', borderRadius: '12px', border: '1px solid #E2E8F0' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
              <span style={{ fontWeight: '700', fontSize: '0.85rem', color: '#334155' }}>
                Input Prompt Length
              </span>
              <span style={{ fontFamily: 'var(--font-mono)', fontWeight: '800', color: '#2563EB', fontSize: '1rem' }}>
                {formatTokens(promptTokens)} tokens
              </span>
            </div>
            <input
              type="range"
              min="128"
              max="32768"
              step="128"
              value={promptTokens}
              onChange={(e) => {
                setPromptTokens(Number(e.target.value));
                handleReset();
              }}
            />
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.7rem', color: '#94A3B8', marginTop: '6px' }}>
              <span>128 tok (Short)</span>
              <span>4,096 tok (RAG)</span>
              <span>32,768 tok (Long Doc)</span>
            </div>
          </div>

          {/* Target Output Tokens Slider */}
          <div style={{ background: '#F8FAFC', padding: '16px', borderRadius: '12px', border: '1px solid #E2E8F0' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
              <span style={{ fontWeight: '700', fontSize: '0.85rem', color: '#334155' }}>
                Target Output Generation Length
              </span>
              <span style={{ fontFamily: 'var(--font-mono)', fontWeight: '800', color: '#059669', fontSize: '1rem' }}>
                {formatTokens(outputTokens)} tokens
              </span>
            </div>
            <input
              type="range"
              min="32"
              max="4096"
              step="32"
              value={outputTokens}
              onChange={(e) => {
                setOutputTokens(Number(e.target.value));
                handleReset();
              }}
            />
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.7rem', color: '#94A3B8', marginTop: '6px' }}>
              <span>32 tok (Concise)</span>
              <span>512 tok (Standard)</span>
              <span>4,096 tok (Code / Report)</span>
            </div>
          </div>
        </div>
      </div>

      {/* Main Visualizer Stage */}
      <div className="material-card-elevated" style={{ padding: '24px', background: '#FFFFFF' }}>
        
        {/* Status Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px', flexWrap: 'wrap', gap: '12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={{
              width: '12px',
              height: '12px',
              borderRadius: '50%',
              background: phase === 'prefilling' ? '#2563EB' : phase === 'decoding' ? '#059669' : phase === 'completed' ? '#10B981' : '#94A3B8',
              boxShadow: phase !== 'idle' ? `0 0 10px ${phase === 'prefilling' ? '#2563EB' : '#059669'}` : 'none'
            }} />
            <span style={{ fontWeight: '800', fontSize: '1.05rem', color: '#0F172A' }}>
              Execution Phase: {phase === 'idle' ? 'Ready to Simulate' : phase === 'prefilling' ? '1. Prefill (Prompt Ingestion)' : phase === 'decoding' ? '2. Decode (Autoregressive Generation)' : 'Completed'}
            </span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
            <div style={{ fontSize: '0.85rem', color: '#475569' }}>
              Simulated Walltime: <strong style={{ fontFamily: 'var(--font-mono)', fontSize: '1.1rem', color: '#0F172A' }}>{formatTime(elapsedTime)}</strong> / {formatTime(expectedTotalTime)}
            </div>

            <button
              onClick={() => setIsPlaying(!isPlaying)}
              style={{
                padding: '8px 18px',
                borderRadius: '8px',
                border: 'none',
                background: isPlaying ? '#F59E0B' : '#4F46E5',
                color: '#FFFFFF',
                fontWeight: '700',
                fontSize: '0.85rem',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '6px'
              }}
            >
              {isPlaying ? <Pause size={16} /> : <Play size={16} />}
              {isPlaying ? 'Pause' : 'Simulate Run'}
            </button>
          </div>
        </div>

        {/* Phase Split Dual Progress Bars */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '20px', marginBottom: '24px' }}>
          
          {/* Prefill Block Visualizer */}
          <div style={{
            padding: '16px',
            borderRadius: '12px',
            background: phase === 'prefilling' ? '#EFF6FF' : '#F8FAFC',
            border: `2px solid ${phase === 'prefilling' ? '#2563EB' : '#E2E8F0'}`,
            transition: 'all 0.2s ease'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <Zap size={18} color="#2563EB" />
                <span style={{ fontWeight: '800', fontSize: '0.9rem', color: '#1E40AF' }}>
                  Phase 1: Prefill (TTFT)
                </span>
              </div>
              <span className="badge badge-prefill" style={{ fontSize: '0.72rem' }}>
                {prefillSpeed.toLocaleString()} tok/s
              </span>
            </div>

            {/* Progress indicator */}
            <div style={{ height: '10px', background: '#DBEAFE', borderRadius: '5px', overflow: 'hidden', margin: '12px 0 8px 0' }}>
              <div style={{
                height: '100%',
                width: `${Math.min(100, (currentPrefillProgress / promptTokens) * 100)}%`,
                background: 'linear-gradient(90deg, #3B82F6 0%, #1D4ED8 100%)',
                borderRadius: '5px',
                transition: simSpeedMultiplier === 'instant' ? 'none' : 'width 0.1s linear'
              }} />
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', color: '#1E3A8A' }}>
              <span>Tokens Processed: <strong>{currentPrefillProgress.toLocaleString()}</strong> / {promptTokens.toLocaleString()}</span>
              <span>TTFT: <strong>{formatTime(expectedTTFT)}</strong></span>
            </div>
            
            <p style={{ fontSize: '0.73rem', color: '#3B82F6', marginTop: '8px' }}>
              💡 Compute-bound parallel matrix multiplication. Builds Key-Value (KV) cache for all {promptTokens.toLocaleString()} prompt tokens.
            </p>
          </div>

          {/* Decode Block Visualizer */}
          <div style={{
            padding: '16px',
            borderRadius: '12px',
            background: phase === 'decoding' ? '#ECFDF5' : '#F8FAFC',
            border: `2px solid ${phase === 'decoding' ? '#059669' : '#E2E8F0'}`,
            transition: 'all 0.2s ease'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <Gauge size={18} color="#059669" />
                <span style={{ fontWeight: '800', fontSize: '0.9rem', color: '#065F46' }}>
                  Phase 2: Decode (Generation)
                </span>
              </div>
              <span className="badge badge-decode" style={{ fontSize: '0.72rem' }}>
                {decodeSpeed.toLocaleString()} tok/s ({tpotMs.toFixed(1)} ms/tok)
              </span>
            </div>

            {/* Progress indicator */}
            <div style={{ height: '10px', background: '#D1FAE5', borderRadius: '5px', overflow: 'hidden', margin: '12px 0 8px 0' }}>
              <div style={{
                height: '100%',
                width: `${Math.min(100, (currentDecodeTokens / outputTokens) * 100)}%`,
                background: 'linear-gradient(90deg, #10B981 0%, #047857 100%)',
                borderRadius: '5px',
                transition: simSpeedMultiplier === 'instant' ? 'none' : 'width 0.1s linear'
              }} />
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', color: '#064E3B' }}>
              <span>Tokens Generated: <strong>{currentDecodeTokens.toLocaleString()}</strong> / {outputTokens.toLocaleString()}</span>
              <span>Decode Walltime: <strong>{formatTime(expectedDecodeTime)}</strong></span>
            </div>

            <p style={{ fontSize: '0.73rem', color: '#059669', marginTop: '8px' }}>
              💡 Memory-bandwidth bound autoregressive loop. Fetches all model weights & KV cache per token generated.
            </p>
          </div>

        </div>

        {/* Dynamic Token Stream & Simulated Output */}
        <div style={{ background: '#F8FAFC', borderRadius: '12px', border: '1px solid #E2E8F0', padding: '16px', marginBottom: '24px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
            <span style={{ fontSize: '0.82rem', fontWeight: '700', color: '#475569', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Live Simulated Autoregressive Decode Stream ({currentDecodeTokens} tokens)
            </span>
            <span style={{ fontSize: '0.75rem', fontFamily: 'var(--font-mono)', color: '#059669', fontWeight: '700' }}>
              TPOT: {tpotMs.toFixed(1)} ms / token
            </span>
          </div>

          <div style={{
            background: '#FFFFFF',
            border: '1px solid #CBD5E1',
            borderRadius: '8px',
            padding: '14px',
            minHeight: '80px',
            maxHeight: '160px',
            overflowY: 'auto',
            fontFamily: 'var(--font-mono)',
            fontSize: '0.88rem',
            color: '#0F172A',
            lineHeight: 1.6,
            display: 'flex',
            flexWrap: 'wrap',
            gap: '4px',
            alignContent: 'flex-start'
          }}>
            {generatedTokensStream.length === 0 ? (
              <span style={{ color: '#94A3B8', fontStyle: 'italic' }}>
                {phase === 'prefilling' ? '⏳ Ingesting prompt (Prefill phase active)...' : 'Click "Simulate Run" to watch token streaming visualizer.'}
              </span>
            ) : (
              generatedTokensStream.map((word, idx) => (
                <span
                  key={idx}
                  className="animate-token"
                  style={{
                    background: idx === generatedTokensStream.length - 1 ? '#D1FAE5' : 'transparent',
                    color: idx === generatedTokensStream.length - 1 ? '#047857' : '#0F172A',
                    padding: '0 2px',
                    borderRadius: '3px',
                    fontWeight: idx === generatedTokensStream.length - 1 ? '700' : '400'
                  }}
                >
                  {word}
                </span>
              ))
            )}
            {phase === 'decoding' && (
              <span style={{ display: 'inline-block', width: '8px', height: '16px', background: '#059669', marginLeft: '2px', animation: 'pulse-subtle 0.8s infinite' }} />
            )}
          </div>
        </div>

        {/* Walltime & Performance Breakdown Cards */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px' }}>
          
          <div style={{ background: '#F1F5F9', padding: '16px', borderRadius: '12px', border: '1px solid #E2E8F0' }}>
            <div style={{ fontSize: '0.75rem', fontWeight: '700', color: '#64748B', textTransform: 'uppercase' }}>
              TTFT (Time To First Token)
            </div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: '1.4rem', fontWeight: '800', color: '#2563EB', marginTop: '4px' }}>
              {formatTime(expectedTTFT)}
            </div>
            <div style={{ fontSize: '0.72rem', color: '#475569', marginTop: '4px' }}>
              Prompt prefill latency
            </div>
          </div>

          <div style={{ background: '#F1F5F9', padding: '16px', borderRadius: '12px', border: '1px solid #E2E8F0' }}>
            <div style={{ fontSize: '0.75rem', fontWeight: '700', color: '#64748B', textTransform: 'uppercase' }}>
              TPOT (Time Per Output Token)
            </div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: '1.4rem', fontWeight: '800', color: '#059669', marginTop: '4px' }}>
              {tpotMs.toFixed(1)} ms
            </div>
            <div style={{ fontSize: '0.72rem', color: '#475569', marginTop: '4px' }}>
              {decodeSpeed} tokens / sec
            </div>
          </div>

          <div style={{ background: '#F1F5F9', padding: '16px', borderRadius: '12px', border: '1px solid #E2E8F0' }}>
            <div style={{ fontSize: '0.75rem', fontWeight: '700', color: '#64748B', textTransform: 'uppercase' }}>
              Total Chat Walltime
            </div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: '1.4rem', fontWeight: '800', color: '#0F172A', marginTop: '4px' }}>
              {formatTime(expectedTotalTime)}
            </div>
            <div style={{ fontSize: '0.72rem', color: '#475569', marginTop: '4px' }}>
              Prefill + Decode combined
            </div>
          </div>

          <div style={{ background: '#F1F5F9', padding: '16px', borderRadius: '12px', border: '1px solid #E2E8F0' }}>
            <div style={{ fontSize: '0.75rem', fontWeight: '700', color: '#64748B', textTransform: 'uppercase' }}>
              Effective Walltime Throughput
            </div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: '1.4rem', fontWeight: '800', color: '#4F46E5', marginTop: '4px' }}>
              {((promptTokens + outputTokens) / expectedTotalTime).toFixed(1)} <span style={{ fontSize: '0.8rem' }}>tok/s</span>
            </div>
            <div style={{ fontSize: '0.72rem', color: '#475569', marginTop: '4px' }}>
              Total Tokens ÷ Walltime
            </div>
          </div>

        </div>

        {/* Stacked Walltime Percentage Bar */}
        <div style={{ marginTop: '24px', paddingTop: '16px', borderTop: '1px solid #E2E8F0' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
            <span style={{ fontSize: '0.82rem', fontWeight: '700', color: '#334155' }}>
              Walltime Distribution Breakdown
            </span>
            <span style={{ fontSize: '0.78rem', color: '#64748B' }}>
              Prefill: <strong>{prefillPct.toFixed(1)}%</strong> | Decode: <strong>{decodePct.toFixed(1)}%</strong>
            </span>
          </div>

          <div style={{ display: 'flex', height: '22px', borderRadius: '8px', overflow: 'hidden', background: '#E2E8F0' }}>
            <div
              style={{
                width: `${prefillPct}%`,
                background: '#2563EB',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#FFFFFF',
                fontSize: '0.7rem',
                fontWeight: '800'
              }}
              title={`Prefill Time: ${formatTime(expectedTTFT)} (${prefillPct.toFixed(1)}%)`}
            >
              {prefillPct > 8 && `Prefill (${prefillPct.toFixed(0)}%)`}
            </div>
            <div
              style={{
                width: `${decodePct}%`,
                background: '#059669',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#FFFFFF',
                fontSize: '0.7rem',
                fontWeight: '800'
              }}
              title={`Decode Time: ${formatTime(expectedDecodeTime)} (${decodePct.toFixed(1)}%)`}
            >
              {decodePct > 8 && `Decode (${decodePct.toFixed(0)}%)`}
            </div>
          </div>
        </div>

      </div>

    </div>
  );
}
