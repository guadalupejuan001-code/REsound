import { analyze, validate } from './audio-core.mjs';
import { AudioEngine } from './audio-engine.mjs';
import { drawWaveform, drawSpectrum, number } from './charts.mjs';
import { binauralTones, inferBinaural } from './binaural.mjs';

const $ = id => document.getElementById(id);
const ACTIVE_KEY = 'resound-frecuencias-current-v1';
const SESSIONS_KEY = 'resound-frecuencias-sessions-v1';
const allowedDurations = [0, 30, 60, 180, 300, 600, 1200, 1800];
const allowedWindows = [0.02, 0.1, 0.5, 1];
let nextId = 1;
const makeTone = (frequency, channel) => ({ id: `tone-${nextId++}`, frequency, channel, gain: 1, phase: 0, enabled: true });
let state = {
  mode: 'stereo', tones: binauralTones(200, 10),
  experimentStyle: 'binaural', baseFrequency: 200, beatFrequency: 10, freeConfiguration: null,
  masterVolume: 0.08, duration: 60, timeWindow: 0.1,
  sessionName: 'Mi prueba', sessionNotes: '',
};
let sessions = [];
let analysis;
let changeTimer;
let starting = false;
let graphHint;
const engine = new AudioEngine(message => {
  try { globalThis.REsoundAndroid?.abandonAudioFocus(); } catch {}
  $('play-btn').disabled = false;
  $('stop-btn').disabled = true;
  $('elapsed').textContent = '00:00';
  setStatus(message);
});
// Only the trusted packaged Android Activity uses this lifecycle endpoint.
globalThis.REsoundApp = Object.freeze({ stop: message => engine.stop(message || 'Detenido') });

function setStatus(message, error = false) {
  $('status').textContent = message;
  $('status').classList.toggle('status-error', error);
}

function unpack(raw) {
  if (!raw || typeof raw !== 'object') throw new Error('La sesión no tiene un formato válido.');
  const input = raw.configuration ?? raw;
  if (!Array.isArray(input.tones)) throw new Error('No se encontró una lista de tonos en la sesión.');
  const validation = validate(input);
  if (!validation.ok) throw new Error(validation.errors.map(error => error.message).join(' '));
  if (validation.config.tones.some(tone => tone.gain > 1)) throw new Error('Los niveles de una sesión deben estar entre 0 y 1.');
  const restoreTone = ({ frequency, channel, gain, phase, enabled }) => ({
    id: `tone-${nextId++}`, frequency, channel, gain, phase, enabled,
  });
  const inferred = inferBinaural(validation.config);
  const automatic = input.experimentStyle === 'binaural' || (!input.experimentStyle && Boolean(inferred));
  const baseFrequency = Number.isFinite(input.baseFrequency) ? input.baseFrequency : inferred?.baseFrequency ?? 200;
  const beatFrequency = Number.isFinite(input.beatFrequency) ? input.beatFrequency : inferred?.beatFrequency ?? 10;
  let freeConfiguration = null;
  if (input.freeConfiguration) {
    const freeValidation = validate(input.freeConfiguration);
    if (freeValidation.ok) {
      if (freeValidation.config.tones.some(tone => tone.gain > 1)) throw new Error('Los niveles de los tonos libres deben estar entre 0 y 1.');
      freeConfiguration = { mode: freeValidation.config.mode, tones: freeValidation.config.tones.map(restoreTone) };
    }
  }
  const loaded = {
    mode: validation.config.mode,
    experimentStyle: automatic ? 'binaural' : 'free', baseFrequency, beatFrequency, freeConfiguration,
    tones: validation.config.tones.map(restoreTone),
    // Reopening or importing a configuration never restores a high volume.
    masterVolume: 0.08,
    duration: allowedDurations.includes(Number(input.duration)) ? Number(input.duration) : 60,
    timeWindow: allowedWindows.includes(Number(input.timeWindow)) ? Number(input.timeWindow) : 0.1,
    sessionName: String(input.sessionName ?? raw.name ?? 'Mi prueba').slice(0, 80),
    sessionNotes: String(input.sessionNotes ?? '').slice(0, 4000),
  };
  if (automatic) { loaded.mode = 'stereo'; loaded.tones = binauralTones(baseFrequency, beatFrequency); }
  return loaded;
}

function persist() {
  if (!validate(state).ok) return;
  try { localStorage.setItem(ACTIVE_KEY, JSON.stringify(state)); }
  catch { /* A blocked local store does not block sound or export. */ }
}

try {
  const raw = JSON.parse(localStorage.getItem(ACTIVE_KEY) || 'null');
  if (raw) state = unpack(raw);
  const stored = JSON.parse(localStorage.getItem(SESSIONS_KEY) || '[]');
  if (Array.isArray(stored)) sessions = stored.filter(item => item?.configuration && typeof item.name === 'string');
} catch { /* Start with the two working tones if stored data is unavailable. */ }

function labelField(text, element) {
  const label = document.createElement('label'); label.className = 'field';
  const span = document.createElement('span'); span.textContent = text;
  label.append(span, element); return label;
}

function fieldHelp(field, control, id, text) {
  const hint = document.createElement('small'); hint.className = 'field-help'; hint.id = id;
  hint.textContent = text; control.setAttribute('aria-describedby', id); field.append(hint);
  return field;
}

function numericInput(value, field, index, constraints = {}) {
  const input = document.createElement('input'); input.type = 'number';
  input.value = value; input.step = 'any'; input.inputMode = 'decimal';
  input.dataset.field = field; input.dataset.index = String(index);
  Object.assign(input, constraints); return input;
}

function renderTones() {
  const list = $('tone-list'); list.replaceChildren();
  state.tones.forEach((tone, index) => {
    const row = document.createElement('article'); row.className = 'tone-row'; row.dataset.enabled = tone.enabled;
    const header = document.createElement('div'); header.className = 'tone-header';
    const enableLabel = document.createElement('label'); enableLabel.className = 'tone-enabled';
    const enabled = document.createElement('input'); enabled.type = 'checkbox'; enabled.checked = tone.enabled;
    enabled.dataset.index = index; enabled.dataset.field = 'enabled'; enabled.setAttribute('aria-label', `Activar tono ${index + 1}`);
    const name = document.createElement('span'); name.className = 'tone-id'; name.textContent = `Tono ${index + 1}`;
    enableLabel.append(enabled, name);
    const channelTag = document.createElement('span'); channelTag.className = `channel-tag channel-${tone.channel.toLowerCase()}`;
    channelTag.textContent = tone.channel;
    const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'tone-remove';
    remove.textContent = 'Quitar'; remove.dataset.remove = index; remove.setAttribute('aria-label', `Quitar tono ${index + 1}`);
    header.append(enableLabel, channelTag, remove);
    const frequency = numericInput(tone.frequency, 'frequency', index, { min: '0' });
    frequency.setAttribute('aria-label', `Frecuencia tono ${index + 1} (Hz)`);
    const channel = document.createElement('select'); channel.dataset.field = 'channel'; channel.dataset.index = index;
    channel.setAttribute('aria-label', `Canal tono ${index + 1}`);
    for (const [value, text] of [['L', 'L · izq.'], ['R', 'R · der.']]) {
      const option = document.createElement('option'); option.value = value; option.textContent = text; channel.append(option);
    }
    channel.value = tone.channel;
    const phase = numericInput(tone.phase, 'phase', index);
    phase.setAttribute('aria-label', `Fase tono ${index + 1} (grados)`);
    const gain = document.createElement('input'); gain.type = 'range'; gain.min = 0; gain.max = 1; gain.step = 0.01;
    gain.value = tone.gain; gain.dataset.index = index; gain.dataset.field = 'gain';
    gain.setAttribute('aria-label', `Nivel tono ${index + 1}`);
    const gainField = fieldHelp(labelField(`Nivel · ${Math.round(tone.gain * 100)}%`, gain), gain,
      `tone-${index}-gain-help`, 'Peso de este tono en la mezcla. 0% lo silencia; el volumen general controla toda la salida.');
    gainField.querySelector('span').dataset.gainLabel = index;
    const frequencyField = labelField('Frecuencia · Hz', frequency); frequencyField.classList.add('tone-frequency');
    const details = document.createElement('details'); details.className = 'tone-advanced';
    const summary = document.createElement('summary'); summary.textContent = 'Ajustar este tono';
    const extra = document.createElement('div'); extra.className = 'tone-extra-controls';
    extra.append(
      fieldHelp(labelField('Canal', channel), channel, `tone-${index}-channel-help`, 'L = oído izquierdo; R = oído derecho. En Sumar o Multiplicar, el resultado llega a ambos.'),
      fieldHelp(labelField('Fase · grados', phase), phase, `tone-${index}-phase-help`, 'Desplaza el ciclo de la onda, no sus Hz. 360° vuelve al inicio. Al sumar tonos iguales, 180° puede hacer que se resten.'),
      gainField,
    );
    details.append(summary, extra);
    row.append(header, frequencyField, details); list.append(row);
  });
  if (!state.tones.length) {
    const empty = document.createElement('p'); empty.className = 'field-help'; empty.textContent = 'Añade un tono para empezar.'; list.append(empty);
  }
}

function renderControls() {
  $('experiment-style').value = state.experimentStyle;
  $('base-frequency').value = state.baseFrequency;
  $('beat-frequency').value = state.beatFrequency;
  $('binaural-controls').hidden = state.experimentStyle !== 'binaural';
  $('free-tone-controls').hidden = state.experimentStyle === 'binaural';
  $('mode').value = state.mode;
  $('master-volume').value = state.masterVolume;
  $('master-value').textContent = `${Math.round(state.masterVolume * 100)}%`;
  $('duration').value = state.duration;
  $('time-window').value = state.timeWindow;
  $('session-name').value = state.sessionName;
  $('session-notes').value = state.sessionNotes;
  const pair = state.tones.length === 2 && state.tones.every(tone => tone.enabled && tone.gain === 1 && tone.phase === 0)
    ? state.tones.map(tone => tone.frequency).join('/') : '';
  $('preset-select').value = ({ '200/210': 'binaural', '220/220': 'unison', '220/330': 'fifth' })[pair] ?? '';
  renderTones();
}

function frequencyList() {
  const list = $('frequency-list'); list.replaceChildren();
  for (const [channel, parts] of [['L', analysis.left], ['R', analysis.right]]) {
    const row = document.createElement('div'); row.className = 'frequency-channel';
    const label = document.createElement('strong'); label.textContent = `${channel} · `;
    const values = document.createElement('span');
    values.textContent = parts.length ? parts.map(p => `${number(p.frequency)} Hz (${number(Math.hypot(p.cos, p.sin))})`).join(' · ') : 'Silencio';
    row.append(label, values); list.append(row);
  }
  const extra = document.createElement('p'); extra.className = 'field-help';
  extra.textContent = 'Entre paréntesis: amplitud antes del volumen general.';
  list.append(extra);
  if (Math.abs(analysis.dc.left) > 1e-10 || Math.abs(analysis.dc.right) > 1e-10) {
    const dc = document.createElement('p'); dc.className = 'field-help';
    dc.textContent = `Componente constante (0 Hz): L ${number(analysis.dc.left)}, R ${number(analysis.dc.right)}. Se calcula, pero no se envía a los auriculares.`;
    list.append(dc);
  }
}

function draw() {
  if (!analysis) return;
  const hint = drawWaveform($('waveform'), analysis, state.timeWindow);
  if (graphHint) graphHint.textContent = hint;
  drawSpectrum($('spectrum'), analysis);
}

function explainCurrentAudio(count) {
  if (state.experimentStyle === 'binaural') {
    const left = state.tones[0].frequency, right = state.tones[1].frequency;
    const difference = state.beatFrequency, separation = Math.abs(difference);
    const equation = `Derecho = ${number(left)} ${difference < 0 ? '−' : '+'} ${number(separation)} = ${number(right)} Hz. Izquierdo = ${number(left)} Hz.`;
    let meaning;
    if (left === 0 || right === 0) {
      meaning = '0 Hz no oscila: ese canal queda en silencio en este modo. Para comparar dos tonos, usa frecuencias mayores que 0 en ambos oídos.';
    } else if (left === right) {
      meaning = difference === 0
        ? 'Ambos oídos reciben el mismo tono. Sigue habiendo sonido: hay una frecuencia distinta en dos canales, sin diferencia entre ellos.'
        : 'La diferencia escrita es demasiado pequeña para representarse con esta base: el redondeo deja ambos tonos iguales.';
    } else {
      meaning = `El derecho es ${number(separation)} Hz más ${difference < 0 ? 'grave' : 'agudo'}. Esa separación no añade un tercer tono de ${number(separation)} Hz.`;
    }
    $('binaural-explanation').textContent = `${equation} ${meaning}`;
  }
  const countText = count === 1 ? '1 frecuencia distinta' : `${count} frecuencias distintas`;
  const modes = {
    stereo: 'Cada canal conserva sus propios tonos. La misma frecuencia en L y R se cuenta una sola vez.',
    sum: 'Ambos oídos reciben la misma mezcla. Sumar no crea frecuencias nuevas; tonos iguales pueden reforzarse o cancelarse según su fase.',
    multiply: 'La multiplicación puede crear frecuencias de suma y diferencia entre los tonos L/R. Los resultados coincidentes se combinan; una parte constante de 0 Hz se muestra aparte.',
  };
  $('experiment-explanation').textContent = `${countText} en la salida. ${modes[state.mode]}`;
}

function updateAnalysis(updateAudio = true) {
  if (state.experimentStyle === 'binaural') {
    try {
      state.tones = binauralTones(state.baseFrequency, state.beatFrequency);
      state.mode = 'stereo';
      $('binaural-result').textContent = `L ${number(state.tones[0].frequency)} Hz · R ${number(state.tones[1].frequency)} Hz`;
    } catch (error) {
      engine.stop(); $('play-btn').disabled = true;
      $('binaural-result').textContent = 'Completa el tono base y la diferencia.';
      $('binaural-explanation').textContent = 'La app necesita dos resultados válidos: izquierdo = base; derecho = base + diferencia. Ninguno puede ser negativo.';
      $('experiment-explanation').textContent = 'Las gráficas conservan la última configuración válida hasta que completes estos valores.';
      $('spectrum-summary').textContent = 'Revisa los valores';
      setStatus(error.message, true); return;
    }
  }
  const validation = validate(state);
  if (!validation.ok) {
    engine.stop();
    $('play-btn').disabled = true;
    setStatus(validation.errors.map(error => error.message).join(' '), true);
    $('spectrum-summary').textContent = 'Revisa los valores';
    $('experiment-explanation').textContent = 'Las gráficas conservan la última configuración válida. Corrige los tonos para volver a calcular la salida.';
    return;
  }
  analysis = analyze(state);
  $('mode-description').textContent = {
    stereo: 'Cada tono va al canal elegido. Los dos oídos reciben señales independientes.',
    sum: 'Todos los tonos se suman y la misma mezcla llega a ambos oídos.',
    multiply: 'Se multiplica la mezcla izquierda por la derecha. El resultado llega a ambos oídos.',
  }[state.mode];
  const count = new Set([...analysis.left, ...analysis.right].map(p => p.frequency)).size;
  $('spectrum-summary').textContent = `${count} ${count === 1 ? 'frecuencia' : 'frecuencias'}`;
  explainCurrentAudio(count);
  const active = state.tones.filter(tone => tone.enabled && tone.gain > 0 && tone.frequency > 0);
  if (active.length === 2) {
    const delta = Math.abs(active[0].frequency - active[1].frequency);
    $('beat-info').textContent = state.experimentStyle === 'binaural'
      ? `Diferencia L/R: ${number(delta)} Hz · un tono independiente en cada oído.`
      : `Diferencia de entrada: ${number(delta)} Hz${state.mode === 'multiply' ? ' · consulta las frecuencias generadas abajo.' : ' · no se cuenta como un tono añadido.'}`;
  } else {
    const pairs = active.length * (active.length - 1) / 2;
    const differences = [...new Set(active.flatMap((tone, i) => active.slice(i + 1).map(other => Math.abs(tone.frequency - other.frequency))))].sort((a, b) => a - b);
    $('beat-info').textContent = `${pairs} pares de entrada${differences.length ? ` · diferencias: ${differences.slice(0, 12).map(number).join(', ')} Hz${differences.length > 12 ? '…' : ''}` : ''}. Las diferencias no equivalen a tonos nuevos.`;
  }
  frequencyList(); draw(); persist();
  let audioError = false;
  if (updateAudio && engine.running) {
    try { engine.update(state); }
    catch (error) { audioError = true; setStatus(error.message, true); }
  }
  $('play-btn').disabled = engine.running || starting || !count;
  if (!engine.running && !starting && !audioError) setStatus(count ? 'Listo para escuchar' : 'Silencio: revisa los tonos y el modo.');
}

function queueUpdate() {
  clearTimeout(changeTimer);
  changeTimer = setTimeout(() => updateAnalysis(), 70);
}

$('experiment-style').addEventListener('change', event => {
  clearTimeout(changeTimer);
  if (state.experimentStyle === 'free') state.freeConfiguration = { mode: state.mode, tones: structuredClone(state.tones) };
  state.experimentStyle = event.target.value;
  if (state.experimentStyle === 'free' && state.freeConfiguration) {
    state.mode = state.freeConfiguration.mode; state.tones = structuredClone(state.freeConfiguration.tones);
  }
  renderControls(); updateAnalysis();
});
for (const [id, property] of [['base-frequency', 'baseFrequency'], ['beat-frequency', 'beatFrequency']]) {
  $(id).addEventListener('input', event => {
    state[property] = event.target.value === '' ? NaN : Number(event.target.value);
    queueUpdate();
  });
}

$('tone-list').addEventListener('input', event => {
  const target = event.target, field = target.dataset.field, index = Number(target.dataset.index);
  if (!field || !state.tones[index]) return;
  state.tones[index][field] = field === 'enabled' ? target.checked : field === 'channel' ? target.value : target.value === '' ? NaN : Number(target.value);
  if (field === 'gain') target.closest('label').querySelector('span').textContent = `Nivel · ${Math.round(Number(target.value) * 100)}%`;
  if (field === 'enabled') target.closest('.tone-row').dataset.enabled = target.checked;
  if (field === 'channel') {
    const tag = target.closest('.tone-row').querySelector('.channel-tag');
    tag.textContent = target.value; tag.className = `channel-tag channel-${target.value.toLowerCase()}`;
  }
  $('preset-select').value = '';
  queueUpdate();
});
$('tone-list').addEventListener('click', event => {
  const button = event.target.closest('[data-remove]'); if (!button) return;
  state.tones.splice(Number(button.dataset.remove), 1); $('preset-select').value = ''; renderTones(); updateAnalysis();
});
$('add-tone').addEventListener('click', () => {
  state.tones.push(makeTone(220, state.tones.length % 2 ? 'R' : 'L'));
  $('preset-select').value = '';
  renderTones(); updateAnalysis();
});
$('mode').addEventListener('change', event => { state.mode = event.target.value; updateAnalysis(); });
$('master-volume').addEventListener('input', event => {
  state.masterVolume = Number(event.target.value);
  $('master-value').textContent = `${Math.round(state.masterVolume * 100)}%`;
  engine.setVolume(state.masterVolume); persist();
});
$('duration').addEventListener('change', event => { state.duration = Number(event.target.value); engine.setDuration(state.duration); persist(); });
$('time-window').addEventListener('change', event => { state.timeWindow = Number(event.target.value); draw(); persist(); });
$('preset-select').addEventListener('change', event => {
  const pair = { binaural: [200, 210], unison: [220, 220], fifth: [220, 330] }[event.target.value];
  if (!pair) return;
  state.tones = [makeTone(pair[0], 'L'), makeTone(pair[1], 'R')];
  renderTones(); updateAnalysis();
});

$('play-btn').addEventListener('click', async () => {
  clearTimeout(changeTimer);
  if (starting || engine.running) return;
  updateAnalysis(false);
  if ($('play-btn').disabled) return;
  starting = true; $('play-btn').disabled = true; $('stop-btn').disabled = false;
  setStatus('Iniciando audio…');
  try {
    if (globalThis.REsoundAndroid && !globalThis.REsoundAndroid.requestAudioFocus()) throw new Error('Android no pudo iniciar el audio. Vuelve a pulsar Reproducir.');
    await engine.start(state, state.masterVolume, state.duration);
    if (engine.running) setStatus(state.experimentStyle === 'binaural' ? 'Reproduciendo · L/R separados' : 'Reproduciendo');
  } catch (error) { engine.stop(); setStatus(error.message, true); }
  finally { starting = false; $('play-btn').disabled = engine.running; $('stop-btn').disabled = !engine.running; }
});
$('stop-btn').addEventListener('click', () => engine.stop());
document.addEventListener('keydown', event => {
  if (event.key === 'Escape') engine.stop();
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden && (engine.running || engine.starting)) engine.stop('Detenido al salir de la herramienta.');
});
globalThis.addEventListener('pagehide', () => engine.stop());
setInterval(() => {
  if (!engine.running) return;
  const elapsed = Math.floor(engine.elapsed());
  $('elapsed').textContent = `${String(Math.floor(elapsed / 60)).padStart(2, '0')}:${String(elapsed % 60).padStart(2, '0')}`;
}, 250);

for (const [id, field] of [['session-name', 'sessionName'], ['session-notes', 'sessionNotes']]) {
  $(id).addEventListener('input', event => { state[field] = event.target.value; persist(); });
}

function renderSessions() {
  const list = $('saved-sessions'); list.replaceChildren();
  if (!sessions.length) {
    const empty = document.createElement('p'); empty.textContent = globalThis.REsoundAndroid ? 'Tus pruebas se guardan en este teléfono. Exporta para conservar una copia.' : 'Tus pruebas se guardan en este navegador. Exporta para conservar una copia.'; list.append(empty); return;
  }
  sessions.forEach((session, index) => {
    const row = document.createElement('div'); row.className = 'saved-session';
    const label = document.createElement('span'); label.textContent = session.name;
    const actions = document.createElement('div'); actions.className = 'saved-actions';
    const load = document.createElement('button'); load.type = 'button'; load.textContent = 'Cargar'; load.setAttribute('aria-label', `Cargar ${session.name}`);
    load.addEventListener('click', () => {
      try {
        engine.stop(); state = unpack(session); renderControls(); updateAnalysis(false);
        setStatus('Sesión cargada · volumen 8%');
      } catch (error) { setStatus(error.message, true); }
    });
    const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = 'Eliminar'; remove.setAttribute('aria-label', `Eliminar ${session.name}`);
    remove.addEventListener('click', () => {
      const next = sessions.filter((_, i) => i !== index);
      try { localStorage.setItem(SESSIONS_KEY, JSON.stringify(next)); sessions = next; renderSessions(); }
      catch { setStatus('No se pudo actualizar el almacenamiento del navegador.', true); }
    });
    actions.append(load, remove); row.append(label, actions); list.append(row);
  });
}

function snapshot() {
  const configuration = structuredClone(state);
  if (configuration.experimentStyle === 'binaural') {
    configuration.mode = 'stereo';
    configuration.tones = binauralTones(configuration.baseFrequency, configuration.beatFrequency);
  }
  const validation = validate(configuration);
  if (!validation.ok) throw new Error('Corrige las frecuencias antes de guardar la sesión.');
  return {
    format: 'resound-frecuencias', version: 1,
    name: state.sessionName.trim() || 'Mi prueba', savedAt: new Date().toISOString(),
    configuration,
  };
}
$('save-session').addEventListener('click', () => {
  try {
    const record = snapshot();
    const next = [record, ...sessions];
    localStorage.setItem(SESSIONS_KEY, JSON.stringify(next)); sessions = next; renderSessions();
    setStatus(globalThis.REsoundAndroid ? 'Prueba guardada en el teléfono.' : 'Prueba guardada en este navegador.');
  } catch (error) { setStatus(`No se pudo guardar: ${error.message}`, true); }
});
$('export-session').addEventListener('click', () => {
  try {
    const data = snapshot();
    const json = JSON.stringify(data, null, 2);
    const fileName = `resound-${data.name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').slice(0, 48) || 'sesion'}.json`;
    if (globalThis.REsoundAndroid) { globalThis.REsoundAndroid.exportSession(fileName, json); setStatus('Elige dónde guardar la prueba.'); return; }
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob); const link = document.createElement('a');
    link.href = url; link.download = fileName;
    document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 3000);
    setStatus('Copia JSON preparada para descargar.');
  } catch (error) { setStatus(error.message, true); }
});
function importJSON(json) {
  if (new TextEncoder().encode(json).length > 2_000_000) throw new Error('El archivo es demasiado grande para una prueba de tonos.');
  const data = JSON.parse(json);
  if (data.format !== 'resound-frecuencias' || data.version !== 1) throw new Error('Selecciona una prueba JSON exportada por REsound.');
  const imported = unpack(data); engine.stop(); state = imported; renderControls(); updateAnalysis(false);
  setStatus('Prueba importada · volumen 8%');
}
$('import-session').addEventListener('click', () => {
  if (globalThis.REsoundAndroid) globalThis.REsoundAndroid.importSession();
  else $('import-file').click();
});
globalThis.addEventListener('resound-native-import', event => {
  try {
    if (event.detail?.error) throw new Error(event.detail.error);
    if (typeof event.detail?.json !== 'string') throw new Error('No se recibió el archivo.');
    importJSON(event.detail.json);
  } catch (error) { setStatus(`No se pudo importar: ${error.message}`, true); }
});
globalThis.addEventListener('resound-native-export', event => {
  setStatus(event.detail?.error ? `No se pudo exportar: ${event.detail.error}` : 'Prueba exportada.', Boolean(event.detail?.error));
});
$('import-file').addEventListener('change', async event => {
  const file = event.target.files?.[0]; if (!file) return;
  try {
    if (file.size > 2_000_000) throw new Error('El archivo es demasiado grande para una sesión de tonos.');
    importJSON(await file.text());
  } catch (error) { setStatus(`No se pudo importar: ${error.message}`, true); }
  event.target.value = '';
});

graphHint = document.createElement('p'); graphHint.className = 'field-help';
$('waveform').parentElement.after(graphHint);
new ResizeObserver(() => draw()).observe($('waveform').parentElement);
renderControls(); renderSessions(); updateAnalysis(false);
