// Minimal GGUF v2/v3 metadata reader: fetches the first chunk of a .gguf
// file over a HTTP range request and parses the header key-value section,
// so architecture numbers (block_count, head counts, embedding length) can
// be resolved from GGUF-only repos that ship no config.json.

import { fetchWithTimeout, UPSTREAM_TIMEOUTS } from './_upstream_timeout.js';

const INITIAL_BYTES = 256 * 1024;
const MAX_BYTES = 8 * 1024 * 1024;

const SCALAR_SIZE = {
  0: 1,  // uint8
  1: 1,  // int8
  2: 2,  // uint16
  3: 2,  // int16
  4: 4,  // uint32
  5: 4,  // int32
  6: 4,  // float32
  7: 1,  // bool
  10: 8, // uint64
  11: 8, // int64
  12: 8  // float64
};
const STRING_TYPE = 8;
const ARRAY_TYPE = 9;

async function fetchChunk(url, nBytes) {
  const res = await fetchWithTimeout(
    url,
    { headers: { range: `bytes=0-${nBytes - 1}` }, redirect: 'follow' },
    UPSTREAM_TIMEOUTS.ggufChunk
  );
  if (!res.ok && res.status !== 206) {
    throw Object.assign(new Error(`gguf fetch failed (${res.status}) for ${url}`), { status: 502 });
  }
  const buf = await res.arrayBuffer();
  return new DataView(buf);
}

/**
 * Read the metadata key/values from a .gguf file URL.
 * Grows the range request until the whole KV section fits.
 * Returns a plain object of top-level scalar/string keys (arrays skipped).
 */
export async function readGgufMetadata(url) {
  let nBytes = INITIAL_BYTES;
  while (true) {
    const view = await fetchChunk(url, nBytes);
    try {
      return parseMetadata(view);
    } catch (err) {
      if (!(err instanceof RangeError)) throw err;
      if (nBytes >= MAX_BYTES) {
        throw Object.assign(new Error('gguf metadata section exceeds 8MB — giving up'), { status: 502 });
      }
      nBytes *= 4;
    }
  }
}

function parseMetadata(view) {
  let off = 0;
  const magic = String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3));
  if (magic !== 'GGUF') throw new Error('not a GGUF file');
  off += 4;
  const version = view.getUint32(off, true);
  if (version < 2) throw new Error(`unsupported GGUF version ${version}`);
  off += 4;
  off += 8; // tensor_count (u64) — unused
  const kvCount = Number(view.getBigUint64(off, true));
  off += 8;

  const out = {};
  for (let i = 0; i < kvCount; i++) {
    const key = readString(view, off); off = key.nextOff;
    const type = view.getUint32(off, true); off += 4;
    const val = readValue(view, off, type); off = val.nextOff;
    out[key.value] = val.value;
  }
  return out;
}

function readString(view, off) {
  const len = Number(view.getBigUint64(off, true)); off += 8;
  if (off + len > view.byteLength) throw new RangeError('string past end of buffer');
  const value = new TextDecoder().decode(new Uint8Array(view.buffer, view.byteOffset + off, len));
  return { value, nextOff: off + len };
}

function readValue(view, off, type) {
  if (type === STRING_TYPE) return readString(view, off);

  if (type === ARRAY_TYPE) {
    const elemType = view.getUint32(off, true); off += 4;
    const count = Number(view.getBigUint64(off, true)); off += 8;
    if (elemType === STRING_TYPE) {
      for (let i = 0; i < count; i++) {
        const s = readString(view, off); off = s.nextOff;
      }
    } else if (elemType === ARRAY_TYPE) {
      throw new Error('nested gguf array metadata is unsupported'); // never seen in practice
    } else {
      off += count * SCALAR_SIZE[elemType];
    }
    if (off > view.byteLength) throw new RangeError('array past end of buffer');
    return { value: null, nextOff: off };
  }

  const size = SCALAR_SIZE[type];
  if (!size) throw new Error(`unknown gguf value type ${type}`);
  if (off + size > view.byteLength) throw new RangeError('scalar past end of buffer');
  let value;
  if (size === 1) value = view.getUint8(off);
  else if (size === 2) value = view.getUint16(off, true);
  else if (size === 4) value = type === 6 ? view.getFloat32(off, true) : view.getUint32(off, true);
  else value = Number(view.getBigUint64(off, true));
  return { value, nextOff: off + size };
}

/** Extract the architecture fields the VRAM math needs from GGUF keys. */
export function architectureFromGguf(meta) {
  const arch = meta['general.architecture'];
  if (!arch) return null;
  const numLayers = meta[`${arch}.block_count`];
  const hiddenSize = meta[`${arch}.embedding_length`];
  const numHeads = meta[`${arch}.attention.head_count`];
  if (![numLayers, hiddenSize, numHeads].every(Number.isFinite)) return null;
  const kvHeads = meta[`${arch}.attention.head_count_kv`] ?? numHeads;
  const headDim = meta[`${arch}.attention.key_length`] ?? hiddenSize / numHeads;
  return { numLayers, hiddenSize, numHeads, kvHeads, headDim };
}
