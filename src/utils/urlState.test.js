import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseBoolParam, readParamBool,
  parsePositiveNum,
  ogImageParams, readKvBatchSize
} from './urlState.js';

// ---- #432: boolean share-link params must accept common human spellings ----

test('#432 truthy spellings beyond 1/true are honored', () => {
  for (const v of ['1', 'true', 'True', 'TRUE', 'yes', 'Yes', 'on', 'ON', 'y', 't']) {
    assert.equal(parseBoolParam(v, false), true, `value ${v} should be true`);
  }
});

test('#432 explicit falsy spellings are honored', () => {
  for (const v of ['0', 'false', 'False', 'no', 'NO', 'off', 'n', 'f']) {
    assert.equal(parseBoolParam(v, true), false, `value ${v} should be false`);
  }
});

test('#432 unrecognized values fall back instead of silently disabling', () => {
  assert.equal(parseBoolParam('maybe', true), true);
  assert.equal(parseBoolParam('2', false), false);
  assert.equal(parseBoolParam(null, true), true);
  assert.equal(parseBoolParam('', false), false);
  assert.equal(parseBoolParam(undefined, true), true);
});

// ---- #434: prefill/decode URL values are physical tok/s and must be positive ----

test('#434 zero, negative and garbage speed values fall back to the default', () => {
  assert.equal(parsePositiveNum('0', 471), 471);
  assert.equal(parsePositiveNum('-500', 105), 105);
  assert.equal(parsePositiveNum('-0', 42), 42);
  assert.equal(parsePositiveNum('abc', 7), 7);
  assert.equal(parsePositiveNum('NaN', 7), 7);
  assert.equal(parsePositiveNum('Infinity', 7), 7);
  assert.equal(parsePositiveNum(null, 9), 9);
  assert.equal(parsePositiveNum('', 9), 9);
});

test('#434 valid positive speeds pass through unchanged', () => {
  assert.equal(parsePositiveNum('3800', 1), 3800);
  assert.equal(parsePositiveNum('0.5', 1), 0.5);
  assert.equal(parsePositiveNum('120000', 1), 120000);
});

// ---- #431: KV-cache tab owns ?kvb= so it cannot clobber Compare's ?batch= ----

test('#431 kvb= is the KV-cache tab batch param', () => {
  assert.equal(readKvBatchSize('?kvb=4'), 4);
  assert.equal(readKvBatchSize('?model=llama70b&kvb=8&ctx=32768'), 8);
});

test('#431 legacy kvcache links using batch= still restore when Compare state is absent', () => {
  assert.equal(readKvBatchSize('?batch=6'), 6);
  assert.equal(readKvBatchSize('?model=llama70b&batch=6'), 6);
});

test('#431 batch= carrying Compare-tab state is NOT adopted by the KV-cache tab', () => {
  assert.equal(readKvBatchSize('?hwA=groq&hwB=rtx4090_exl2&batch=12'), 1);
  assert.equal(readKvBatchSize('?hwB=rtx4090_exl2&batch=12'), 1);
});

test('#431 invalid kvb values fall back to 1', () => {
  assert.equal(readKvBatchSize('?kvb=0'), 1);
  assert.equal(readKvBatchSize('?kvb=-3'), 1);
  assert.equal(readKvBatchSize('?kvb=abc'), 1);
  assert.equal(readKvBatchSize('?'), 1);
});

// ---- #435: og:image carries the workload params /api/og honors ----

test('#435 og image query always carries preset/prefill/decode', () => {
  const qs = ogImageParams('', { preset: 'mi300x_fp8', prefill: 9000, decode: 220 });
  assert.equal(qs.get('preset'), 'mi300x_fp8');
  assert.equal(qs.get('prefill'), '9000');
  assert.equal(qs.get('decode'), '220');
});

test('#435 positive ?prompt= passes through to the preview card', () => {
  const qs = ogImageParams('?tab=single&prompt=32000&decode=105', {
    preset: 'rtx4090_exl2', prefill: 10000, decode: 105
  });
  assert.equal(qs.get('prompt'), '32000');
});

test('#435 absent or invalid ?prompt= stays out of the og query', () => {
  for (const search of ['', '?tab=agentic', '?prompt=0', '?prompt=-5', '?prompt=abc']) {
    const qs = ogImageParams(search, { preset: 'p', prefill: 1, decode: 2 });
    assert.equal(qs.get('prompt'), null, `search "${search}" should omit prompt`);
  }
});
