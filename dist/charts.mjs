const PALETTE = { L: '#71ddd2', R: '#f4a18e', text: '#c6cdd4', muted: '#8e9ba8', grid: '#28323d' };
const TAU = Math.PI * 2;
export const number = value => Number.isFinite(value)
  ? new Intl.NumberFormat('es', { maximumFractionDigits: 4, notation: Math.abs(value) >= 1e7 ? 'scientific' : 'standard' }).format(value)
  : '—';

function surface(canvas, height) {
  const width = Math.max(240, canvas.parentElement.clientWidth);
  const ratio = Math.min(2, globalThis.devicePixelRatio || 1);
  canvas.style.width = '100%';
  canvas.style.height = `${height}px`;
  canvas.width = Math.round(width * ratio);
  canvas.height = Math.round(height * ratio);
  const ctx = canvas.getContext('2d');
  ctx.scale(ratio, ratio);
  ctx.clearRect(0, 0, width, height);
  ctx.font = '12px system-ui, sans-serif';
  ctx.lineWidth = 1;
  return { ctx, width, height };
}

function text(ctx, value, x, y, color = PALETTE.muted, align = 'left') {
  ctx.fillStyle = color; ctx.textAlign = align; ctx.fillText(value, x, y);
}

function acAt(parts, t) {
  let value = 0;
  for (const p of parts) {
    const phase = TAU * ((p.frequency * t) % 1);
    value += p.cos * Math.cos(phase) + p.sin * Math.sin(phase);
  }
  return value;
}

export function drawWaveform(canvas, analysis, seconds) {
  const { ctx, width, height } = surface(canvas, 232);
  const left = 47, right = width - 13, top = 23, bottom = height - 36;
  const plotWidth = right - left;
  const amplitudeBound = Math.max(1, ...[analysis.left, analysis.right].map(parts => parts.reduce((sum, p) => sum + Math.hypot(p.cos, p.sin), 0)));
  const y = value => top + (1 - value / amplitudeBound) * (bottom - top) / 2;
  for (const tick of [-1, 0, 1]) {
    ctx.strokeStyle = PALETTE.grid; ctx.beginPath(); ctx.moveTo(left, y(tick * amplitudeBound)); ctx.lineTo(right, y(tick * amplitudeBound)); ctx.stroke();
    text(ctx, number(tick * amplitudeBound), left - 10, y(tick * amplitudeBound) + 4, PALETTE.muted, 'right');
  }
  for (let i = 0; i <= 3; i++) {
    const x = left + i * plotWidth / 3;
    text(ctx, number(seconds * 1000 * i / 3), x, bottom + 20, PALETTE.muted, i === 0 ? 'left' : i === 3 ? 'right' : 'center');
  }
  text(ctx, 'Amplitud', left, 13);
  text(ctx, 'Tiempo (ms)', right, height - 1, PALETTE.muted, 'right');
  ctx.save(); ctx.beginPath(); ctx.rect(left, top, plotWidth, bottom - top); ctx.clip();
  const dense = analysis.maxFrequency * seconds / plotWidth > 0.45;
  // Dense waveforms use min/max columns, not an undersampled connecting line.
  // Beyond the sampling budget each column is an analytic envelope bound.
  const analyticBounds = analysis.maxFrequency * seconds > 16000;
  for (const [channel, parts] of [['L', analysis.left], ['R', analysis.right]]) {
    ctx.strokeStyle = PALETTE[channel]; ctx.fillStyle = PALETTE[channel];
    ctx.lineWidth = channel === 'L' ? 1.7 : 1.25;
    ctx.globalAlpha = dense ? 0.48 : 0.95;
    if (dense) {
      const perColumn = Math.max(12, Math.ceil(analysis.maxFrequency * seconds / plotWidth * 12));
      for (let px = 0; px < plotWidth; px++) {
        let lo = Infinity, hi = -Infinity;
        if (analyticBounds) {
          let center = 0, radius = 0;
          const mid = (px + 0.5) / plotWidth * seconds;
          const half = seconds / plotWidth / 2;
          for (const p of parts) {
            center += acAt([p], mid);
            radius += Math.min(2, TAU * p.frequency * half) * Math.hypot(p.cos, p.sin);
          }
          const bound = parts.reduce((sum, p) => sum + Math.hypot(p.cos, p.sin), 0);
          lo = Math.max(-bound, center - radius); hi = Math.min(bound, center + radius);
        } else {
          for (let j = 0; j <= perColumn; j++) {
            const value = acAt(parts, (px + j / perColumn) / plotWidth * seconds);
            lo = Math.min(lo, value); hi = Math.max(hi, value);
          }
        }
        ctx.beginPath(); ctx.moveTo(left + px, y(lo)); ctx.lineTo(left + px, y(hi)); ctx.stroke();
      }
    } else {
      ctx.beginPath();
      for (let i = 0; i <= plotWidth * 2; i++) {
        const x = i / 2, value = acAt(parts, x / plotWidth * seconds);
        if (!i) ctx.moveTo(left + x, y(value)); else ctx.lineTo(left + x, y(value));
      }
      ctx.stroke();
    }
  }
  ctx.restore();
  const hint = analyticBounds ? 'Vista densa: envolvente acotada por píxel' : dense ? 'Vista densa: mínimos y máximos por píxel' : 'Señal ideal antes del volumen';
  canvas.setAttribute('aria-label', `Onda estéreo en ${number(seconds * 1000)} milisegundos. ${hint}.`);
  return hint;
}

export function drawSpectrum(canvas, analysis) {
  const { ctx, width, height } = surface(canvas, 220);
  const left = 47, right = width - 13, top = 25, bottom = height - 37;
  const all = [...analysis.left, ...analysis.right];
  const frequencies = [...new Set(all.map(p => p.frequency))].sort((a, b) => a - b);
  const min = frequencies[0] ?? 0, max = frequencies.at(-1) ?? 1;
  const span = Math.max(max - min, Math.max(1, max) * 0.04);
  const domainMin = Math.max(0, min - span * 0.13), domainMax = max + span * 0.13;
  const plotWidth = right - left;
  const maximum = Math.max(1, ...all.map(p => Math.hypot(p.cos, p.sin)));
  const x = f => left + (f - domainMin) / (domainMax - domainMin) * plotWidth;
  const y = amp => bottom - amp / maximum * (bottom - top);
  for (let i = 0; i <= 2; i++) {
    const yy = y(i * maximum / 2);
    ctx.strokeStyle = PALETTE.grid; ctx.beginPath(); ctx.moveTo(left, yy); ctx.lineTo(right, yy); ctx.stroke();
    text(ctx, number(i * maximum / 2), left - 10, yy + 4, PALETTE.muted, 'right');
  }
  for (let i = 0; i <= 3; i++) {
    const value = domainMin + (domainMax - domainMin) * i / 3;
    text(ctx, number(value), left + plotWidth * i / 3, bottom + 20, PALETTE.muted, i === 0 ? 'left' : i === 3 ? 'right' : 'center');
  }
  text(ctx, 'Amplitud', left, 13);
  text(ctx, 'Frecuencia (Hz)', right, height - 1, PALETTE.muted, 'right');
  ctx.save(); ctx.beginPath(); ctx.rect(left, top - 1, plotWidth, bottom - top + 2); ctx.clip();
  for (const [channel, parts] of [['L', analysis.left], ['R', analysis.right]]) {
    ctx.strokeStyle = PALETTE[channel]; ctx.fillStyle = PALETTE[channel]; ctx.lineWidth = 3;
    for (const p of parts) {
      const xx = x(p.frequency) + (channel === 'L' ? -2 : 2), yy = y(Math.hypot(p.cos, p.sin));
      ctx.beginPath(); ctx.moveTo(xx, bottom); ctx.lineTo(xx, yy); ctx.stroke();
      ctx.beginPath(); ctx.arc(xx, yy, 3, 0, TAU); ctx.fill();
    }
  }
  ctx.restore();
  if (!frequencies.length) text(ctx, 'Sin componentes de audio', left + plotWidth / 2, (top + bottom) / 2, PALETTE.text, 'center');
  canvas.setAttribute('aria-label', `Espectro ideal de ${frequencies.length} frecuencias distintas: ${frequencies.map(f => `${number(f)} Hz`).join(', ') || 'silencio'}. Los valores por canal están debajo de la gráfica.`);
}
