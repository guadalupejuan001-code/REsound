/** A stereo stimulus generator. These values describe audio, not measured EEG. */
export function binauralTones(base, difference) {
  if (!Number.isFinite(base) || base < 0) throw new RangeError('Escribe un tono base de 0 Hz o más.');
  if (!Number.isFinite(difference)) throw new RangeError('Escribe una diferencia válida entre los oídos.');
  const right = base + difference;
  if (!Number.isFinite(right) || right < 0) throw new RangeError('La combinación debe dejar una frecuencia de 0 Hz o más en cada oído.');
  return [
    { id: 'binaural-L', frequency: base, channel: 'L', gain: 1, phase: 0, enabled: true },
    { id: 'binaural-R', frequency: right, channel: 'R', gain: 1, phase: 0, enabled: true },
  ];
}

export function inferBinaural(config) {
  if (config.mode !== 'stereo' || config.tones?.length !== 2) return null;
  const left = config.tones.find(tone => tone.channel === 'L');
  const right = config.tones.find(tone => tone.channel === 'R');
  if (!left || !right || [left, right].some(tone => tone.enabled === false || tone.gain !== 1 || tone.phase % 360 !== 0)) return null;
  if (![left.frequency, right.frequency].every(value => Number.isFinite(value) && value >= 0)) return null;
  return { baseFrequency: left.frequency, beatFrequency: right.frequency - left.frequency };
}
