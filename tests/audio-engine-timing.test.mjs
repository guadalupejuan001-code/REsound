import test from 'node:test';
import assert from 'node:assert/strict';
import { analyze } from '../dist/audio-core.mjs';
import { AudioEngine, createAudioGraph } from '../dist/audio-engine.mjs';

// A tiny audio-clock model: evaluate the *resulting gain over time*, not merely
// which AudioParam methods were called. Browser spectral QA covers real sound.
class ClockParameter {
  constructor(context, value) { this.context = context; this.initial = value; this.events = []; }
  get value() { return this.at(this.context.currentTime); }
  set value(value) { this.initial = value; }
  setValueAtTime(value, time) { this.events.push({ type: 'set', value, time }); this.sort(); return this; }
  linearRampToValueAtTime(value, time) { this.events.push({ type: 'ramp', value, time }); this.sort(); return this; }
  sort() { this.events.sort((a, b) => a.time - b.time); }
  at(time) {
    let previous = { value: this.initial, time: 0 };
    for (const event of this.events) {
      if (event.time > time) {
        if (event.type === 'ramp') {
          const ratio = (time - previous.time) / (event.time - previous.time);
          return previous.value + ratio * (event.value - previous.value);
        }
        return previous.value;
      }
      previous = event;
    }
    return previous.value;
  }
  cancelScheduledValues(time) { this.events = this.events.filter(event => event.time < time); return this; }
  cancelAndHoldAtTime(time) {
    const held = this.at(time);
    this.cancelScheduledValues(time);
    this.setValueAtTime(held, time);
    return this;
  }
}

function context() {
  const ctx = { currentTime: 0, sampleRate: 48000, destination: {} };
  const node = () => ({ connect() {}, disconnect() {} });
  ctx.createGain = () => ({ ...node(), gain: new ClockParameter(ctx, 1) });
  ctx.createChannelMerger = node;
  ctx.createPeriodicWave = () => ({});
  ctx.createOscillator = () => ({ ...node(), frequency: new ClockParameter(ctx, 440), setPeriodicWave() {}, start() {}, stop() {} });
  return ctx;
}

function runningEngine(t) {
  t.mock.method(globalThis, 'setTimeout', () => 1);
  t.mock.method(globalThis, 'clearTimeout', () => {});
  const ctx = context();
  const analysis = analyze({ mode: 'stereo', tones: [{ frequency: 200, channel: 'L', gain: 1, phase: 0 }] });
  const engine = new AudioEngine();
  engine.context = ctx;
  engine.graph = createAudioGraph(ctx, analysis, { volume: 0.08 });
  engine.running = true;
  engine.volume = 0.08;
  engine.startedAt = 0;
  engine.duration = 60;
  engine.armDeadline();
  return engine;
}

test('adjusting volume before oscillator start cannot expose the default unity gain', t => {
  const engine = runningEngine(t);
  const parameter = engine.graph.master.gain;
  engine.context.currentTime = 0.005; // Source starts at 0.015 seconds.
  engine.setVolume(0.04);
  for (let time = 0.015; time < 0.1; time += 0.001) {
    assert.ok(parameter.at(time) >= 0, 'Gain is nonnegative.');
    assert.ok(parameter.at(time) <= 0.04 + 1e-12, `Gain ${parameter.at(time)} exceeds requested 4% at ${time}s.`);
  }
});

test('extending or disabling duration during its final fade removes the old deadline', t => {
  for (const newDuration of [180, 0]) {
    const engine = runningEngine(t);
    const parameter = engine.graph.master.gain;
    engine.context.currentTime = 59.97; // Halfway through the original final fade.
    const held = parameter.at(59.97);
    assert.ok(held > 0 && held < 0.08);
    engine.setDuration(newDuration);
    for (let time = 59.97; time < 60.15; time += 0.001) {
      assert.ok(parameter.at(time) >= held - 1e-12, `Old deadline caused gain to fall at ${time}s.`);
      assert.ok(parameter.at(time) <= 0.08 + 1e-12, 'Gain remains at or below requested 8%.');
      assert.ok(Math.abs(parameter.at(time + 0.000001) - parameter.at(time)) < 0.00001, `Abrupt gain jump at ${time}s.`);
    }
    assert.ok(Math.abs(parameter.at(60.15) - 0.08) < 1e-12);
    if (newDuration) {
      assert.ok(Math.abs(parameter.at(newDuration)) < 1e-12, 'New deadline still reaches silence.');
    } else {
      assert.ok(Math.abs(parameter.at(180) - 0.08) < 1e-12, 'No deadline remains when disabled.');
    }
  }
});

test('volume and duration edited while resume is pending survive asynchronous startup', async t => {
  t.mock.method(globalThis, 'setTimeout', () => 1);
  t.mock.method(globalThis, 'clearTimeout', () => {});
  const ctx = context();
  ctx.state = 'suspended';
  let finishResume;
  ctx.resume = () => new Promise(resolve => { finishResume = resolve; });
  const originalDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'AudioContext');
  Object.defineProperty(globalThis, 'AudioContext', { configurable: true, value: class { constructor() { return ctx; } } });
  t.after(() => {
    if (originalDescriptor) Object.defineProperty(globalThis, 'AudioContext', originalDescriptor);
    else delete globalThis.AudioContext;
  });
  const engine = new AudioEngine();
  const pending = engine.start({ mode: 'stereo', tones: [{ frequency: 200, channel: 'L', gain: 1, phase: 0 }] }, 0.08, 60);
  assert.equal(engine.starting, true);
  assert.equal(engine.graph, null);
  engine.setVolume(0.03);
  engine.setDuration(180);
  ctx.currentTime = 0.1;
  ctx.state = 'running';
  finishResume();
  await pending;
  assert.equal(engine.running, true);
  assert.equal(engine.graph.volume, 0.03, 'The created graph uses the latest 3% volume.');
  assert.equal(engine.duration, 180, 'The latest duration survives resume.');
  assert.ok(Math.abs(engine.graph.master.gain.at(60.1) - 0.03) < 1e-12, 'The former 60-second deadline is absent.');
  assert.ok(Math.abs(engine.graph.master.gain.at(180.1)) < 1e-12, 'The actual 180-second deadline reaches silence.');
});
