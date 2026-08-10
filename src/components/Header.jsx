import React from 'react';
import { Cpu, Zap, Bot, MessageSquare, Layers, HelpCircle, BarChart3, HardDrive } from 'lucide-react';
import { HARDWARE_PRESETS } from '../utils/presets';

export default function Header({ 
  activeTab, 
  setActiveTab, 
  selectedPreset, 
  setSelectedPreset,
  onApplyPreset 
}) {
  return (
    <header className="material-card-elevated" style={{ margin: '16px 16px 0 16px', padding: '16px 24px', background: '#FFFFFF' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '16px' }}>
        
        {/* Title & Brand */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          <div style={{
            width: '44px',
            height: '44px',
            borderRadius: '12px',
            background: 'linear-gradient(135deg, #4F46E5 0%, #2563EB 50%, #059669 100%)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#FFFFFF',
            boxShadow: '0 4px 12px rgba(79, 70, 229, 0.3)'
          }}>
            <Cpu size={26} />
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <h1 style={{ fontSize: '1.25rem', fontWeight: '800', color: '#0F172A', letterSpacing: '-0.02em' }}>
                LLM Prefill & Decode Speed Visualizer
              </h1>
              <span className="badge badge-neutral" style={{ fontSize: '0.7rem' }}>
                Material White
              </span>
            </div>
            <p style={{ fontSize: '0.85rem', color: '#475569', margin: '2px 0 0 0' }}>
              Measure Walltime, TTFT & TPOT across Single-Turn Chat and Multi-Turn Agentic Loops
            </p>
          </div>
        </div>

        {/* Preset Hardware Selector */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', background: '#F8FAFC', padding: '6px 12px', borderRadius: '12px', border: '1px solid #E2E8F0' }}>
          <Zap size={18} color="#4F46E5" />
          <span style={{ fontSize: '0.8rem', fontWeight: '700', color: '#475569' }}>Preset:</span>
          <select 
            value={selectedPreset} 
            onChange={(e) => {
              const pId = e.target.value;
              setSelectedPreset(pId);
              const found = HARDWARE_PRESETS.find(p => p.id === pId);
              if (found) onApplyPreset(found);
            }}
            style={{
              padding: '6px 12px',
              borderRadius: '8px',
              border: '1px solid #CBD5E1',
              background: '#FFFFFF',
              fontSize: '0.85rem',
              fontWeight: '600',
              color: '#0F172A',
              cursor: 'pointer',
              outline: 'none'
            }}
          >
            {HARDWARE_PRESETS.map(p => (
              <option key={p.id} value={p.id}>
                {p.icon} {p.name}
              </option>
            ))}
          </select>
        </div>

      </div>

      {/* Navigation Tabs */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        marginTop: '20px',
        borderTop: '1px solid #F1F5F9',
        paddingTop: '14px',
        overflowX: 'auto'
      }}>
        {[
          { id: 'single', label: 'Single-Turn Chat', icon: MessageSquare, badge: 'Standard' },
          { id: 'agentic', label: 'Agentic Multi-Turn Loop', icon: Bot, badge: 'Loop Walltime' },
          { id: 'compare', label: 'Hardware Comparison', icon: BarChart3, badge: 'Side-by-Side' },
          { id: 'kvcache', label: 'KV Cache Calculator', icon: HardDrive, badge: 'VRAM Usage' },
          { id: 'theory', label: 'Theory & Equations', icon: HelpCircle, badge: 'FLOPs vs BW' }
        ].map(tab => {
          const IconComponent = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '8px 16px',
                borderRadius: '10px',
                border: isActive ? '1px solid #6366F1' : '1px solid transparent',
                background: isActive ? '#EEF2FF' : 'transparent',
                color: isActive ? '#4F46E5' : '#475569',
                fontWeight: isActive ? '700' : '600',
                fontSize: '0.85rem',
                cursor: 'pointer',
                transition: 'all 0.15s ease',
                whiteSpace: 'nowrap'
              }}
            >
              <IconComponent size={17} color={isActive ? '#4F46E5' : '#64748B'} />
              <span>{tab.label}</span>
              {tab.badge && (
                <span style={{
                  fontSize: '0.68rem',
                  padding: '2px 6px',
                  borderRadius: '999px',
                  background: isActive ? '#4F46E5' : '#E2E8F0',
                  color: isActive ? '#FFFFFF' : '#475569',
                  fontWeight: '700'
                }}>
                  {tab.badge}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </header>
  );
}
