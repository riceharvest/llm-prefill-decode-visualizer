/**
 * Context-scaling decay curve sampling (#720).
 *
 * The single-turn view renders the curve as SVG pixel coordinates only; this
 * helper produces the same sample set as plain {gen, tokps} values so the
 * data can be exposed in a ChartDataTable / data attributes alongside the
 * geometry.
 */
import { decodeSpeedAtContext } from './contextScaling.js';

export const CURVE_SAMPLES = 96;

/**
 * Sample generated-tokens → instantaneous decode speed along the decay curve.
 *
 * @param {object} opts
 * @param {number} opts.maxGen        x-axis extent (output tokens)
 * @param {boolean} opts.scaleEnabled whether context scaling is engaged
 * @param {number} opts.baseSpeed     effective decode speed at zero growth
 * @param {number} opts.prefillTokens total prefilled context tokens
 * @param {number} opts.ctxHalf       half-speed context length
 * @param {number} [opts.samples]     sample count (default CURVE_SAMPLES)
 * @returns {{gen: number, tokps: number}[]} samples.length + 1 points, gen
 *   uniformly spaced from 0 to maxGen inclusive.
 */
export function buildDecayCurveSamples({ maxGen, scaleEnabled, baseSpeed, prefillTokens, ctxHalf, samples = CURVE_SAMPLES }) {
  const safeMax = Math.max(1, maxGen || 0);
  return Array.from({ length: samples + 1 }, (_, i) => {
    const gen = (i / samples) * safeMax;
    const tokps = scaleEnabled
      ? decodeSpeedAtContext(baseSpeed, prefillTokens + gen, ctxHalf)
      : baseSpeed;
    return { gen, tokps };
  });
}
