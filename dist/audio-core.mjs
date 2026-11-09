/**
 * REsound — deterministic ideal-signal algebra.
 *
 * A tone is gain * sin(2π * frequency * t + phaseDegrees).
 * Channels are normalized by max(1, sum(gain)) before combining.
 * Stereo preserves channel routing, sum sends all tones to both channels,
 * and multiply sends (normalized left) * (normalized right) to both.
 *
 * Output spectral components use cos*cos(2πft) + sin*sin(2πft).
 * DC is reported separately and must not be sent to an audio transducer.
 * These are calculated ideal spectra, not measurements or brain activity.
 */

const MODES = new Set(['stereo', 'sum', 'multiply']);
const ROUNDING_TOLERANCE = 32 * Number.EPSILON;
const TAU = 2 * Math.PI;

function parse(config) {
  const errors = [];
  const error = (code, message, field) => errors.push({ code, message, ...(field ? { field } : {}) });
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    return { ok: false, errors: [{ code: 'CONFIG', message: 'La configuración debe ser un objeto.' }], warnings: [], config: null };
  }
  const mode = config.mode ?? 'stereo';
  if (!MODES.has(mode)) error('MODE', 'El modo debe ser stereo, sum o multiply.', 'mode');
  const tones = [];
  if (!Array.isArray(config.tones)) {
    error('TONES', 'Se necesita una lista de tonos.', 'tones');
  } else {
    config.tones.forEach((tone, index) => {
      const field = `tones.${index}`;
      if (!tone || typeof tone !== 'object') {
        error('TONE', `El tono ${index + 1} no es válido.`, field);
        return;
      }
      const { frequency } = tone;
      const gain = tone.gain ?? 1;
      const phase = tone.phase ?? 0;
      const channel = tone.channel ?? 'L';
      const enabled = tone.enabled ?? true;
      if (!Number.isFinite(frequency) || frequency < 0) error('FREQUENCY', `La frecuencia del tono ${index + 1} debe ser finita y mayor o igual a 0 Hz.`, `${field}.frequency`);
      if (!Number.isFinite(gain) || gain < 0) error('GAIN', `La amplitud del tono ${index + 1} debe ser finita y no negativa.`, `${field}.gain`);
      if (!Number.isFinite(phase)) error('PHASE', `La fase del tono ${index + 1} debe ser finita.`, `${field}.phase`);
      if (channel !== 'L' && channel !== 'R') error('CHANNEL', `Selecciona L o R para el tono ${index + 1}.`, `${field}.channel`);
      if (typeof enabled !== 'boolean') error('ENABLED', `El estado del tono ${index + 1} debe ser verdadero o falso.`, `${field}.enabled`);
      tones.push({ id: tone.id ?? `tone-${index + 1}`, frequency, gain, phase: ((phase % 360) + 360) % 360, channel, enabled });
    });
  }
  return { ok: errors.length === 0, errors, warnings: [], config: { mode, tones } };
}

function normalized(tones) {
  const active = tones.filter(t => t.enabled && t.gain > 0);
  // Scaling before summation also handles finite gains whose unscaled sum
  // would overflow. It does not cap an input or change its relative weight.
  const maximum = active.reduce((m, t) => Math.max(m, t.gain), 0);
  if (!maximum) return { tones: [], divisor: 1, peakBound: 0 };
  const scaledSum = active.reduce((sum, t) => sum + t.gain / maximum, 0);
  const total = maximum * scaledSum;
  const useNormalization = total > 1;
  const result = active.map(t => ({ ...t, amplitude: useNormalization ? (t.gain / maximum) / scaledSum : t.gain }));
  return { tones: result, divisor: useNormalization ? total : 1, peakBound: result.reduce((sum, t) => sum + t.amplitude, 0) };
}

function sinCos(degrees) {
  // Exact quadrants avoid inventing tiny spectral lines at 90° boundaries.
  if (degrees === 0) return { sin: 0, cos: 1 };
  if (degrees === 90) return { sin: 1, cos: 0 };
  if (degrees === 180) return { sin: 0, cos: -1 };
  if (degrees === 270) return { sin: -1, cos: 0 };
  const radians = degrees * Math.PI / 180;
  return { sin: Math.sin(radians), cos: Math.cos(radians) };
}

function add(map, frequency, cos, sin = 0) {
  if (!Number.isFinite(frequency)) throw new RangeError('La frecuencia resultante supera la precisión numérica disponible.');
  if (frequency < 0) { frequency = -frequency; sin = -sin; }
  if (frequency === 0) sin = 0;
  if (cos === 0 && sin === 0) return;
  const item = map.get(frequency) ?? { frequency, cos: 0, sin: 0, cosCorrection: 0, sinCorrection: 0, bound: 0 };
  for (const [name, value] of [['cos', cos], ['sin', sin]]) {
    const correction = `${name}Correction`;
    const adjusted = value - item[correction];
    const sum = item[name] + adjusted;
    item[correction] = (sum - item[name]) - adjusted;
    item[name] = sum;
  }
  item.bound += Math.abs(cos) + Math.abs(sin);
  map.set(frequency, item);
}

function finish(map) {
  const components = [];
  let dc = 0;
  for (const item of map.values()) {
    const amplitude = Math.hypot(item.cos, item.sin);
    if (amplitude <= ROUNDING_TOLERANCE * item.bound) continue;
    if (item.frequency === 0) { dc = item.cos; continue; }
    components.push({ frequency: item.frequency, cos: item.cos, sin: item.sin, amplitude });
  }
  components.sort((a, b) => a.frequency - b.frequency);
  return { components, dc };
}

function toneSpectrum(group) {
  const map = new Map();
  for (const tone of group.tones) {
    const phase = sinCos(tone.phase);
    add(map, tone.frequency, tone.amplitude * phase.sin, tone.amplitude * phase.cos);
  }
  return finish(map);
}

function productSpectrum(a, b) {
  const map = new Map();
  add(map, 0, a.dc * b.dc);
  for (const x of a.components) add(map, x.frequency, x.cos * b.dc, x.sin * b.dc);
  for (const y of b.components) add(map, y.frequency, y.cos * a.dc, y.sin * a.dc);
  for (const x of a.components) {
    for (const y of b.components) {
      add(map, x.frequency + y.frequency,
        (x.cos * y.cos - x.sin * y.sin) / 2,
        (x.cos * y.sin + x.sin * y.cos) / 2);
      add(map, x.frequency - y.frequency,
        (x.cos * y.cos + x.sin * y.sin) / 2,
        (x.sin * y.cos - x.cos * y.sin) / 2);
    }
  }
  return finish(map);
}

function build(config) {
  const active = config.tones.filter(t => t.enabled && t.gain > 0);
  const groupL = normalized(active.filter(t => t.channel === 'L'));
  const groupR = normalized(active.filter(t => t.channel === 'R'));
  const groupAll = normalized(active);
  let left = toneSpectrum(groupL);
  let right = toneSpectrum(groupR);
  let peakL = groupL.peakBound;
  let peakR = groupR.peakBound;
  if (config.mode === 'sum') {
    left = toneSpectrum(groupAll);
    right = left;
    peakL = peakR = groupAll.peakBound;
  } else if (config.mode === 'multiply') {
    left = productSpectrum(left, right);
    right = left;
    peakL = peakR = groupL.peakBound * groupR.peakBound;
  }
  const frequencies = [...new Set([...left.components, ...right.components].map(s => s.frequency))].sort((a, b) => a - b);
  const differencePairs = [];
  for (let i = 0; i < active.length; i++) {
    for (let j = i + 1; j < active.length; j++) {
      const a = active[i], b = active[j];
      differencePairs.push({ idA: a.id, idB: b.id, frequencyA: a.frequency, frequencyB: b.frequency,
        channelA: a.channel, channelB: b.channel, difference: Math.abs(a.frequency - b.frequency),
        crossChannel: a.channel !== b.channel });
    }
  }
  const rms = spectrum => Math.sqrt(spectrum.dc ** 2 + spectrum.components.reduce((sum, s) => sum + (s.cos ** 2 + s.sin ** 2) / 2, 0));
  return {
    mode: config.mode,
    left: left.components, right: right.components,
    dc: { left: left.dc, right: right.dc },
    frequencies, compCount: frequencies.length, componentCount: frequencies.length,
    channelCounts: { left: left.components.length, right: right.components.length },
    dcCount: left.dc !== 0 || right.dc !== 0 ? 1 : 0,
    maxFrequency: frequencies.at(-1) ?? 0,
    maxInputFrequency: active.reduce((max, t) => Math.max(max, t.frequency), 0),
    inputCount: active.length,
    differencePairs,
    normalization: { left: groupL.divisor, right: groupR.divisor, sum: groupAll.divisor },
    peakBound: { left: Math.min(1, peakL), right: Math.min(1, peakR) },
    rms: { left: rms(left), right: rms(right) },
    model: 'ideal-sinusoids',
  };
}

/** Validate inputs and, optionally, the actual output spectrum at sampleRate. */
export function validate(config, sampleRate) {
  const result = parse(config);
  if (!result.ok) return result;
  if (sampleRate !== undefined && (!Number.isFinite(sampleRate) || sampleRate <= 0)) {
    result.errors.push({ code: 'SAMPLE_RATE', message: 'La frecuencia de muestreo debe ser finita y mayor que 0 Hz.', field: 'sampleRate' });
  }
  let analysis;
  try { analysis = build(result.config); }
  catch (error) { result.errors.push({ code: 'NUMERIC_RANGE', message: error.message }); }
  if (analysis && Number.isFinite(sampleRate) && sampleRate > 0 && analysis.maxFrequency >= sampleRate / 2) {
    result.errors.push({ code: 'NYQUIST', message: `La salida contiene ${analysis.maxFrequency} Hz; para reproducirla sin aliasing debe estar por debajo de ${sampleRate / 2} Hz con este dispositivo.`, field: 'sampleRate' });
  }
  if (analysis && (analysis.dc.left !== 0 || analysis.dc.right !== 0)) {
    result.warnings.push({ code: 'DC', message: 'El modelo contiene una componente constante (0 Hz). Se representa matemáticamente; no se reproduce como tono.' });
  }
  result.ok = result.errors.length === 0;
  return result;
}

/** Return the exact calculated ideal spectrum for the requested configuration. */
export function analyze(config) {
  const result = parse(config);
  if (!result.ok) throw new RangeError(result.errors.map(e => e.message).join(' '));
  return build(result.config);
}

/** Evaluate the mathematical signal directly, independently of spectral algebra. */
export function sampleAt(config, t) {
  const result = parse(config);
  if (!result.ok) throw new RangeError(result.errors.map(e => e.message).join(' '));
  if (!Number.isFinite(t)) throw new RangeError('El tiempo debe ser finito.');
  const evaluate = group => group.tones.reduce((sum, tone) => {
    const cycles = tone.frequency * t;
    if (!Number.isFinite(cycles)) throw new RangeError('El producto frecuencia × tiempo supera la precisión numérica disponible.');
    // Reduce in cycles before multiplying by 2π to avoid needless overflow.
    const angle = TAU * (cycles % 1);
    const phase = sinCos(tone.phase);
    return sum + tone.amplitude * (Math.sin(angle) * phase.cos + Math.cos(angle) * phase.sin);
  }, 0);
  if (result.config.mode === 'sum') {
    const value = evaluate(normalized(result.config.tones));
    return { left: value, right: value };
  }
  const left = evaluate(normalized(result.config.tones.filter(tone => tone.channel === 'L')));
  const right = evaluate(normalized(result.config.tones.filter(tone => tone.channel === 'R')));
  if (result.config.mode === 'multiply') return { left: left * right, right: left * right };
  return { left, right };
}
