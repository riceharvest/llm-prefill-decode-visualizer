// Shared query/body parameter parsing helpers (#688 #704 #713 #728).
//
// ONE boolean vocabulary across every documented endpoint: 1/true/yes/on vs
// 0/false/no/off — case-insensitive and whitespace-tolerant. Real booleans
// (POST JSON bodies) pass through untouched.
//
// parseBool() returns null for ABSENT or UNRECOGNIZED values so each caller
// can choose its own failure mode:
//   - ordinary filter flags: default to false and surface a warning
//     (see boolWarnings) so a typo is never silently discarded (#688);
//   - safety flags like dry_run: fail CLOSED with a 400 (#704).
//
// requireEnum() gives /api/runs, /api/export and friends one strict enum
// contract: unknown values are a 400 problem+json, never a silent fallback
// (#728).
import { ApiError } from './_errors.js';

export const BOOL_TRUE_WORDS = ['1', 'true', 'yes', 'on'];
export const BOOL_FALSE_WORDS = ['0', 'false', 'no', 'off'];
const TRUE_SET = new Set(BOOL_TRUE_WORDS);
const FALSE_SET = new Set(BOOL_FALSE_WORDS);

/** Human-readable accepted vocabulary for error messages. */
export const BOOL_WORDS = `${BOOL_TRUE_WORDS.join('/')} or ${BOOL_FALSE_WORDS.join('/')}`;

/**
 * parseBool(value) -> true | false | null
 * Accepts 1/true/yes/on and 0/false/no/off (case-insensitive, trimmed) plus
 * real booleans. Returns null when the value is absent OR unrecognized.
 */
export function parseBool(value) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  const s = String(value).trim().toLowerCase();
  if (TRUE_SET.has(s)) return true;
  if (FALSE_SET.has(s)) return false;
  return null;
}

/** True only when the value is present but NOT a recognized boolean. */
export function isUnrecognizedBool(value) {
  return value !== undefined && value !== null && value !== '' && parseBool(value) === null;
}

/**
 * Warning strings for unrecognized boolean params, ready to append to a
 * response's warnings[] array. entries: [[name, rawValue], ...].
 */
export function boolWarnings(entries = []) {
  return entries
    .filter(([, raw]) => isUnrecognizedBool(raw))
    .map(([name, raw]) => `${name}='${raw}' is not a recognized boolean (accepted: ${BOOL_WORDS}) — treated as absent`);
}

/**
 * Strict enum parser: returns the matching allowed value (case-insensitive,
 * trimmed), `fallback` for absent/empty, or throws 400 INVALID_PARAMS naming
 * the accepted set. Used by format= on /api/runs AND /api/export so the same
 * param name carries the same contract everywhere (#728).
 */
export function requireEnum(value, allowed, name, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  const v = String(value).trim().toLowerCase();
  const match = allowed.find(a => String(a).toLowerCase() === v);
  if (!match) {
    throw new ApiError('INVALID_PARAMS', `${name} must be one of ${allowed.map(a => `"${a}"`).join('|')}, got "${value}"`);
  }
  return match;
}
