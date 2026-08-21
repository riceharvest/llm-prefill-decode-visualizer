import test from 'node:test';
import assert from 'node:assert/strict';

import {
  FAST_HUMAN_READER_TPS,
  HUMAN_TOKEN_GAP_MS,
  BLINK_SECONDS,
  throughputAnchor,
  ttftAnchor,
  tpotAnchor,
  walltimeAnchor
} from './readingAnchors.js';

test('constants match the calibrated fast-human-reader figure', () => {
  assert.equal(FAST_HUMAN_READER_TPS, 330);
  // 250 wpm ≈ 330 tok/s ⇒ ~3 ms per token.
  assert.ok(Math.abs(HUMAN_TOKEN_GAP_MS - 1000 / 330) < 1e-9);
  assert.ok(BLINK_SECONDS > 0.1 && BLINK_SECONDS < 0.4);
});

test('throughputAnchor compares against the fast human reader', () => {
  // 2× the reader's pace.
  assert.equal(
    throughputAnchor(660),
    '≈2.0× faster than a fast human reader (~330 tok/s)'
  );
  // Well below reading pace.
  assert.match(throughputAnchor(50), /slower than a fast human reader/);
  // Within ±15% reads as "the same pace".
  assert.equal(throughputAnchor(330), 'About the pace of a fast human reader (~330 tok/s)');
  assert.equal(throughputAnchor(350), 'About the pace of a fast human reader (~330 tok/s)');
});

test('throughputAnchor rejects invalid inputs', () => {
  for (const bad of [0, -5, NaN, Infinity, undefined, null]) {
    assert.equal(throughputAnchor(bad), null);
  }
});

test('ttftAnchor: sub-blink TTFT is shorter than a blink', () => {
  assert.equal(ttftAnchor(0.05, 2048), 'Shorter than a blink');
});

test('ttftAnchor: long waits compare to skimming the prompt', () => {
  // 4096-token prompt takes a fast reader ≈12.4 s; a 30 s TTFT is ≥2× that.
  const anchor = ttftAnchor(30, 4096);
  assert.match(anchor, /skims this prompt in 12 s/);
  // Mid-range TTFT gets its own tier.
  assert.equal(ttftAnchor(1, 2048), 'Longer than a blink, shorter than a coffee sip');
  // Very long wait without prompt info still renders something sane.
  assert.equal(ttftAnchor(90), '2 min before the first word appears');
});

test('ttftAnchor rejects invalid inputs', () => {
  for (const bad of [-1, NaN, Infinity, undefined, null]) {
    assert.equal(ttftAnchor(bad, 2048), null);
  }
});

test('tpotAnchor compares token cadence to reader pace', () => {
  assert.equal(tpotAnchor(2), 'Faster than a fast reader can absorb tokens');
  assert.equal(tpotAnchor(HUMAN_TOKEN_GAP_MS * 1.05), 'About the cadence of a fast human reader');
  assert.match(tpotAnchor(33.0), /10\.9× slower than a fast reader reads/);
  assert.equal(tpotAnchor(0), null);
  assert.equal(tpotAnchor(NaN), null);
});

test('walltimeAnchor compares answer delivery to human reading time', () => {
  // 512 tokens take a fast reader ≈1.55 s; delivering in 10 s is slower.
  const slow = walltimeAnchor(10, 512);
  assert.match(slow, /fast reader/);
  assert.match(slow, /6\.4× less time \(1\.6 s\)/);
  // Delivering far faster than reading pace.
  const fast = walltimeAnchor(0.2, 512);
  assert.match(fast, /≈7\.8× sooner/);
  // Same-pace band.
  assert.equal(
    walltimeAnchor(512 / FAST_HUMAN_READER_TPS, 512),
    'About what a fast reader needs to read this answer'
  );
  assert.equal(walltimeAnchor(10, 0), null);
  assert.equal(walltimeAnchor(0, 512), null);
  assert.equal(walltimeAnchor(NaN, 512), null);
});
