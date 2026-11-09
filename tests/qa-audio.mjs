import { createAudioGraph } from '../dist/audio-engine.mjs';
import { analyze, sampleAt } from '../dist/audio-core.mjs';

const RATE = 48000;
const LENGTH = 48000;
const AMPLITUDE_TOLERANCE = 0.0005;
const SAMPLE_TOLERANCE = 0.001;
const results = [];
const summary = document.getElementById('qa-summary');
const table = document.getElementById('qa-results');
const tone = (frequency, channel, phase = 0, gain = 1) => ({ id: `${channel}-${frequency}`, frequency, channel, phase, gain, enabled: true });
const standard = mode => ({ mode, tones: [tone(200, 'L'), tone(210, 'R')] });
const fmt = number => Math.abs(number) < 0.0001 ? number.toExponential(3) : number.toFixed(6);

function expectClose(actual, expected, label, tolerance = AMPLITUDE_TOLERANCE) {
  if (!Number.isFinite(actual) || Math.abs(actual - expected) > tolerance) {
    throw new Error(`${label}: ${fmt(actual)}; esperado ${expected} ± ${tolerance}`);
  }
}

function coefficient(samples, frequency) {
  let cos = 0, sin = 0, sum = 0;
  const step = 2 * Math.PI * frequency / RATE;
  for (let i = 0; i < samples.length; i++) {
    const value = samples[i];
    sum += value;
    cos += value * Math.cos(step * i);
    sin += value * Math.sin(step * i);
  }
  cos *= 2 / samples.length;
  sin *= 2 / samples.length;
  return { cos, sin, amplitude: Math.hypot(cos, sin), mean: sum / samples.length };
}

async function render(config) {
  const OfflineContext = globalThis.OfflineAudioContext || globalThis.webkitOfflineAudioContext;
  if (!OfflineContext) throw new Error('OfflineAudioContext no está disponible.');
  const context = new OfflineContext(2, LENGTH, RATE);
  const analysis = analyze(config);
  const graph = createAudioGraph(context, analysis, { startTime: 0, fadeSeconds: 0, volume: 1 });
  const buffer = await context.startRendering();
  for (const node of graph.nodes) { try { node.disconnect(); } catch {} }
  return { left: buffer.getChannelData(0), right: buffer.getChannelData(1), analysis };
}

async function check(name, action) {
  let result;
  try { result = { name, pass: true, detail: await action() }; }
  catch (error) { result = { name, pass: false, detail: error.stack || error.message || String(error) }; }
  results.push(result);
  const row = document.createElement('tr');
  const nameCell = document.createElement('td');
  nameCell.textContent = result.name;
  const statusCell = document.createElement('td');
  statusCell.className = result.pass ? 'pass' : 'fail';
  statusCell.textContent = result.pass ? 'PASS' : 'FAIL';
  const detailCell = document.createElement('td');
  detailCell.textContent = result.detail;
  row.append(nameCell, statusCell, detailCell);
  table.append(row);
  summary.textContent = `RUNNING · ${results.filter(r => r.pass).length} PASS / ${results.filter(r => !r.pass).length} FAIL`;
}

await check('Estéreo: 200 Hz en L, 210 Hz en R; sin cruce de canales', async () => {
  const audio = await render(standard('stereo'));
  const l200 = coefficient(audio.left, 200), l210 = coefficient(audio.left, 210);
  const r200 = coefficient(audio.right, 200), r210 = coefficient(audio.right, 210);
  expectClose(l200.sin, 1, 'L · 200 Hz');
  expectClose(r210.sin, 1, 'R · 210 Hz');
  expectClose(l210.amplitude, 0, 'Cruce R→L');
  expectClose(r200.amplitude, 0, 'Cruce L→R');
  return `L200=${fmt(l200.sin)}, R210=${fmt(r210.sin)}; cruce L210=${fmt(l210.amplitude)}, R200=${fmt(r200.amplitude)}.`;
});

await check('Suma: 200/210 Hz a 0.5; sin 10/410 Hz nuevos', async () => {
  const audio = await render(standard('sum'));
  const measured = {};
  for (const channel of ['left', 'right']) {
    for (const [frequency, expected] of [[200, 0.5], [210, 0.5], [10, 0], [410, 0]]) {
      const item = coefficient(audio[channel], frequency);
      measured[`${channel}-${frequency}`] = item.amplitude;
      expectClose(item.amplitude, expected, `${channel} · ${frequency} Hz`);
    }
  }
  return `L200=${fmt(measured['left-200'])}, L210=${fmt(measured['left-210'])}; L10=${fmt(measured['left-10'])}, L410=${fmt(measured['left-410'])}; ambas salidas verificadas.`;
});

await check('Multiplicación: 10 Hz a +0.5 cos, 410 Hz a −0.5 cos; sin originales', async () => {
  const audio = await render(standard('multiply'));
  const measured = {};
  for (const channel of ['left', 'right']) {
    const difference = coefficient(audio[channel], 10);
    const sum = coefficient(audio[channel], 410);
    const originalA = coefficient(audio[channel], 200);
    const originalB = coefficient(audio[channel], 210);
    expectClose(difference.cos, 0.5, `${channel} · cos 10 Hz`);
    expectClose(difference.sin, 0, `${channel} · sin 10 Hz`);
    expectClose(sum.cos, -0.5, `${channel} · cos 410 Hz`);
    expectClose(sum.sin, 0, `${channel} · sin 410 Hz`);
    expectClose(originalA.amplitude, 0, `${channel} · 200 Hz`);
    expectClose(originalB.amplitude, 0, `${channel} · 210 Hz`);
    measured[channel] = { difference, sum, originalA, originalB };
  }
  return `cos10=${fmt(measured.left.difference.cos)}, cos410=${fmt(measured.left.sum.cos)}; 200=${fmt(measured.left.originalA.amplitude)}, 210=${fmt(measured.left.originalB.amplitude)}; ambos canales verificados.`;
});

await check('Frecuencias iguales multiplicadas: DC excluida; 400 Hz a 0.5', async () => {
  const config = { mode: 'multiply', tones: [tone(200, 'L'), tone(200, 'R')] };
  const audio = await render(config);
  expectClose(audio.analysis.dc.left, 0.5, 'DC ideal');
  const measurements = [];
  for (const channel of ['left', 'right']) {
    const result = coefficient(audio[channel], 400);
    expectClose(result.cos, -0.5, `${channel} · cos 400 Hz`);
    expectClose(result.amplitude, 0.5, `${channel} · amplitud 400 Hz`);
    expectClose(result.mean, 0, `${channel} · media/DC reproducida`, 0.00001);
    measurements.push(`${channel}: cos400=${fmt(result.cos)}, media=${fmt(result.mean)}`);
  }
  return `DC matemática=0.5, omitida en Web Audio. ${measurements.join('; ')}.`;
});

for (const mode of ['stereo', 'sum', 'multiply']) {
  await check(`Fases 90°/180° · ${mode}: muestras frente a señal matemática sin DC`, async () => {
    const config = { mode, tones: [tone(200, 'L', 90, 0.7), tone(210, 'R', 180, 0.4)] };
    const audio = await render(config);
    let maximum = 0, comparisons = 0;
    const indices = new Set([0, 1, 2, 127, 128, 129, LENGTH - 1]);
    for (let index = 0; index < LENGTH; index += 97) indices.add(index);
    for (const index of indices) {
      const ideal = sampleAt(config, index / RATE);
      for (const channel of ['left', 'right']) {
        const expected = ideal[channel] - audio.analysis.dc[channel];
        maximum = Math.max(maximum, Math.abs(audio[channel][index] - expected));
        comparisons++;
      }
    }
    expectClose(maximum, 0, 'Error máximo de muestras', SAMPLE_TOLERANCE);
    return `${comparisons} comparaciones; error máximo=${fmt(maximum)}; tolerancia=${SAMPLE_TOLERANCE}.`;
  });
}

const passed = results.filter(result => result.pass).length;
const failed = results.length - passed;
summary.textContent = `${failed ? 'FAIL' : 'PASS'} · ${passed}/${results.length} pruebas Web Audio · ${failed} fallos · 48 000 Hz · 2 canales · sin altavoz`;
summary.dataset.status = failed ? 'fail' : 'pass';
summary.className = failed ? 'fail' : 'pass';
globalThis.REsoundAudioQA = { passed, failed, results, sampleRate: RATE, frames: LENGTH, channels: 2 };
