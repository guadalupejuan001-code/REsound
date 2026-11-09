import test from 'node:test';
import assert from 'node:assert/strict';
import { analyze, sampleAt, validate } from '../dist/audio-core.mjs';

const tone = (frequency, channel = 'L', options = {}) => ({ frequency, channel, gain: 1, phase: 0, enabled: true, ...options });
const config = (mode, tones = [tone(200, 'L'), tone(210, 'R')]) => ({ mode, tones });
const close = (actual, expected, tolerance = 1e-11) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} ≈ ${expected}`);
const evaluateSpectrum = (analysis, channel, t) => analysis.dc[channel] + analysis[channel].reduce((sum, c) => sum + c.cos * Math.cos(2 * Math.PI * c.frequency * t) + c.sin * Math.sin(2 * Math.PI * c.frequency * t), 0);

test('stereo routes one original component to each channel', () => {
  const a = analyze(config('stereo'));
  assert.deepEqual(a.left.map(c => c.frequency), [200]);
  assert.deepEqual(a.right.map(c => c.frequency), [210]);
  assert.equal(a.compCount, 2);
  assert.equal(a.differencePairs[0].difference, 10);
  assert.equal(a.left[0].sin, 1);
});

test('linear addition creates no 10-Hz or 410-Hz component', () => {
  const a = analyze(config('sum'));
  assert.deepEqual(a.frequencies, [200, 210]);
  assert.equal(a.left[0].sin, 0.5);
  assert.equal(a.left[1].sin, 0.5);
  assert.deepEqual(a.left, a.right);
  assert.equal(a.compCount, 2);
});

test('multiplication creates the known difference and sum with correct signs', () => {
  const a = analyze(config('multiply'));
  assert.deepEqual(a.frequencies, [10, 410]);
  assert.equal(a.left[0].cos, 0.5);
  assert.equal(a.left[1].cos, -0.5);
  assert.equal(a.left[0].sin, 0);
  assert.equal(a.compCount, 2);
  assert.deepEqual(analyze(config('multiply', [tone(200), tone(400, 'R')])).frequencies, [200, 600]);
});

test('same frequencies merge, cancel in antiphase, and multiply to DC plus double frequency', () => {
  assert.equal(analyze(config('sum', [tone(200), tone(200, 'R')])).compCount, 1);
  const zero = analyze(config('sum', [tone(200), tone(200, 'R', { phase: 180 })]));
  assert.equal(zero.compCount, 0);
  assert.equal(zero.dc.left, 0);
  const square = analyze(config('multiply', [tone(200), tone(200, 'R')]));
  assert.deepEqual(square.frequencies, [400]);
  assert.equal(square.dc.left, 0.5);
  assert.equal(square.dcCount, 1);
  assert.equal(square.left[0].cos, -0.5);
});

test('different phases reconstruct exactly and negatives of difference frequencies get correct sine signs', () => {
  const tones = [tone(90, 'L', { phase: 37, gain: 0.7 }), tone(200, 'L', { phase: 120, gain: 0.8 }), tone(210, 'R', { phase: 271, gain: 0.4 }), tone(400, 'R', { phase: -55, gain: 0.9 })];
  for (const mode of ['stereo', 'sum', 'multiply']) {
    const c = config(mode, tones), a = analyze(c);
    for (const t of [0, 0.0001, 0.0014, 0.003, 0.0097, 0.0364, -0.017]) {
      const sample = sampleAt(c, t);
      for (const ch of ['left', 'right']) close(evaluateSpectrum(a, ch, t), sample[ch]);
    }
  }
});

test('multiple tones multiply channel sums, not every tone in an N-way product', () => {
  const c = config('multiply', [tone(100, 'L'), tone(300, 'L'), tone(150, 'R')]);
  const a = analyze(c);
  assert.deepEqual(a.frequencies, [50, 150, 250, 450]);
  assert.equal(a.differencePairs.length, 3);
  for (let n = 0; n < 200; n++) {
    const t = n / 47991;
    const expected = 0.5 * (Math.sin(2 * Math.PI * 100 * t) + Math.sin(2 * Math.PI * 300 * t)) * Math.sin(2 * Math.PI * 150 * t);
    close(evaluateSpectrum(a, 'left', t), expected);
  }
});

test('DC is mathematical, routed correctly, and never counted as an oscillating tone', () => {
  const silentZero = analyze(config('stereo', [tone(0)]));
  assert.equal(silentZero.compCount, 0);
  assert.equal(silentZero.dc.left, 0);
  const c = config('multiply', [tone(0, 'L', { phase: 90 }), tone(200, 'R')]);
  const a = analyze(c);
  assert.deepEqual(a.frequencies, [200]);
  assert.equal(a.left[0].sin, 1);
  const dcOnly = config('sum', [tone(0, 'L', { phase: 90 })]);
  assert.equal(analyze(dcOnly).dc.left, 1);
  assert.equal(validate(dcOnly, 48000).warnings[0].code, 'DC');
});

test('disabled and zero-amplitude tones contribute no spectrum or difference pair', () => {
  const a = analyze(config('sum', [tone(200), tone(210, 'R', { enabled: false }), tone(220, 'R', { gain: 0 })]));
  assert.deepEqual(a.frequencies, [200]);
  assert.equal(a.inputCount, 1);
  assert.equal(a.differencePairs.length, 0);
});

test('normalization preserves quiet gain and bounds all output waveforms', () => {
  close(analyze(config('stereo', [tone(200, 'L', { gain: 0.1 })])).left[0].sin, 0.1);
  const tones = Array.from({ length: 12 }, (_, i) => tone(60 + i * 27, i % 2 ? 'L' : 'R', { phase: i * 31, gain: 0.5 + i }));
  for (const mode of ['stereo', 'sum', 'multiply']) {
    const c = config(mode, tones), a = analyze(c);
    assert.ok(a.rms.left <= 1 + 1e-14);
    assert.ok(a.rms.right <= 1 + 1e-14);
    for (let n = 0; n < 1300; n++) {
      const s = sampleAt(c, n / 19003);
      assert.ok(Math.abs(s.left) <= 1 + 1e-14);
      assert.ok(Math.abs(s.right) <= 1 + 1e-14);
    }
  }
});

test('empty channel makes multiplication silent', () => {
  const a = analyze(config('multiply', [tone(200)]));
  assert.deepEqual(a.frequencies, []);
  assert.equal(a.dc.left, 0);
  assert.deepEqual(sampleAt(config('multiply', [tone(200)]), 0.001), { left: 0, right: 0 });
});

test('Nyquist validation uses actual output, including nonlinear sum products', () => {
  assert.equal(validate(config('stereo', [tone(23000), tone(22000, 'R')]), 48000).ok, true);
  const multiplied = validate(config('multiply', [tone(23000), tone(22000, 'R')]), 48000);
  assert.equal(multiplied.ok, false);
  assert.equal(multiplied.errors[0].code, 'NYQUIST');
  assert.equal(validate(config('stereo', [tone(24000)]), 48000).ok, false);
  assert.equal(validate(config('stereo', [tone(1e8)])).ok, true);
  assert.equal(validate(config('sum', [tone(1e8), tone(1e8, 'R', { phase: 180 })]), 48000).ok, true);
});

test('invalid inputs fail explicitly; finite large gains normalize without overflow', () => {
  for (const bad of [NaN, Infinity, -1]) assert.equal(validate(config('stereo', [tone(bad)])).ok, false);
  assert.equal(validate(config('nope')).ok, false);
  assert.equal(validate(config('stereo'), 0).ok, false);
  assert.throws(() => analyze(config('stereo', [tone(NaN)])), RangeError);
  assert.throws(() => sampleAt(config('stereo'), Infinity), RangeError);
  const huge = analyze(config('sum', [tone(200, 'L', { gain: 1e308 }), tone(210, 'R', { gain: 1e308 })]));
  close(huge.left[0].amplitude, 0.5);
  close(huge.left[1].amplitude, 0.5);
  assert.equal(validate(config('multiply', [tone(1e308), tone(1e308, 'R')])).errors[0].code, 'NUMERIC_RANGE');
});

test('real tiny components survive; numerical cancellation residuals do not', () => {
  const small = analyze(config('stereo', [tone(200, 'L', { gain: 1e-18 })]));
  assert.equal(small.compCount, 1);
  close(small.left[0].amplitude, 1e-18, 1e-30);
  const cancel = analyze(config('sum', [tone(200, 'L', { phase: 37 }), tone(200, 'R', { phase: 217 })]));
  assert.equal(cancel.compCount, 0);
});
