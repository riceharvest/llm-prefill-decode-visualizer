import { HARDWARE_PRESETS, SCENARIO_PRESETS } from '../../src/utils/presets.js';
import { enforceRateLimit } from '../_ratelimit.js';
import { sendJson, conditionalGet } from '../_schema.js';

export const config = { runtime: 'nodejs' };

export default function handler(req, res) {
  if (!enforceRateLimit(req, res)) return;
  const body = {
    description: 'Built-in hardware speed presets and workload scenario presets. Use these values as inputs to /api/compute.',
    hardware: HARDWARE_PRESETS.map(p => ({
      id: p.id,
      name: p.name,
      prefillSpeedTokPerSec: p.prefillSpeed,
      decodeSpeedTokPerSec: p.decodeSpeed,
      vramBandwidth: p.vramBandwidth,
      badge: p.badge,
      // Power/thermal guidance (#69): board power (TDP), typical whole-rig
      // wattage under sustained inference, and recommended PSU size —
      // null where not applicable (cloud/edge/custom).
      tdpWatts: p.tdpWatts ?? null,
      loadWatts: p.loadWatts ?? null,
      psuWatts: p.psuWatts ?? null,
      powerNote: p.powerNote ?? null
    })),
    scenarios: SCENARIO_PRESETS.map(s => ({
      id: s.id,
      label: s.label,
      promptTokens: s.promptTokens,
      outputTokens: s.outputTokens
    }))
  };
  // Validators (#615): same ETag / Last-Modified + 304 treatment as /api/spec.
  if (conditionalGet(req, res, body, { cacheTtl: 3600 })) return;
  return sendJson(res, body, { cacheTtl: 3600 });
}
