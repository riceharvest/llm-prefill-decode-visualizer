import React, { useState, useEffect, useRef } from 'react';
import { Bot, Zap, Gauge, Clock, ToggleLeft, ToggleRight, Layers, ArrowRight, Play, Pause, RefreshCw, BarChart2, CheckCircle } from 'lucide-react';
import { formatTime, formatTokens } from '../utils/presets';

export default function AgenticVisualizer({
  prefillSpeed,
  decodeSpeed,
  simSpeedMultiplier,
  isPlaying,
  setIsPlaying
}) {
  // Agent configuration parameters
  const [numTurns, setNumTurns] = useState(4);
  const [basePromptTokens, setBasePromptTokens] = useState(1500);
  const [toolOutputTokensPerTurn, setToolOutputTokensPerTurn] = useState(800);
  const [decodeTokensPerTurn, setDecodeTokensPerTurn] = useState(250);
  const [enablePrefixCaching, setEnablePrefixCaching] = useState(true);

  // Simulation execution state
  const [activeTurn, setActiveTurn] = useState(0); // 1-indexed when active, 0 when idle
  const [currentPhase, setCurrentPhase] = useState('idle'); // 'idle' | 'prefilling' | 'decoding' | 'completed'
  const [elapsedSimTime, setElapsedSimTime] = useState(0);
  const [turnLogs, setTurnLogs] = useState([]);

  // Calculate mathematical timeline per turn
  const calculateTurnBreakdown = () => {
    const turns = [];
    let cumulativePromptTokens = basePromptTokens;
    let cumulativeWalltime = 0;

    const turnActions = [
      { tool: 'user_query', label: 'User Task & Agent Plan Generation' },
      { tool: 'database_query', label: 'Tool Call #1: Query Vector DB / RAG' },
      { tool: 'execute_code', label: 'Tool Call #2: Run Data Analysis Code' },
      { tool: 'web_search', label: 'Tool Call #3: Fetch Web Documentation' },
      { tool: 'format_response', label: 'Tool Call #4: Structure Final Report' },
      { tool: 'review_check', label: 'Tool Call #5: Verification & Double-Check' }
    ];

    for (let t = 1; t <= numTurns; t++) {
      let promptTokensThisTurn = cumulativePromptTokens;
      let newTokensToPrefill = promptTokensThisTurn;

      if (enablePrefixCaching && t > 1) {
        // Only prefill the NEW tool output + previous decode tokens added in the last turn
        newTokensToPrefill = toolOutputTokensPerTurn + decodeTokensPerTurn;
      }

      const prefillTime = newTokensToPrefill / prefillSpeed;
      const decodeTime = decodeTokensPerTurn / decodeSpeed;
      const turnWalltime = prefillTime + decodeTime;
      cumulativeWalltime += turnWalltime;

      const actionInfo = turnActions[(t - 1) % turnActions.length];

      turns.push({
        turn: t,
        label: actionInfo.label,
        tool: actionInfo.tool,
        totalPromptTokens: promptTokensThisTurn,
        newTokensPrefilled: newTokensToPrefill,
        decodeTokens: decodeTokensPerTurn,
        prefillTime,
        decodeTime,
        turnWalltime,
        cumulativeWalltime,
        isCached: enablePrefixCaching && t > 1
      });

      // Update prompt history length for next turn (adds decode tokens + tool output tokens)
      cumulativePromptTokens += decodeTokensPerTurn + toolOutputTokensPerTurn;
    }

    return turns;
  };

  const turnBreakdown = calculateTurnBreakdown();
  const totalAgentWalltime = turnBreakdown.reduce((acc, t) => acc + t.turnWalltime, 0);
  const totalTokensProcessed = turnBreakdown.reduce((acc, t) => acc + t.totalPromptTokens + t.decodeTokens, 0);

  // Compare walltime if caching was turned off
  const turnBreakdownNoCache = (() => {
    let cumPrompt = basePromptTokens;
    let total = 0;
    for (let t = 1; t <= numTurns; t++) {
      const pTime = cumPrompt / prefillSpeed;
      const dTime = decodeTokensPerTurn / decodeSpeed;
      total += pTime + dTime;
      cumPrompt += decodeTokensPerTurn + toolOutputTokensPerTurn;
    }
    return total;
  })();

  const cachingTimeSaved = turnBreakdownNoCache - totalAgentWalltime;
  const cachingPercentSaved = (cachingTimeSaved / turnBreakdownNoCache) * 100;

  // Ref for timer
  const animFrameRef = useRef(null);
  const lastTickRef = useRef(null);

  const handleReset = () => {
    setActiveTurn(0);
    setCurrentPhase('idle');
    setElapsedSimTime(0);
    setTurnLogs([]);
    setIsPlaying(false);
  };

  // Simulation runner effect
  useEffect(() => {
    if (!isPlaying) {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      lastTickRef.current = null;
      return;
    }

    if (currentPhase === 'idle' || currentPhase === 'completed') {
      setActiveTurn(1);
      setCurrentPhase('prefilling');
      setElapsedSimTime(0);
      setTurnLogs([]);
    }

    const tick = (now) => {
      if (!lastTickRef.current) {
        lastTickRef.current = now;
        animFrameRef.current = requestAnimationFrame(tick);
        return;
      }

      const realDelta = (now - lastTickRef.current) / 1000;
      lastTickRef.current = now;

      if (simSpeedMultiplier === 'instant') {
        setActiveTurn(numTurns);
        setCurrentPhase('completed');
        setElapsedSimTime(totalAgentWalltime);
        setTurnLogs(turnBreakdown.map(t => `Turn ${t.turn}: ${t.label} completed in ${formatTime(t.turnWalltime)}`));
        setIsPlaying(false);
        return;
      }

      const simDelta = realDelta * simSpeedMultiplier;

      setElapsedSimTime(prev => {
        const nextTime = prev + simDelta;

        // Find which turn and phase we are currently in
        let accumulated = 0;
        let foundTurn = numTurns;
        let foundPhase = 'completed';

        for (let t = 0; t < turnBreakdown.length; t++) {
          const item = turnBreakdown[t];
          const turnStart = accumulated;
          const prefillEnd = turnStart + item.prefillTime;
          const turnEnd = turnStart + item.turnWalltime;

          if (nextTime < prefillEnd) {
            foundTurn = item.turn;
            foundPhase = 'prefilling';
            break;
          } else if (nextTime < turnEnd) {
            foundTurn = item.turn;
            foundPhase = 'decoding';
            break;
          }
          accumulated = turnEnd;
        }

        if (nextTime >= totalAgentWalltime) {
          setActiveTurn(numTurns);
          setCurrentPhase('completed');
          setIsPlaying(false);
          return totalAgentWalltime;
        } else {
          setActiveTurn(foundTurn);
          setCurrentPhase(foundPhase);
        }

        return nextTime;
      });

      animFrameRef.current = requestAnimationFrame(tick);
    };

    animFrameRef.current = requestAnimationFrame(tick);

    return () => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    };
  }, [isPlaying, simSpeedMultiplier, numTurns, totalAgentWalltime]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', padding: '16px' }}>
      
      {/* Top Configuration Card */}
      <div className="material-card" style={{ padding: '20px', background: '#FFFFFF' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px', marginBottom: '16px' }}>
          <h2 style={{ fontSize: '1.1rem', fontWeight: '800', color: '#0F172A', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Bot size={22} color="#D97706" />
            <span>Agentic Tool-Loop Parameters</span>
          </h2>

          {/* Prefix Caching Toggle */}
          <button
            onClick={() => {
              setEnablePrefixCaching(!enablePrefixCaching);
              handleReset();
            }}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              padding: '8px 16px',
              borderRadius: '10px',
              border: enablePrefixCaching ? '1px solid #10B981' : '1px solid #CBD5E1',
              background: enablePrefixCaching ? '#ECFDF5' : '#F8FAFC',
              color: enablePrefixCaching ? '#065F46' : '#475569',
              fontWeight: '700',
              fontSize: '0.85rem',
              cursor: 'pointer',
              transition: 'all 0.15s ease'
            }}
          >
            {enablePrefixCaching ? <ToggleRight size={22} color="#10B981" /> : <ToggleLeft size={22} color="#64748B" />}
            <span>Prefix Caching (KV Cache Reuse): <strong>{enablePrefixCaching ? 'ENABLED (Fast)' : 'DISABLED (Full Reprefill)'}</strong></span>
          </button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '20px' }}>
          
          {/* Number of Turns */}
          <div style={{ background: '#F8FAFC', padding: '14px', borderRadius: '10px', border: '1px solid #E2E8F0' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
              <span style={{ fontSize: '0.8rem', fontWeight: '700', color: '#334155' }}>Agent Turns</span>
              <span style={{ fontFamily: 'var(--font-mono)', fontWeight: '800', color: '#D97706' }}>{numTurns} turns</span>
            </div>
            <input
              type="range"
              min="2"
              max="10"
              step="1"
              value={numTurns}
              onChange={(e) => { setNumTurns(Number(e.target.value)); handleReset(); }}
            />
          </div>

          {/* Base System Prompt Tokens */}
          <div style={{ background: '#F8FAFC', padding: '14px', borderRadius: '10px', border: '1px solid #E2E8F0' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
              <span style={{ fontSize: '0.8rem', fontWeight: '700', color: '#334155' }}>Initial System Prompt</span>
              <span style={{ fontFamily: 'var(--font-mono)', fontWeight: '800', color: '#2563EB' }}>{basePromptTokens} tok</span>
            </div>
            <input
              type="range"
              min="500"
              max="10000"
              step="250"
              value={basePromptTokens}
              onChange={(e) => { setBasePromptTokens(Number(e.target.value)); handleReset(); }}
            />
          </div>

          {/* Tool Output Tokens per Turn */}
          <div style={{ background: '#F8FAFC', padding: '14px', borderRadius: '10px', border: '1px solid #E2E8F0' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
              <span style={{ fontSize: '0.8rem', fontWeight: '700', color: '#334155' }}>Tool Result / Turn</span>
              <span style={{ fontFamily: 'var(--font-mono)', fontWeight: '800', color: '#7C3AED' }}>+{toolOutputTokensPerTurn} tok</span>
            </div>
            <input
              type="range"
              min="100"
              max="3000"
              step="100"
              value={toolOutputTokensPerTurn}
              onChange={(e) => { setToolOutputTokensPerTurn(Number(e.target.value)); handleReset(); }}
            />
          </div>

          {/* Decode Tokens per Turn */}
          <div style={{ background: '#F8FAFC', padding: '14px', borderRadius: '10px', border: '1px solid #E2E8F0' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
              <span style={{ fontSize: '0.8rem', fontWeight: '700', color: '#334155' }}>Agent Thought / Turn</span>
              <span style={{ fontFamily: 'var(--font-mono)', fontWeight: '800', color: '#059669' }}>{decodeTokensPerTurn} tok</span>
            </div>
            <input
              type="range"
              min="50"
              max="1000"
              step="50"
              value={decodeTokensPerTurn}
              onChange={(e) => { setDecodeTokensPerTurn(Number(e.target.value)); handleReset(); }}
            />
          </div>

        </div>
      </div>

      {/* Main Agent Loop Simulation Stage */}
      <div className="material-card-elevated" style={{ padding: '24px', background: '#FFFFFF' }}>
        
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', flexWrap: 'wrap', gap: '12px' }}>
          <div>
            <span className="badge badge-agent" style={{ marginBottom: '6px' }}>
              Multi-Turn Agentic Loop
            </span>
            <h3 style={{ fontSize: '1.15rem', fontWeight: '800', color: '#0F172A' }}>
              Walltime Measurement Per Turn
            </h3>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
            <div style={{ fontSize: '0.9rem', color: '#334155' }}>
              Total Agent Walltime: <strong style={{ fontFamily: 'var(--font-mono)', fontSize: '1.2rem', color: '#0F172A' }}>{formatTime(totalAgentWalltime)}</strong>
            </div>

            <button
              onClick={() => setIsPlaying(!isPlaying)}
              style={{
                padding: '8px 18px',
                borderRadius: '8px',
                border: 'none',
                background: isPlaying ? '#F59E0B' : '#D97706',
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
              {isPlaying ? 'Pause' : 'Simulate Agent Loop'}
            </button>
          </div>
        </div>

        {/* Prefix Caching Time Savings Banner */}
        {enablePrefixCaching ? (
          <div style={{
            background: '#ECFDF5',
            border: '1px solid #A7F3D0',
            borderRadius: '10px',
            padding: '12px 16px',
            marginBottom: '20px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            fontSize: '0.85rem',
            color: '#065F46'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <CheckCircle size={18} color="#10B981" />
              <span>
                <strong>Prefix Caching Savings:</strong> Reduced total walltime from <strong>{formatTime(turnBreakdownNoCache)}</strong> to <strong>{formatTime(totalAgentWalltime)}</strong>!
              </span>
            </div>
            <span style={{ fontWeight: '800', background: '#10B981', color: '#FFFFFF', padding: '2px 8px', borderRadius: '6px', fontSize: '0.78rem' }}>
              Saved {formatTime(cachingTimeSaved)} ({cachingPercentSaved.toFixed(0)}%)
            </span>
          </div>
        ) : (
          <div style={{
            background: '#FFFBEB',
            border: '1px solid #FDE68A',
            borderRadius: '10px',
            padding: '12px 16px',
            marginBottom: '20px',
            fontSize: '0.85rem',
            color: '#92400E'
          }}>
            ⚠️ <strong>Prefix Caching Disabled:</strong> Every turn re-prefills the ENTIRE accumulated context history! Turn walltimes grow larger as history expands.
          </div>
        )}

        {/* Gantt / Waterfall Timeline Chart */}
        <div style={{ background: '#F8FAFC', padding: '16px', borderRadius: '12px', border: '1px solid #E2E8F0', marginBottom: '24px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
            <span style={{ fontSize: '0.82rem', fontWeight: '700', color: '#475569', textTransform: 'uppercase' }}>
              Turn-by-Turn Walltime Waterfall Chart (Prefill vs Decode)
            </span>
            <div style={{ display: 'flex', gap: '14px', fontSize: '0.75rem', fontWeight: '700' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: '4px', color: '#2563EB' }}>
                <span style={{ width: '10px', height: '10px', background: '#2563EB', borderRadius: '2px' }} /> Prefill Phase
              </span>
              <span style={{ display: 'flex', alignItems: 'center', gap: '4px', color: '#059669' }}>
                <span style={{ width: '10px', height: '10px', background: '#059669', borderRadius: '2px' }} /> Decode Phase
              </span>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {turnBreakdown.map((turnItem) => {
              const isCurrentTurn = activeTurn === turnItem.turn;
              const turnPrefillPctOfTotal = (turnItem.prefillTime / totalAgentWalltime) * 100;
              const turnDecodePctOfTotal = (turnItem.decodeTime / totalAgentWalltime) * 100;
              const prefillRatio = (turnItem.prefillTime / turnItem.turnWalltime) * 100;

              return (
                <div
                  key={turnItem.turn}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '12px',
                    padding: '8px 12px',
                    borderRadius: '8px',
                    background: isCurrentTurn ? '#FEF3C7' : '#FFFFFF',
                    border: `1px solid ${isCurrentTurn ? '#F59E0B' : '#E2E8F0'}`,
                    transition: 'all 0.15s ease'
                  }}
                >
                  <div style={{ width: '80px', flexShrink: 0 }}>
                    <div style={{ fontSize: '0.8rem', fontWeight: '800', color: '#0F172A' }}>
                      Turn {turnItem.turn}
                    </div>
                    <div style={{ fontSize: '0.68rem', color: '#64748B' }}>
                      {formatTokens(turnItem.totalPromptTokens)} tok prompt
                    </div>
                  </div>

                  {/* Waterfall Bar */}
                  <div style={{ flex: 1, height: '26px', background: '#F1F5F9', borderRadius: '6px', display: 'flex', overflow: 'hidden', position: 'relative' }}>
                    <div
                      style={{
                        width: `${(turnItem.turnWalltime / totalAgentWalltime) * 100}%`,
                        display: 'flex',
                        height: '100%'
                      }}
                    >
                      {/* Prefill segment */}
                      <div
                        style={{
                          width: `${prefillRatio}%`,
                          background: turnItem.isCached ? '#3B82F6' : '#1D4ED8',
                          height: '100%',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          color: '#FFFFFF',
                          fontSize: '0.68rem',
                          fontWeight: '700'
                        }}
                        title={`Turn ${turnItem.turn} Prefill: ${formatTime(turnItem.prefillTime)} (${turnItem.newTokensPrefilled} tok)`}
                      >
                        {prefillRatio > 15 && formatTime(turnItem.prefillTime)}
                      </div>

                      {/* Decode segment */}
                      <div
                        style={{
                          width: `${100 - prefillRatio}%`,
                          background: '#059669',
                          height: '100%',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          color: '#FFFFFF',
                          fontSize: '0.68rem',
                          fontWeight: '700'
                        }}
                        title={`Turn ${turnItem.turn} Decode: ${formatTime(turnItem.decodeTime)} (${turnItem.decodeTokens} tok)`}
                      >
                        {(100 - prefillRatio) > 15 && formatTime(turnItem.decodeTime)}
                      </div>
                    </div>
                  </div>

                  {/* Turn Walltime Total */}
                  <div style={{ width: '90px', textAlign: 'right', flexShrink: 0 }}>
                    <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.85rem', fontWeight: '800', color: '#0F172A' }}>
                      {formatTime(turnItem.turnWalltime)}
                    </div>
                    <div style={{ fontSize: '0.68rem', color: '#64748B' }}>
                      {turnItem.isCached ? '⚡ Cached' : 'Full Ingest'}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Detailed Per-Turn Metrics Table */}
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem', textAlign: 'left' }}>
            <thead>
              <tr style={{ background: '#F1F5F9', borderBottom: '2px solid #CBD5E1', color: '#475569' }}>
                <th style={{ padding: '10px 12px' }}>Turn #</th>
                <th style={{ padding: '10px 12px' }}>Agent Tool Phase</th>
                <th style={{ padding: '10px 12px' }}>Total History Context</th>
                <th style={{ padding: '10px 12px' }}>Prefilled Tokens</th>
                <th style={{ padding: '10px 12px' }}>Prefill Time</th>
                <th style={{ padding: '10px 12px' }}>Decode Time</th>
                <th style={{ padding: '10px 12px' }}>Turn Walltime</th>
                <th style={{ padding: '10px 12px' }}>Cumulative Walltime</th>
              </tr>
            </thead>
            <tbody>
              {turnBreakdown.map((t) => (
                <tr
                  key={t.turn}
                  style={{
                    borderBottom: '1px solid #E2E8F0',
                    background: activeTurn === t.turn ? '#FEF3C7' : 'transparent'
                  }}
                >
                  <td style={{ padding: '10px 12px', fontWeight: '800', color: '#0F172A' }}>
                    Turn {t.turn}
                  </td>
                  <td style={{ padding: '10px 12px', color: '#334155', fontWeight: '600' }}>
                    {t.label}
                  </td>
                  <td style={{ padding: '10px 12px', fontFamily: 'var(--font-mono)' }}>
                    {formatTokens(t.totalPromptTokens)} tok
                  </td>
                  <td style={{ padding: '10px 12px', fontFamily: 'var(--font-mono)', color: t.isCached ? '#2563EB' : '#1E40AF', fontWeight: '700' }}>
                    {formatTokens(t.newTokensPrefilled)} tok {t.isCached && '⚡'}
                  </td>
                  <td style={{ padding: '10px 12px', fontFamily: 'var(--font-mono)', color: '#2563EB' }}>
                    {formatTime(t.prefillTime)}
                  </td>
                  <td style={{ padding: '10px 12px', fontFamily: 'var(--font-mono)', color: '#059669' }}>
                    {formatTime(t.decodeTime)}
                  </td>
                  <td style={{ padding: '10px 12px', fontFamily: 'var(--font-mono)', fontWeight: '800', color: '#D97706' }}>
                    {formatTime(t.turnWalltime)}
                  </td>
                  <td style={{ padding: '10px 12px', fontFamily: 'var(--font-mono)', fontWeight: '800', color: '#0F172A' }}>
                    {formatTime(t.cumulativeWalltime)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

      </div>

    </div>
  );
}
