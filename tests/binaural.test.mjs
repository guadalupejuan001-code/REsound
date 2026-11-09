import { test } from 'node:test';
import assert from 'node:assert/strict';
import { binauralTones, inferBinaural } from '../dist/binaural.mjs';
import { analyze } from '../dist/audio-core.mjs';

test('automatic mode preserves separate ears and never emits the difference as a third tone', () => {
  const config = { mode: 'stereo', tones: binauralTones(200, 10) };
  const result = analyze(config);
  assert.deepEqual(result.left.map(part => part.frequency), [200]);
  assert.deepEqual(result.right.map(part => part.frequency), [210]);
  assert.deepEqual(result.frequencies, [200, 210]);
});

test('decimal, zero and negative differences retain the requested ear assignment', () => {
  assert.equal(binauralTones(200, 7.83)[1].frequency, 207.83);
  assert.deepEqual(binauralTones(200, 0).map(tone => tone.frequency), [200, 200]);
  assert.deepEqual(binauralTones(200, -10).map(tone => tone.frequency), [200, 190]);
  assert.throws(() => binauralTones(200, -201), RangeError);
  assert.throws(() => binauralTones(NaN, 10), RangeError);
  assert.throws(() => binauralTones(200, Infinity), RangeError);
});

test('session migration only links compatible independent stereo pairs', () => {
  const config = { mode: 'stereo', tones: binauralTones(200, 7.83) };
  const result = inferBinaural(config);
  assert.equal(result.baseFrequency, 200);
  assert.ok(Math.abs(result.beatFrequency - 7.83) < 1e-12);
  assert.equal(inferBinaural({ ...config, mode: 'sum' }), null);
  assert.equal(inferBinaural({ ...config, tones: [...config.tones, config.tones[0]] }), null);
  assert.equal(inferBinaural({ ...config, tones: config.tones.map(t => ({ ...t, phase: 90 })) }), null);
});
