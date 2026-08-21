import { HARDWARE_PRESETS, SCENARIO_PRESETS } from '../src/utils/presets.js';

export const config = { runtime: 'nodejs' };

export default function handler(req, res) {
  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.end(JSON.stringify({
    description: 'Built-in hardware speed presets and workload scenario presets. Use these values as inputs to /api/compute.',
    hardware: HARDWARE_PRESETS.map(p => ({
      id: p.id,
      name: p.name,
      prefillSpeedTokPerSec: p.prefillSpeed,
      decodeSpeedTokPerSec: p.decodeSpeed,
      vramBandwidth: p.vramBandwidth,
      badge: p.badge
    })),
    scenarios: SCENARIO_PRESETS.map(s => ({
      id: s.id,
      label: s.label,
      promptTokens: s.promptTokens,
      outputTokens: s.outputTokens
    }))
  }, null, 2));
}
