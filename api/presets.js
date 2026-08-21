import { HARDWARE_PRESETS, SCENARIO_PRESETS } from '../src/utils/presets.js';
import { etagFor, sendJson } from './_respond.js';

export const config = { runtime: 'nodejs' };

const PAYLOAD = {
  description: 'Built-in hardware speed presets and workload scenario presets. Use these values as inputs to /api/compute.',
  // Presets ship with the code, so their version is content-addressed and
  // changes only when the preset tables change — same reproducibility
  // contract as the dataset snapshots on the other data endpoints.
  version: null, // filled below
  buildTimestamp: new Date().toISOString(),
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
};
PAYLOAD.version = `presets-${etagFor(JSON.stringify(PAYLOAD)).replaceAll('"', '').slice(0, 12)}`;

export default function handler(req, res) {
  return sendJson(req, res, PAYLOAD, { cacheTtl: 3600 });
}
