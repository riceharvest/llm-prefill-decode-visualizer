import { createHash } from 'node:crypto';
import { HARDWARE_PRESETS, SCENARIO_PRESETS } from '../../src/utils/presets.js';
import { enforceRateLimit } from '../_ratelimit.js';
import { sendJson, conditionalGet } from '../_schema.js';

export const config = { runtime: 'nodejs' };

/**
 * Stable content hash over the preset tables (#769/#786).
 * Agents citing "scenario chat = 2048/512" or a hardware speed can pin the
 * citation against this revision and detect drift without scraping diffs.
 */
function presetsRevision(hardware, scenarios) {
  return createHash('sha256')
    .update(JSON.stringify({ hardware, scenarios }))
    .digest('hex')
    .slice(0, 12);
}

export default function handler(req, res) {
  if (!enforceRateLimit(req, res)) return;
  // provenance: 'synthetic' marks marketing-estimate speeds (#782) — these
  // constants are NOT community medians and can disagree with
  // /api/benchmarks?groupBy=hardware by an order of magnitude.
  const hardware = HARDWARE_PRESETS.map(p => ({
    id: p.id,
    name: p.name,
    prefillSpeedTokPerSec: p.prefillSpeed,
    decodeSpeedTokPerSec: p.decodeSpeed,
    vramBandwidth: p.vramBandwidth,
    // Machine-readable fit-math inputs (#483): total VRAM and card count
    // as numbers (null where not applicable — cloud/custom), so agents can
    // do KV-cache fit checks against a preset without parsing the name.
    gpuModel: p.gpuModel ?? null,
    gpuCount: p.gpuCount ?? null,
    vramGbPerGpu: p.vramGbPerGpu ?? null,
    vramGbTotal: p.vramGbTotal ?? null,
    badge: p.badge,
    // Power/thermal guidance (#69): board power (TDP), typical whole-rig
    // wattage under sustained inference, and recommended PSU size —
    // null where not applicable (cloud/edge/custom).
    tdpWatts: p.tdpWatts ?? null,
    loadWatts: p.loadWatts ?? null,
    psuWatts: p.psuWatts ?? null,
    powerNote: p.powerNote ?? null,
    provenance: 'synthetic'
  }));
  const scenarios = SCENARIO_PRESETS.map(s => ({
    id: s.id,
    label: s.label,
    promptTokens: s.promptTokens,
    outputTokens: s.outputTokens
  }));
  const body = {
    description: 'Built-in hardware speed presets and workload scenario presets. Use these values as inputs to /api/compute.',
    presetsRevision: presetsRevision(hardware, scenarios),
    hardware,
    scenarios
  };
  // Validators (#615): same ETag / Last-Modified + 304 treatment as /api/spec.
  if (conditionalGet(req, res, body, { cacheTtl: 3600 })) return;
  return sendJson(res, body, { cacheTtl: 3600 });
}
