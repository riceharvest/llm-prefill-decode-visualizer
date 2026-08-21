// Multimodal prompt-token estimation.
//
// Vision-language models don't tokenize images one-pixel-one-token: most
// production VLM encoders tile an image into ~1-megapixel patches, embed each
// tile as a fixed grid of vision tokens, and prepend those embeddings to the
// text prompt before prefill runs. Exact counts vary by encoder family
// (~760 tokens/MP for GPT-4o's 512px tiling, ~1300+/MP for high-res Claude,
// Qwen2-VL sits near ~320/MP after its 2x2 merge) — so this estimator uses the
// widely-cited planning heuristic of ~1,100 tokens per 1MP tile, which is the
// right order of magnitude when you need a TTFT budget rather than a bill.
//
// Two extra rules match real encoder behavior:
//  - Small images still cost a full tile: encoders pad anything below the
//    patch-grid minimum up to one tile of vision tokens.
//  - Very large images are capped: most APIs downscale beyond a few MP, so we
//    stop counting tiles past MAX_TILES_PER_IMAGE instead of scaling linearly.

// A "tile" is a 1024x1024 (≈1 megapixel) region — the granularity most tiled
// vision encoders effectively charge at.
export const TILE_SIDE_PIXELS = 1024;

// Planning heuristic: vision tokens charged per 1MP tile (see note above).
export const TOKENS_PER_TILE = 1100;

// Most hosted VLMs downscale oversized inputs rather than charging unbounded
// tiles; 6 tiles (~6MP, e.g. one 4K screenshot) is a sane ceiling.
export const MAX_TILES_PER_IMAGE = 6;

// Common attachment resolutions offered in the UI.
export const IMAGE_RESOLUTION_PRESETS = [
  { id: '720p', label: '720p · screenshot', width: 1280, height: 720 },
  { id: '1080p', label: '1080p · photo', width: 1920, height: 1080 },
  { id: '1440p', label: '1440p · dense chart', width: 2560, height: 1440 },
  { id: '4k', label: '4K · full page', width: 3840, height: 2160 }
];

function sanitizeDimension(value) {
  const n = Math.round(Number(value));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

// How many 1MP tiles an encoder charges for this image (>= 1, capped).
export function estimateImageTiles({ width, height } = {}) {
  const w = sanitizeDimension(width);
  const h = sanitizeDimension(height);
  if (w === 0 || h === 0) return 0;
  const rawTiles = (w * h) / (TILE_SIDE_PIXELS * TILE_SIDE_PIXELS);
  // Sub-tile images pad up to a full tile of vision tokens.
  return Math.min(MAX_TILES_PER_IMAGE, Math.max(1, Math.ceil(rawTiles)));
}

// Vision-encoder token estimate for a single image.
export function estimateImageTokens(image) {
  if (!image || typeof image !== 'object') return 0;
  return estimateImageTiles(image) * TOKENS_PER_TILE;
}

// Total vision tokens for a set of attached images (ignores null/empty slots).
export function estimateImagesTokens(images = []) {
  if (!Array.isArray(images)) return 0;
  return images.reduce((sum, img) => sum + estimateImageTokens(img), 0);
}
