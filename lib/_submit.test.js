import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateSubmission, checkDuplicates, queueSubmission } from './_submit.js';

const VALID = {
  model: 'unsloth/Qwen3.6-27B-GGUF',
  quant: 'Q4_K_M',
  hardware: 'Raspberry Pi 5 (16GB)',
  hwClass: 'cpu_only',
  prefillTokPerSec: 120,
  decodeTokPerSec: 8,
  provenance: { engineVersion: 'llama.cpp b6242', command: 'llama-bench -m qwen.gguf -p 512 -n 128' }
};

function base(overrides = {}) {
  return { ...VALID, ...overrides };
}

test('accepts a valid submission and normalizes it', () => {
  const { ok, errors, submission } = validateSubmission(base());
  assert.equal(ok, true, JSON.stringify(errors));
  assert.equal(submission.modelFamily, 'qwen3-6-27b');
  assert.equal(submission.quant, 'q4_k_m'); // normalized to lowercase
  assert.equal(submission.reviewStatus, 'pending_review');
  assert.equal(submission.provenance.engineVersion, 'llama.cpp b6242');
});

test('rejects missing required fields with machine-readable errors', () => {
  const { ok, errors } = validateSubmission({});
  assert.equal(ok, false);
  const fields = errors.map(e => e.field);
  for (const f of ['model', 'quant', 'hardware', 'hwClass', 'prefillTokPerSec', 'decodeTokPerSec']) {
    assert.ok(fields.includes(f), `missing error for ${f}`);
    assert.ok(errors.every(e => e.code && e.message), 'errors must carry code + message');
  }
});

test("rejects implausible speeds for the hardware class (99,999 tok/s on an RPi5)", () => {
  const r1 = validateSubmission(base({ prefillTokPerSec: 99999, decodeTokPerSec: 5000 }));
  assert.equal(r1.ok, false);
  assert.ok(r1.errors.some(e => e.field === 'prefillTokPerSec' && e.code === 'implausible'));

  const r2 = validateSubmission(base({ hwClass: 'discrete_gpu', prefillTokPerSec: 99999, decodeTokPerSec: 9000 }));
  assert.equal(r2.ok, true); // plausible on a discrete GPU
});

test('rejects decode faster than prefill', () => {
  const { ok, errors } = validateSubmission(base({ prefillTokPerSec: 50, decodeTokPerSec: 500 }));
  assert.equal(ok, false);
  assert.ok(errors.some(e => e.code === 'implausible' && e.field === 'decodeTokPerSec'));
});

test('rejects non-positive, non-numeric and wrong-typed values', () => {
  for (const speed of [0, -5, 'fast', null]) {
    assert.equal(validateSubmission(base({ prefillTokPerSec: speed })).ok, false);
  }
  assert.equal(validateSubmission(base({ provenance: 'llama.cpp' })).ok, false);
  assert.equal(validateSubmission([1, 2]).ok, false);
  assert.equal(validateSubmission(null).ok, false);
});

test('validates optional token counts', () => {
  assert.equal(validateSubmission(base({ promptTokens: 512, outputTokens: 128, contextLength: 8192 })).ok, true);
  assert.equal(validateSubmission(base({ promptTokens: -1 })).ok, false);
  assert.equal(validateSubmission(base({ outputTokens: 12.5 })).ok, false);
});

test('provenance is optional; unknown hwClass rejected', () => {
  const noProv = { ...VALID }; delete noProv.provenance;
  assert.equal(validateSubmission(noProv).ok, true);
  assert.equal(validateSubmission(base({ hwClass: 'quantum' })).ok, false);
});

// ---------- duplicate detection ----------

const EXISTING = [
  { modelFamily: 'qwen3-6-27b', quantization: 'q4_k_m', hardwareKey: 'raspberry-pi-5', hardware: 'Raspberry Pi 5', prefillTokPerSec: 122, decodeTokPerSec: 8 },
  { modelFamily: 'qwen3-6-27b', quantization: 'q4_k_m', hardwareKey: 'rtx-3090', hardware: 'RTX 3090', prefillTokPerSec: 20000, decodeTokPerSec: 110 }
];

test('flags near-duplicate runs (same combo, speeds within tolerance)', () => {
  const { submission } = validateSubmission(base());
  const { duplicate, similar } = checkDuplicates(submission, EXISTING);
  assert.ok(duplicate, 'expected duplicate against the RPi5 run');
  assert.equal(duplicate.hardwareKey, 'raspberry-pi-5');
  assert.equal(similar, null);
});

test('different speeds on same combo → similar, not duplicate', () => {
  const { submission } = validateSubmission(base({ prefillTokPerSec: 60, decodeTokPerSec: 4 }));
  const { duplicate, similar } = checkDuplicates(submission, EXISTING);
  assert.equal(duplicate, null);
  assert.ok(similar);
});

test('no match on different model/quant/hardware', () => {
  const { submission } = validateSubmission(base({ quant: 'iq2_xxs' }));
  const { duplicate, similar } = checkDuplicates(submission, EXISTING);
  assert.equal(duplicate, null);
  assert.equal(similar, null);
  assert.deepEqual(checkDuplicates(submission, null), { duplicate: null, similar: null });
});

// ---------- queue ----------

test('queueSubmission appends a record with id + pending status', async () => {
  const { mkdtempSync } = await import('node:fs');
  const { readFile } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const dir = mkdtempSync(join(tmpdir(), 'lm-sub-'));

  process.env.SUBMISSIONS_DIR = dir;
  try {
    const { submission } = validateSubmission(base());
    const record = await queueSubmission(submission);
    assert.match(record.submissionId, /^sub_/);
    assert.equal(record.reviewStatus, 'pending_review');

    const lines = (await readFile(join(dir, 'submissions.jsonl'), 'utf8')).trim().split('\n');
    assert.equal(lines.length, 1);
    assert.equal(JSON.parse(lines[0]).submissionId, record.submissionId);
  } finally {
    delete process.env.SUBMISSIONS_DIR;
  }
});
