// Vision-token inputs for KV-cache planning (#643).
//
// The Attached Images estimator (src/utils/multimodal.js) is pure math with
// no DOM deps, but until now no endpoint exposed it: agents could not plan a
// VLM workload's KV footprint (image tokens occupy the cache before the first
// text token). This module resolves the API spellings of that estimator:
//
//   ?visionTokens=19800          explicit total vision tokens
//   ?imgRes=4k&imgN=3            resolution preset × image count
//
// Resolution presets mirror IMAGE_RESOLUTION_PRESETS; tiles use the same
// ~1,100 tok/tile heuristic, ≥1 tile per image, capped at 6 tiles/image.
import {
  IMAGE_RESOLUTION_PRESETS,
  TOKENS_PER_TILE,
  MAX_TILES_PER_IMAGE,
  estimateImageTokens
} from '../src/utils/multimodal.js';
import { ApiError } from './_errors.js';

export const VISION_RESOLUTION_PRESETS = IMAGE_RESOLUTION_PRESETS;

function positiveInt(v) {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Resolve optional vision-token params. Returns null when none are present
 * (callers keep their legacy behavior byte-for-byte); throws ApiError 400 on
 * present-but-invalid values so bad input fails loudly instead of silently
 * planning an all-text cache.
 */
export function resolveVisionInputs(params = {}) {
  const hasExplicit = params.visionTokens != null;
  const hasImages = params.imgN != null || params.imgRes != null;
  if (!hasExplicit && !hasImages) return null;

  if (hasExplicit) {
    const visionTokens = positiveInt(params.visionTokens);
    if (visionTokens == null) {
      throw new ApiError('INVALID_PARAMS', `visionTokens must be a positive integer — got "${params.visionTokens}".`, {
        status: 400,
        extras: { param: 'visionTokens', value: String(params.visionTokens) }
      });
    }
    return { visionTokens, source: 'explicit' };
  }

  // Image-count / resolution-preset spelling.
  const imgN = params.imgN != null ? positiveInt(params.imgN) : null;
  if (params.imgN != null && imgN == null) {
    throw new ApiError('INVALID_PARAMS', `imgN must be a positive integer — got "${params.imgN}".`, {
      status: 400,
      extras: { param: 'imgN', value: String(params.imgN) }
    });
  }
  const count = imgN ?? 1;
  const resId = String(params.imgRes ?? '1080p').toLowerCase();
  const preset = VISION_RESOLUTION_PRESETS.find(p => p.id === resId);
  if (!preset) {
    throw new ApiError('INVALID_PARAMS', `Unknown imgRes '${resId}' — use one of the resolution presets.`, {
      status: 400,
      extras: { param: 'imgRes', available: VISION_RESOLUTION_PRESETS.map(p => p.id) }
    });
  }
  return {
    visionTokens: count * estimateImageTokens(preset),
    source: 'images',
    imageCount: count,
    resolution: preset.id,
    width: preset.width,
    height: preset.height,
    tokensPerImage: estimateImageTokens(preset),
    tokensPerTile: TOKENS_PER_TILE,
    maxTilesPerImage: MAX_TILES_PER_IMAGE
  };
}
