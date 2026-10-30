// Serial plotter: graphs the numbers a sketch prints, the way the Arduino IDE does.

import { sizeCanvas } from '../ui/draw.js';

const WINDOW = 6;   // seconds of sim time on screen
const MAX_SERIES = 8;
const palette = ['#1c5a70', '#d9a90d', '#e2484e', '#3fae6a', '#7a5bc7', '#2a9fd6', '#c2410c', '#4b5d64'];

// "12", "1.5, 2 3", "err:-2 speed:120" or "err: -2". Words that aren't numbers are skipped.
export function parsePlotLine(text) {
  const out = [];
  const parts = text.trim().split(/[\s,]+/);
  for (let i = 0; i < parts.length; i++) {
    let p = parts[i];
    let label = null;
    const c = p.lastIndexOf(':');
    if (c >= 0) {
      label = p.slice(0, c);
      p = p.slice(c + 1);
      if (!p && i + 1 < parts.length) p = parts[++i];
    }
    const v = p === '' ? NaN : Number(p);
    if (!Number.isFinite(v)) continue;
    out.push({ label: label || `value ${out.length + 1}`, value: v });
  }
  return out;
}

export function createPlot() {
  return { series: new Map(), t: 0 };
}

export function addPoint(plot, label, t, value, sensor = false) {
  let s = plot.series.get(label);
  if (!s) {
    if (plot.series.size >= MAX_SERIES) return;
    const used = new Set([...plot.series.values()].map(x => x.color));
    s = { label, sensor, color: palette.find(c => !used.has(c)), pts: [] };
    plot.series.set(label, s);
  }
  s.pts.push([t, value]);
  if (s.pts.length > 5000) s.pts.splice(0, 1000);   // drawPlot trims too, but only while it's on screen
  if (t > plot.t) plot.t = t;
}

export function clearPlot(plot, onlySensors = false) {
  for (const [k, s] of plot.series) if (!onlySensors || s.sensor) plot.series.delete(k);
  if (!onlySensors) plot.t = 0;
}

export const fmt = v => String(Math.abs(v) >= 100 ? Math.round(v) : +v.toPrecision(3));

export function drawPlot(canvas, plot) {
  const g = canvas.getContext('2d');
  const { w, h, dpr } = sizeCanvas(canvas);
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, h);
  const t1 = Math.max(plot.t, WINDOW);
  const t0 = t1 - WINDOW;
  let lo = Infinity, hi = -Infinity;
  for (const s of plot.series.values()) {
    let k = 0;
    while (k < s.pts.length && s.pts[k][0] < t0) k++;
    if (k) s.pts.splice(0, k);
    for (const [, v] of s.pts) { if (v < lo) lo = v; if (v > hi) hi = v; }
  }
  if (lo > hi) return false;
  if (lo === hi) { lo -= 1; hi += 1; }
  const pad = (hi - lo) * 0.08;
  lo -= pad; hi += pad;
  const x = t => ((t - t0) / WINDOW) * w;
  const y = v => h - 4 - ((v - lo) / (hi - lo)) * (h - 8);

  g.strokeStyle = 'rgba(21,35,42,0.1)';
  g.lineWidth = 1;
  g.beginPath();
  for (const v of lo < 0 && hi > 0 ? [0] : [(lo + hi) / 2]) { g.moveTo(0, y(v)); g.lineTo(w, y(v)); }
  g.stroke();
  for (const s of plot.series.values()) {
    g.strokeStyle = s.color;
    g.lineWidth = 1.8;
    g.beginPath();
    s.pts.forEach(([t, v], i) => { if (i) g.lineTo(x(t), y(v)); else g.moveTo(x(t), y(v)); });
    g.stroke();
  }
  g.fillStyle = '#7c8b91';
  g.font = '11px JetBrains Mono, monospace';
  g.fillText(fmt(hi - pad), 6, 13);
  g.fillText(fmt(lo + pad), 6, h - 7);
  return true;
}

export function renderLegend(host, plot) {
  const list = [...plot.series.values()];
  const key = list.map(s => s.label).join('\n');
  if (host.dataset.key !== key) {
    host.dataset.key = key;
    host.replaceChildren(...list.map(s => {
      const item = document.createElement('span');
      item.style.setProperty('--c', s.color);
      item.append(s.label, document.createElement('b'));
      return item;
    }));
  }
  list.forEach((s, i) => {
    const last = s.pts[s.pts.length - 1];
    host.children[i].lastChild.textContent = last ? fmt(last[1]) : '';
  });
}
