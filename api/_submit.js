// Shared engine for POST /api/localmaxxing run submissions:
// schema validation, sanity bounds, duplicate detection, and review queueing.
// Pure logic — no Vercel/req/res dependencies — so it can be unit-tested.

import { normalizeModelId } from './_normalize.js';

const HW_CLASSES = ['discrete_gpu', 'unified', 'cpu_only'];

// Sanity bounds per hardware class (tok/s). Single-stream decode is always
// slower than prefill, and no class comes near these ceilings — a claimed
// 99,999 tok/s on an RPi5 fails here.
const CLASS_BOUNDS = {
  discrete_gpu:  { prefillMax: 1_000_000, decodeMax: 200_000 },
  unified:       { prefillMax:    50_000, decodeMax:  20_000 },
  cpu_only:      { prefillMax:     5_000, decodeMax:   1_000 }
};

const STRING_LIMITS = {
  model: 160, quant: 60, hardware: 160, engine: 80,
  submitter: 80, 'provenance.engineVersion': 80,
  'provenance.command': 500, 'provenance.sourceUrl': 300, 'provenance.notes': 1000
};

const MAX_BODY_CHARS = 16 * 1024;

function isBlank(v) {
  return v === undefined || v === null || (typeof v === 'string' && v.trim() === '');
}

function checkString(errors, body, path) {
  const v = body[path];
  if (isBlank(v)) {
    errors.push({ field: path, code: 'required', message: `'${path}' is required` });
    return null;
  }
  if (typeof v !== 'string') {
    errors.push({ field: path, code: 'type', message: `'${path}' must be a string` });
    return null;
  }
  const max = STRING_LIMITS[path];
  if (max && v.length > max) {
    errors.push({ field: path, code: 'too_long', message: `'${path}' exceeds ${max} characters` });
    return null;
  }
  return v.trim();
}

function checkInt(errors, body, path, { min, max }) {
  const v = body[path];
  if (isBlank(v)) return null; // optional field
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) {
    errors.push({ field: path, code: 'out_of_range', message: `'${path}' must be an integer between ${min} and ${max}` });
    return null;
  }
  return n;
}

/**
 * Validate a submission body against the schema.
 * Returns { ok, errors, submission } — submission is null unless ok.
 */
export function validateSubmission(body) {
  const errors = [];
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, errors: [{ field: 'body', code: 'type', message: 'request body must be a JSON object' }], submission: null };
  }
  if (JSON.stringify(body).length > MAX_BODY_CHARS) {
    return { ok: false, errors: [{ field: 'body', code: 'too_large', message: `request body exceeds ${MAX_BODY_CHARS} bytes` }], submission: null };
  }

  const model = checkString(errors, body, 'model');
  const quant = checkString(errors, body, 'quant');
  const hardware = checkString(errors, body, 'hardware');
  const engine = isBlank(body.engine) ? null : checkString(errors, { engine: body.engine }, 'engine');
  const submitter = isBlank(body.submitter) ? null : checkString(errors, { submitter: body.submitter }, 'submitter');

  // hwClass: required enum (drives the sanity bounds below)
  const hwClassRaw = body.hwClass;
  if (isBlank(hwClassRaw)) {
    errors.push({ field: 'hwClass', code: 'required', message: `'hwClass' is required (one of: ${HW_CLASSES.join(', ')})` });
  } else if (!HW_CLASSES.includes(String(hwClassRaw).toLowerCase())) {
    errors.push({ field: 'hwClass', code: 'invalid_value', message: `'hwClass' must be one of: ${HW_CLASSES.join(', ')}` });
  }
  const hwClass = isBlank(hwClassRaw) ? null : String(hwClassRaw).toLowerCase();

  // Speeds: required, positive, finite, and plausible for the hardware class
  const speeds = {};
  for (const [field, label] of [['prefillTokPerSec', 'prefill'], ['decodeTokPerSec', 'decode']]) {
    const v = body[field];
    if (isBlank(v) || !Number.isFinite(Number(v)) || Number(v) <= 0) {
      errors.push({ field, code: isBlank(v) ? 'required' : 'invalid_value', message: `'${field}' must be a positive number (${label} tok/s)` });
      continue;
    }
    const n = Number(v);
    const bounds = CLASS_BOUNDS[hwClass];
    if (bounds && n > bounds[field === 'prefillTokPerSec' ? 'prefillMax' : 'decodeMax']) {
      errors.push({ field, code: 'implausible', message: `'${field}' of ${n} tok/s is implausible for hwClass '${hwClass}' (max ${field === 'prefillTokPerSec' ? bounds.prefillMax : bounds.decodeMax})` });
      continue;
    }
    speeds[field] = n;
  }
  if (Number.isFinite(speeds.prefillTokPerSec) && Number.isFinite(speeds.decodeTokPerSec)
    && speeds.decodeTokPerSec > speeds.prefillTokPerSec) {
    errors.push({ field: 'decodeTokPerSec', code: 'implausible', message: `'decodeTokPerSec' (${speeds.decodeTokPerSec}) cannot exceed 'prefillTokPerSec' (${speeds.prefillTokPerSec}) in single-stream inference` });
  }

  const promptTokens = checkInt(errors, body, 'promptTokens', { min: 1, max: 10_000_000 });
  const outputTokens = checkInt(errors, body, 'outputTokens', { min: 1, max: 1_000_000 });
  const contextLength = checkInt(errors, body, 'contextLength', { min: 1, max: 100_000_000 });

  // Optional provenance block
  let provenance = null;
  if (body.provenance !== undefined && body.provenance !== null) {
    if (typeof body.provenance !== 'object' || Array.isArray(body.provenance)) {
      errors.push({ field: 'provenance', code: 'type', message: `'provenance' must be an object` });
    } else {
      const p = {};
      for (const key of ['engineVersion', 'command', 'sourceUrl', 'notes']) {
        const v = body.provenance[key];
        if (isBlank(v)) continue;
        const path = `provenance.${key}`;
        const max = STRING_LIMITS[path];
        if (typeof v !== 'string' || v.length > max) {
          errors.push({ field: path, code: typeof v !== 'string' ? 'type' : 'too_long', message: `'${path}' must be a string of at most ${max} characters` });
          continue;
        }
        p[key] = v.trim();
      }
      provenance = Object.keys(p).length ? p : null;
    }
  }

  if (errors.length) return { ok: false, errors, submission: null };

  return {
    ok: true,
    errors: [],
    submission: {
      model,
      modelFamily: normalizeModelId(model),
      quant: quant.toLowerCase(),
      hardware,
      hwClass,
      prefillTokPerSec: speeds.prefillTokPerSec,
      decodeTokPerSec: speeds.decodeTokPerSec,
      ...(engine ? { engine } : {}),
      ...(promptTokens != null ? { promptTokens } : {}),
      ...(outputTokens != null ? { outputTokens } : {}),
      ...(contextLength != null ? { contextLength } : {}),
      ...(provenance ? { provenance } : {}),
      ...(submitter ? { submitter } : {}),
      submittedAt: new Date().toISOString(),
      reviewStatus: 'pending_review'
    }
  };
}

/**
 * Duplicate / near-duplicate detection against existing comparable runs.
 * Returns { duplicate: run|null, similar: run|null }.
 *  - duplicate: same model family + quant + hardware key AND both speeds
 *    within 10% → reject.
 *  - similar: same combo but different speeds → allow, but surface as a warning.
 */
export function checkDuplicates(submission, existingRuns, tolerance = 0.10) {
  const normHw = s => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const out = { duplicate: null, similar: null };
  if (!Array.isArray(existingRuns)) return out;

  const hwKey = normHw(submission.hardware);
  const matches = existingRuns.filter(r =>
    r.modelFamily === submission.modelFamily
    && (r.quantization || '').toLowerCase() === submission.quant
    && [normHw(r.hardwareKey), normHw(r.hardware)].some(m => m && (hwKey.includes(m) || m.includes(hwKey)))
  );
  if (!matches.length) return out;

  const near = (a, b) => Math.abs(a - b) <= tolerance * Math.max(a, b);
  out.duplicate = matches.find(r =>
    near(r.prefillTokPerSec, submission.prefillTokPerSec)
    && near(r.decodeTokPerSec, submission.decodeTokPerSec)
  ) || null;
  if (!out.duplicate) out.similar = matches[0];
  return out;
}

// ---------- Review queue ----------

const QUEUE_FILE = 'submissions.jsonl';

function queuePath() {
  const dir = process.env.SUBMISSIONS_DIR || '/tmp';
  return `${dir.replace(/\/$/, '')}/${QUEUE_FILE}`;
}

/**
 * Append a validated submission to the review queue (JSONL, one per line).
 * Submissions are NEVER published to the read APIs directly — they wait for
 * manual review. On Vercel the filesystem is ephemeral, so the queue file is
 * per-instance; point SUBMISSIONS_DIR at a mounted volume to persist.
 */
export async function queueSubmission(submission) {
  const record = { submissionId: newId(), ...submission };
  const { appendFile } = await import('node:fs/promises');
  await appendFile(queuePath(), JSON.stringify(record) + '\n', 'utf8');
  return record;
}

function newId() {
  const t = Date.now().toString(36);
  const r = Math.random().toString(36).slice(2, 8);
  return `sub_${t}_${r}`;
}
