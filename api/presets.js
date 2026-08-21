import { HARDWARE_PRESETS, SCENARIO_PRESETS } from '../src/utils/presets.js';
import { enforceRateLimit } from './_ratelimit.js';
import { sendJson } from './_schema.js';

export const config = { runtime: 'nodejs' };

export default function handler(req, res) {
  if (!enforceRateLimit(req, res)) return;
  return sendJson(res, {
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
  }, { cacheTtl: 3600 });
}
