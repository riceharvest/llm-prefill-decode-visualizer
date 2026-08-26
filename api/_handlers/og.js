// GET /api/og — auto-generated 1200x630 Open Graph chart image (#105).
//
// Every shared link gets a real chart preview instead of a bare domain card:
// hardware name, tok/s headline numbers (prefill/decode), TTFT/TPOT estimates
// and a tok/s bar chart across all hardware presets, with the shared config's
// preset highlighted. Rendered server-side with @vercel/og (satori) from the
// same URL params the app keeps in its shareable query string:
//   ?preset=<hardware-id>&prefill=<tok/s>&decode=<tok/s>&scenario=<preset-id>
//
// Responses are cached twice over: an in-memory LRU keyed by a sha256 of the
// normalized params (cheap on warm instances) and long-lived public
// Cache-Control headers so the CDN absorbs everything else.
import { createHash } from 'node:crypto';
import { ImageResponse } from '@vercel/og';
import { HARDWARE_PRESETS, SCENARIO_PRESETS } from '../../src/utils/presets.js';
import { sendProblemFromError } from '../_errors.js';
import { enforceRateLimit } from '../_ratelimit.js';

export const config = { runtime: 'nodejs' };

const WIDTH = 1200;
const HEIGHT = 630;

// In-memory render cache: hash -> PNG buffer. Small cap — each 1200x630 PNG
// is a few tens of KB, and configs are effectively unbounded via the URL.
const MAX_CACHE_ENTRIES = 200;
const renderCache = new Map();

/** Clamp to a sane positive speed; null when unusable so callers fall back. */
function clampSpeed(v, max = 1_000_000) {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.min(Math.round(n * 10) / 10, max);
}

/**
 * Normalize the incoming query params into a validated chart config.
 * Exported pure so unit tests can cover parsing without rendering.
 */
export function parseOgParams(searchParams) {
  const sp = searchParams || new URLSearchParams();

  // Hardware preset: unknown ids fall back to the default consumer preset,
  // mirroring the URL loader in App.jsx instead of blanking the card.
  const presetId = sp.get('preset');
  const preset = HARDWARE_PRESETS.find(p => p.id === presetId) ||
    HARDWARE_PRESETS.find(p => p.id === 'rtx4090_exl2');

  const prefill = clampSpeed(sp.get('prefill')) ?? preset.prefillSpeed;
  const decode = clampSpeed(sp.get('decode')) ?? preset.decodeSpeed;

  // Scenario preset: an explicitly-provided id that matches nothing is
  // REJECTED (handler returns 400) instead of silently rendering a chart
  // labeled with the chat fallback (#769) — a typo'd id used to produce a
  // confidently-wrong image byte-identical to omitting the param.
  const scenarioParam = sp.get('scenario');
  const scenario = SCENARIO_PRESETS.find(s => s.id === String(scenarioParam || '').toLowerCase()) ||
    SCENARIO_PRESETS.find(s => s.id === 'chat');
  const scenarioUnknown = Boolean(scenarioParam) &&
    !SCENARIO_PRESETS.some(s => s.id === String(scenarioParam).toLowerCase());
  const promptTokens = clampSpeed(sp.get('prompt'), 10_000_000) ?? scenario.promptTokens;

  return {
    preset,
    prefill,
    decode,
    scenarioLabel: scenario.label,
    promptTokens,
    scenarioRequested: scenarioUnknown ? String(scenarioParam) : null,
    scenarioUnknown
  };
}

/** Stable cache key: sha256 over the normalized config (not raw params). */
export function cacheKeyFor(configObj) {
  const canonical = JSON.stringify({
    p: configObj.preset.id,
    pf: configObj.prefill,
    dc: configObj.decode,
    sc: configObj.scenarioLabel,
    pt: configObj.promptTokens,
    v: 1 // bump to invalidate every cached image after a layout change
  });
  return createHash('sha256').update(canonical).digest('hex');
}

/** TTFT ≈ prompt tokens / prefill speed; TPOT ≈ 1000ms / decode speed. */
export function estimateLatencies(prefill, decode, promptTokens) {
  return {
    ttftMs: Math.round((promptTokens / prefill) * 1000),
    tpotMs: Math.round((1000 / decode) * 100) / 100
  };
}

/** Thousands-grouped number formatting for the headline figures. */
export function formatSpeed(n) {
  return Number(n).toLocaleString('en-US');
}

/** Rows shown in the card's bar chart (fits the 630px height). */
const CHART_ROWS = 6;

/** Fixed bar-track width in px; row bars are sized as a fraction of it. */
const BAR_TRACK_PX = 520;

/**
 * Bar-chart rows: decode tok/s of every hardware preset relative to the
 * fastest one, longest bar first, the shared config's preset highlighted.
 * Capped at CHART_ROWS; a highlighted preset outside the top slice replaces
 * the slowest shown row so the shared config is always visible.
 */
export function buildBars(selectedPresetId, decodeSpeed) {
  const rows = HARDWARE_PRESETS
    .map(p => ({ id: p.id, name: shortName(p.name), value: p.id === 'custom' ? decodeSpeed : p.decodeSpeed }))
    .sort((a, b) => b.value - a.value);
  const max = rows[0]?.value || 1;
  let shown = rows.slice(0, CHART_ROWS);
  const selected = rows.find(r => r.id === selectedPresetId);
  if (selected && !shown.some(r => r.id === selected.id)) {
    shown = [...shown.slice(0, CHART_ROWS - 1), selected].sort((a, b) => b.value - a.value);
  }
  return shown.map(r => ({
    ...r,
    pct: Math.max(4, Math.round((r.value / max) * 100)),
    highlight: r.id === selectedPresetId
  }));
}

/** First segment of a preset name, before the parenthetical qualifier. */
function shortName(name) {
  const m = String(name).match(/^[^(]+/);
  return (m ? m[0] : name).trim();
}

/** Satori-flavored JSX-free element tree for the card. Exported for tests. */
export function buildChartElement(cfg) {
  const { ttftMs, tpotMs } = estimateLatencies(cfg.prefill, cfg.decode, cfg.promptTokens);
  const bars = buildBars(cfg.preset.id, cfg.decode);
  const stat = (label, value) => ({
    type: 'div',
    props: {
      style: { display: 'flex', flexDirection: 'column', gap: '6px' },
      children: [
        { type: 'div', props: { style: { display: 'flex', fontSize: 20, color: '#8b93a7', letterSpacing: '0.08em' }, children: label } },
        { type: 'div', props: { style: { display: 'flex', fontSize: 44, fontWeight: 700, color: '#e8ecf5' }, children: value } }
      ]
    }
  });

  return {
    type: 'div',
    props: {
      style: {
        width: '100%', height: '100%', display: 'flex', flexDirection: 'column',
        justifyContent: 'space-between', padding: '48px 56px',
        background: 'linear-gradient(135deg, #0b1020 0%, #101a33 55%, #16264d 100%)',
        fontFamily: 'sans-serif', color: '#e8ecf5'
      },
      children: [
        // Header: brand + shared workload shape
        {
          type: 'div',
          props: {
            style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
            children: [
              { type: 'div', props: { style: { display: 'flex', fontSize: 26, fontWeight: 700, color: '#7dd3fc' }, children: 'LLM Prefill & Decode Visualizer' } },
              { type: 'div', props: { style: { display: 'flex', fontSize: 22, color: '#8b93a7' }, children: cfg.scenarioLabel } }
            ]
          }
        },
        // Headline: hardware + tok/s + latency estimates
        {
          type: 'div',
          props: {
            style: { display: 'flex', flexDirection: 'column', gap: '22px' },
            children: [
              { type: 'div', props: { style: { display: 'flex', fontSize: 52, fontWeight: 700 }, children: shortName(cfg.preset.name) } },
              {
                type: 'div',
                props: {
                  style: { display: 'flex', gap: '64px' },
                  children: [
                    stat('PREFILL', `${formatSpeed(cfg.prefill)} tok/s`),
                    stat('DECODE', `${formatSpeed(cfg.decode)} tok/s`),
                    stat('TTFT', `${formatSpeed(ttftMs)} ms`),
                    stat('TPOT', `${tpotMs} ms`)
                  ]
                }
              }
            ]
          }
        },
        // Bar chart: decode tok/s per hardware preset, shared one highlighted.
        // Fixed-px columns (label 320 / track 520 / value 110) so satori never
        // wraps labels or clips values at the card edge.
        {
          type: 'div',
          props: {
            style: { display: 'flex', flexDirection: 'column', gap: '10px' },
            children: bars.map(b => ({
              type: 'div',
              props: {
                style: { display: 'flex', alignItems: 'center', height: '30px' },
                children: [
                  {
                    type: 'div',
                    props: {
                      style: {
                        display: 'flex', width: '320px', fontSize: 21, whiteSpace: 'nowrap',
                        color: b.highlight ? '#7dd3fc' : '#8b93a7', fontWeight: b.highlight ? 700 : 400
                      },
                      children: b.name
                    }
                  },
                  { type: 'div', props: { style: { display: 'flex', width: '520px', height: '24px', marginRight: '16px' }, children: [
                    {
                      type: 'div',
                      props: {
                        style: {
                          display: 'flex', height: '24px',
                          width: `${Math.round((b.pct / 100) * BAR_TRACK_PX)}px`,
                          borderRadius: '6px',
                          background: b.highlight ? '#38bdf8' : '#24304f'
                        }
                      }
                    }
                  ] } },
                  { type: 'div', props: { style: { display: 'flex', width: '110px', fontSize: 21, color: b.highlight ? '#e8ecf5' : '#66708a' }, children: `${formatSpeed(b.value)}` } }
                ]
              }
            }))
          }
        }
      ]
    }
  };
}

async function renderPng(cfg) {
  const key = cacheKeyFor(cfg);
  if (renderCache.has(key)) return renderCache.get(key);

  const imageResponse = new ImageResponse(buildChartElement(cfg), {
    width: WIDTH,
    height: HEIGHT
  });
  const buf = Buffer.from(await imageResponse.arrayBuffer());

  renderCache.set(key, buf);
  if (renderCache.size > MAX_CACHE_ENTRIES) {
    // Map preserves insertion order; evict the oldest entry.
    renderCache.delete(renderCache.keys().next().value);
  }
  return buf;
}

export default async function handler(req, res) {
  // Rate-limit every /api/og request (incl. OPTIONS and 405 paths): each
  // unique param combination forces a full satori PNG render on cache miss,
  // so unthrottled access is a free CPU farm (#921). Same per-instance
  // fixed-window budget and X-RateLimit-* headers as every other endpoint.
  if (!enforceRateLimit(req, res)) return;
  try {
    if (req.method === 'OPTIONS') {
      res.statusCode = 204;
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
      return res.end();
    }
    if (req.method !== 'GET') {
      return sendProblemFromError(res, req, Object.assign(new Error('method not allowed'), {
        status: 405,
        code: 'METHOD_NOT_ALLOWED'
      }));
    }

    const url = new URL(req.url, 'http://localhost');
    const cfg = parseOgParams(url.searchParams);
    // Unknown scenario ids are rejected with problem+json instead of silently
    // rendering the chat fallback (#769).
    if (cfg.scenarioUnknown) {
      return sendProblemFromError(res, req, Object.assign(new Error(`unknown scenario id "${cfg.scenarioRequested}"`), {
        status: 400,
        code: 'UNKNOWN_SCENARIO'
      }));
    }
    const png = await renderPng(cfg);

    res.statusCode = 200;
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Content-Length', String(png.length));
    res.setHeader('Access-Control-Allow-Origin', '*');
    // Config-hash-addressed content: immutable at the CDN for a week,
    // stale-while-revalidate so shares always get a fast first byte.
    res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400, immutable');
    return res.end(png);
  } catch (err) {
    return sendProblemFromError(res, req, err);
  }
}
