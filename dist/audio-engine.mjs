import { analyze, validate } from './audio-core.mjs';

// The same Fourier coefficients drive the audio and the on-screen ideal spectrum.
// PeriodicWave uses real = cosine coefficients, imag = sine coefficients.
export function createAudioGraph(context, analysis, options = {}) {
  const start = options.startTime ?? context.currentTime + 0.015;
  const fade = options.fadeSeconds ?? 0.035;
  const volume = options.volume ?? 0.08;
  const master = context.createGain();
  const merger = context.createChannelMerger(2);
  const sources = [];
  const nodes = [master, merger];
  const busses = [context.createGain(), context.createGain()];
  nodes.push(...busses);
  busses.forEach((bus, channel) => {
    bus.channelCount = 1;
    bus.channelCountMode = 'explicit';
    bus.channelInterpretation = 'discrete';
    bus.connect(merger, 0, channel);
  });
  merger.channelInterpretation = 'discrete';
  merger.connect(master);
  master.connect(options.destination ?? context.destination);
  if (fade) master.gain.setValueAtTime(0, context.currentTime);
  master.gain.setValueAtTime(fade ? 0 : volume, start);
  if (fade) master.gain.linearRampToValueAtTime(volume, start + fade);

  // A zero-frequency offset is shown in analysis, but never sent to headphones.
  for (const [channel, components] of [analysis.left, analysis.right].entries()) {
    for (const part of components) {
      if (!(part.frequency > 0)) continue;
      const amplitude = Math.hypot(part.cos, part.sin);
      if (amplitude === 0) continue;
      const wave = context.createPeriodicWave(
        new Float32Array([0, part.cos / amplitude]),
        new Float32Array([0, part.sin / amplitude]),
        { disableNormalization: true },
      );
      const oscillator = context.createOscillator();
      oscillator.setPeriodicWave(wave);
      oscillator.frequency.setValueAtTime(part.frequency, start);
      const gain = context.createGain();
      gain.gain.value = amplitude;
      oscillator.connect(gain);
      gain.connect(busses[channel]);
      oscillator.start(start);
      sources.push(oscillator);
      nodes.push(oscillator, gain);
    }
  }
  return { master, merger, sources, nodes, start, volume };
}

function hold(param, time) {
  if (typeof param.cancelAndHoldAtTime === 'function') param.cancelAndHoldAtTime(time);
  else { const value = param.value; param.cancelScheduledValues(time); param.setValueAtTime(value, time); }
}

function retire(context, graph, when = context.currentTime, duration = 0.04) {
  if (!graph || graph.retired) return;
  graph.retired = true;
  hold(graph.master.gain, when);
  graph.master.gain.linearRampToValueAtTime(0, when + duration);
  for (const source of graph.sources) { try { source.stop(when + duration + 0.005); } catch {} }
  setTimeout(() => graph.nodes.forEach(node => { try { node.disconnect(); } catch {} }),
    Math.max(80, (when + duration - context.currentTime) * 1000 + 80));
}

export class AudioEngine {
  constructor(onStop = () => {}) {
    this.context = null;
    this.graph = null;
    this.running = false;
    this.starting = false;
    this.generation = 0;
    this.timer = null;
    this.onStop = onStop;
    this.volume = 0.08;
    this.startedAt = 0;
    this.duration = 60;
  }

  async start(config, volume = 0.08, duration = 60) {
    if (this.running || this.starting) return;
    this.volume = Math.min(1, Math.max(0, volume));
    this.duration = duration;
    const generation = ++this.generation;
    this.starting = true;
    try {
      const AudioContextClass = globalThis.AudioContext || globalThis.webkitAudioContext;
      if (!AudioContextClass) throw new Error('Este navegador no ofrece reproducción Web Audio. Abre el enlace en Chrome o Safari.');
      if (!this.context || this.context.state === 'closed') {
        this.context = new AudioContextClass({ latencyHint: 'interactive' });
        this.context.onstatechange = () => {
          if (this.running && this.context.state !== 'running') this.stop('Audio interrumpido. Pulsa Reproducir para continuar.');
        };
      }
      await this.context.resume();
      if (generation !== this.generation) return;
      const validation = validate(config, this.context.sampleRate);
      if (!validation.ok) throw new Error(validation.errors.map(error => error.message).join(' '));
      const analysis = analyze(config);
      if (!analysis.left.length && !analysis.right.length) throw new Error('No hay tonos de salida para reproducir. Revisa los tonos, las fases y el modo.');
      this.graph = createAudioGraph(this.context, analysis, { volume: this.volume });
      this.running = true;
      this.startedAt = this.context.currentTime;
      this.armDeadline();
    } finally { this.starting = false; }
  }

  update(config) {
    if (!this.running) return;
    const validation = validate(config, this.context.sampleRate);
    if (!validation.ok) { this.stop(); throw new Error(validation.errors.map(error => error.message).join(' ')); }
    const analysis = analyze(config);
    const start = this.context.currentTime + 0.02;
    const old = this.graph;
    this.graph = createAudioGraph(this.context, analysis, { volume: this.volume, startTime: start, fadeSeconds: 0.045 });
    retire(this.context, old, start, 0.045);
    // New oscillators use the same shared start instant, preserving interaural phase.
    // Each edit crossfades a coherent new signal rather than changing one channel early.
    this.armDeadline();
  }

  setVolume(volume) {
    this.volume = Math.min(1, Math.max(0, volume));
    if (!this.graph || !this.running) return;
    const time = this.context.currentTime;
    hold(this.graph.master.gain, time);
    this.graph.master.gain.linearRampToValueAtTime(this.volume, time + 0.04);
    this.armDeadline();
  }

  setDuration(seconds) {
    this.duration = seconds;
    if (this.running && this.graph) {
      const time = this.context.currentTime;
      hold(this.graph.master.gain, time);
      this.graph.master.gain.linearRampToValueAtTime(this.volume, time + 0.045);
    }
    this.armDeadline();
  }

  armDeadline() {
    clearTimeout(this.timer);
    this.timer = null;
    if (!this.running) return;
    const stableAt = this.context.currentTime + 0.085;
    this.graph.master.gain.cancelScheduledValues(stableAt);
    this.graph.master.gain.setValueAtTime(this.volume, stableAt);
    if (!this.duration) return;
    const deadline = this.startedAt + this.duration;
    const remaining = deadline - this.context.currentTime;
    if (remaining <= 0) { this.stop('Sesión terminada.'); return; }
    // Audio-clock automation provides the deadline even if JS timers are throttled.
    const fadeStart = Math.max(stableAt, deadline - 0.06);
    this.graph.master.gain.setValueAtTime(this.volume, fadeStart);
    this.graph.master.gain.linearRampToValueAtTime(0, Math.max(fadeStart + 0.01, deadline));
    this.timer = setTimeout(() => this.stop('Sesión terminada.'), remaining * 1000 + 60);
  }

  elapsed() { return this.running ? Math.max(0, this.context.currentTime - this.startedAt) : 0; }

  stop(message = 'Detenido') {
    ++this.generation;
    this.starting = false;
    clearTimeout(this.timer);
    this.timer = null;
    if (this.context) retire(this.context, this.graph);
    this.graph = null;
    this.running = false;
    this.onStop(message);
  }
}
