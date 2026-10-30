import { store } from './store.js';
import { onTab, pipMood } from './main.js';
import { createSim } from '../engine/sim.js';
import { lint, diagnose, lineDiff } from '../engine/coach.js';
import { exampleFor, starterFor } from '../engine/examples.js';
import { irChannels, sensors as sensorDefs, wiringIssues } from '../engine/parts.js';
import { fitView, drawArena, drawRobot, drawTrail, drawGhost, drawMarkers, liveFromSim, drawCameraView, sizeCanvas } from '../ui/draw.js';
import { parsePlotLine, createPlot, addPoint, clearPlot, drawPlot, renderLegend } from './plotter.js';
import { findTunables, formatTuned, renderTune } from './tune.js';
import { setIcon, icons } from '../ui/icons.js';
import { showScore } from './challenges.js';

const $ = id => document.getElementById(id);
const el = (tag, { dataset, ...props } = {}, ...kids) => {
  const n = Object.assign(document.createElement(tag), props);
  if (dataset) Object.assign(n.dataset, dataset);
  for (const k of kids) n.append(k);
  return n;
};

// ---------- editor ----------

// CodeMirror is a big download, so it loads the first time it's needed.
// Until then the code lives only in the store.
let view = null;
let editorLoading = null;
function loadEditor() {
  editorLoading ||= import('./editor.js').then(({ createEditor }) => {
    view = createEditor({
      parent: $('editor'),
      doc: store.project.code,
      lintSource,
      onChange(code) {
        store.project.code = code;
        store.saveSoon();
        clearTimeout(tuneTimer);
        tuneTimer = setTimeout(refreshTune, 250);
      },
    });
    if (visible) view.requestMeasure();
    refreshTune();
  }, err => {
    editorLoading = null;   // try again next time
    throw err;
  });
  return editorLoading;
}

function lintSource(v) {
  const doc = v.state.doc;
  return lint(doc.toString()).map(f => {
    const line = doc.line(Math.min(Math.max(1, f.line), doc.lines));
    return { from: line.from, to: line.to, severity: f.severity === 'error' ? 'error' : 'warning', message: `${f.title}. ${f.detail}` };
  });
}

function setCode(text) {
  if (view) view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } });
  else { store.project.code = text; store.saveSoon(); }
}

// Phones show the sketch and the simulator one at a time
const phone = matchMedia('(max-width: 860px)');
function showView(v) {
  const panel = $('tab-run');
  panel.classList.toggle('view-code', v === 'code');
  panel.classList.toggle('view-sim', v === 'sim');
  for (const b of $('run-switch').children) b.setAttribute('aria-pressed', b.dataset.view === v);
  if (v === 'code' && view) view.requestMeasure();
}

async function goToLine(n) {
  if (!n) return;
  if (phone.matches) showView('code');
  await loadEditor();
  const doc = view.state.doc;
  const line = doc.line(Math.min(Math.max(1, n), doc.lines));
  view.dispatch({ selection: { anchor: line.from, head: line.to }, scrollIntoView: true });
  view.focus();
}

// ---------- tune ----------

let tuneTimer = 0;
function refreshTune() {
  if (view) renderTune($('tune'), $('tune-rows'), findTunables(view.state.doc.toString()), tune);
}

// A slider moved: rewrite that number in the sketch and, if it's running, start over with it
function tune(name, value, step) {
  const c = findTunables(view.state.doc.toString()).find(x => x.name === name);
  if (!c) return;
  view.dispatch({ changes: { from: c.from, to: c.to, insert: formatTuned(c, value, step) } });
  if (playing) start();
}

function downloadSketch() {
  const name = (store.project.robot.name || '').replace(/\W+/g, '_').replace(/^_+|_+$/g, '') || 'robot';
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([store.project.code], { type: 'text/plain' }));
  a.download = `${name}.ino`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// ---------- simulation ----------

const canvas = $('sim-canvas');
const ctx = canvas.getContext('2d');
let sim = null;
let playing = false;
let visible = false;
let focusPoint = null;
let last = performance.now();
let serialLast = null;
// The trail of the last run that finished, and the one shown faintly under this run
let lastTrail = null;
let ghost = null;

// Index just after `prev` in a list that drops old items from the front
const after = (list, prev) => (prev ? list.lastIndexOf(prev) + 1 : 0);

function speed() { return +$('sim-speed').value; }

function setStatus(text, kind) {
  const s = $('sim-status');
  s.textContent = text;
  s.className = 'sim-status' + (text ? ' show' : '') + (kind ? ' ' + kind : '');
}

function setRunButton() {
  const b = $('btn-run');
  const label = playing ? 'Pause' : sim && sim.state.status === 'running' && sim.state.t > 0 ? 'Resume' : 'Run';
  setIcon(b, playing ? 'pause' : 'play', label);
  b.classList.toggle('playing', playing);
}

// Motor power over the last few seconds of sim time
const motorHist = [];
let motorClock = 0;
function recordMotors(st) {
  while (motorClock < st.t) {
    motorClock += 0.025;
    const prev = motorHist[motorHist.length - 1] || { l: 0, r: 0 };
    motorHist.push({ l: prev.l + (st.wheel.tl - prev.l) * 0.4, r: prev.r + (st.wheel.tr - prev.r) * 0.4 });
  }
  while (motorHist.length > 240) motorHist.shift();
}
function drawMotorChart() {
  const c = $('motor-chart');
  const g = c.getContext('2d');
  const { w, h, dpr } = sizeCanvas(c);
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, h);
  g.strokeStyle = 'rgba(21,35,42,0.1)';
  g.lineWidth = 1;
  g.beginPath(); g.moveTo(0, h / 2); g.lineTo(w, h / 2); g.stroke();
  for (const [key, color] of [['l', '#1c5a70'], ['r', '#d9a90d']]) {
    g.strokeStyle = color;
    g.lineWidth = 1.8;
    g.beginPath();
    motorHist.forEach((p, i) => {
      const x = w - ((motorHist.length - 1 - i) / 240) * w;
      const y = h / 2 - Math.max(-1, Math.min(1, p[key])) * (h / 2 - 3);
      if (i) g.lineTo(x, y); else g.moveTo(x, y);
    });
    g.stroke();
  }
}

function reset() {
  sim = null;
  playing = false;
  focusPoint = null;
  serialLast = null;
  $('dock-serial').textContent = '';
  resetPlot();
  $('sim-clock').textContent = '0.0 s';
  setStatus('');
  setRunButton();
  pipMood(null);
  renderReadout(null);
  motorHist.length = 0;
  motorClock = 0;
}

function start() {
  const p = store.project;
  const problems = lint(p.code).filter(f => f.severity === 'error');
  if (problems.length) {
    renderCoach({ status: 'fail', headline: `Fix ${problems.length === 1 ? 'this' : 'these'} before it will compile`, findings: problems, example: null, compile: true });
    setStatus(`${problems.length} compile ${problems.length === 1 ? 'error' : 'errors'}`, 'fail');
    selectDock('coach');
    pipMood('sad');
    if (phone.matches) showView('sim');
    return;
  }
  if (phone.matches) showView('sim');
  sim = createSim({ robot: p.robot, arena: p.arena, source: p.code, timeLimit: 90 });
  serialLast = null;
  $('dock-serial').textContent = '';
  resetPlot();
  ghost = lastTrail;
  if (sim.state.status !== 'running') { finish(); return; }
  playing = true;
  pipMood('busy');
  setStatus('');
  renderCoach(null, true);
  setRunButton();
}

function finish() {
  playing = false;
  setRunButton();
  if (sim.state.trail.length > 1) lastTrail = sim.state.trail.slice();
  const p = store.project;
  const report = diagnose({ robot: p.robot, arena: p.arena, source: p.code, sim, kind: p.kind });
  const hard = wiringIssues(p.robot).filter(i => !i.soft);
  for (const i of hard) report.findings.unshift({ severity: 'warn', title: 'Wiring', detail: i.msg });
  renderCoach(report);
  selectDock('coach');
  if (report.status === 'pass') { setStatus(report.headline, 'pass'); pipMood('happy'); }
  else if (report.status === 'stopped') { setStatus('Stopped'); pipMood(null); }
  else { setStatus(sim.state.result.message, 'fail'); pipMood('sad'); }
  showScore({ sim, arena: p.arena, kind: p.kind });
}

function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (sim && playing) {
    sim.advance(dt * speed());
    if (sim.state.status !== 'running') finish();
  }
  if (visible) draw(now);
  requestAnimationFrame(frame);
}

function draw(now) {
  const p = store.project;
  const a = p.arena;
  const follow = $('follow').checked && sim;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  let v;
  if (follow) {
    const zoomW = 900, zoomH = 600;
    v = fitView(canvas, zoomW, zoomH, 0);
    const pose = sim.state.pose;
    v.apply(ctx);
    ctx.translate(zoomW / 2 - pose.x, zoomH / 2 - pose.y);
  } else {
    v = fitView(canvas, a.w, a.h, 18);
    v.apply(ctx);
  }
  const st = sim && sim.state;
  drawArena(ctx, a, { objects: st ? st.objects : a.objects, checkpoints: st && st.checkpoints, showStart: !st });
  const showGhost = !!(st && ghost && $('ghost').checked);
  if (showGhost) drawGhost(ctx, ghost);
  if ($('ghost-key').hidden === showGhost) $('ghost-key').hidden = !showGhost;
  if (st) {
    drawTrail(ctx, st.trail);
    drawMarkers(ctx, st.markers, now / 1000, v.scale);
    drawRobot(ctx, p.robot, st.pose, liveFromSim(sim));
    $('sim-clock').textContent = `${st.t.toFixed(1)} s`;
    renderReadout(st);
    flushSerial(st);
    feedPlot(st);
    recordMotors(st);
  } else {
    drawRobot(ctx, p.robot, a.start, {});
  }
  const hasCam = p.robot.sensors.some(s => s.type === 'camera');
  $('cam-view').hidden = !hasCam;
  if (hasCam) drawCameraView($('cam-canvas'), st ? st.camera : null);
  drawMotorChart();
  if (!$('dock-plot').hidden) {
    $('plot-empty').hidden = drawPlot($('plot-canvas'), plot);
    renderLegend($('plot-legend'), plot);
  }
  if (focusPoint) {
    const r = 60 + Math.sin(now / 150) * 10;
    ctx.strokeStyle = 'rgba(243,195,38,0.9)';
    ctx.lineWidth = 6;
    ctx.beginPath(); ctx.arc(focusPoint.x, focusPoint.y, r, 0, Math.PI * 2); ctx.stroke();
  }
}

// ---------- readout and serial ----------

let readoutBuilt = false;
function renderReadout(st) {
  const host = $('readout');
  const robot = store.project.robot;
  const chans = irChannels(robot);
  const sonars = robot.sensors.filter(s => sensorDefs[s.type].kind === 'sonar');
  if (!readoutBuilt || !st) {
    host.replaceChildren();
    if (chans.length) {
      const leds = el('span', { className: 'leds', title: 'Line sensors, left to right' });
      chans.forEach(() => leds.append(el('i')));
      host.append(el('span', {}, 'IR '), leds);
    }
    for (const side of ['L', 'R']) {
      host.append(el('span', { className: 'meter' }, `Motor ${side === 'L' ? 'A' : 'B'}`, el('b', { dataset: { m: side } })));
    }
    for (const s of sonars) host.append(el('span', {}, `${(s.facing || 'front')} `, el('span', { className: 'num', dataset: { sonar: s.id }, textContent: '–' })));
    readoutBuilt = !!st;
    if (!st) return;
  }
  host.querySelectorAll('.leds i').forEach((i, k) => i.classList.toggle('on', st.irReadings[k] > 0.5));
  for (const b of host.querySelectorAll('b[data-m]')) {
    const v = b.dataset.m === 'L' ? st.wheel.tl : st.wheel.tr;
    b.classList.toggle('neg', v < 0);
    b.style.setProperty('--v', Math.min(1, Math.abs(v)).toFixed(2));
  }
  for (const n of host.querySelectorAll('[data-sonar]')) {
    const r = st.hw.sonarReads.get(n.dataset.sonar);
    n.textContent = r ? (Number.isFinite(r.mm) && r.mm < 4000 ? `${(r.mm / 10).toFixed(0)} cm` : 'out of range') : '–';
  }
}

function flushSerial(st) {
  const lines = st.hw.serial;
  const from = after(lines, serialLast);
  if (from === lines.length) return;
  const host = $('dock-serial');
  const frag = document.createDocumentFragment();
  for (let i = from; i < lines.length; i++) {
    frag.append(el('span', { className: 't', textContent: `${lines[i].t.toFixed(2).padStart(6)}  ` }), `${lines[i].text}\n`);
  }
  serialLast = lines[lines.length - 1];
  const atBottom = host.scrollHeight - host.scrollTop - host.clientHeight < 30;
  host.append(frag);
  while (host.childNodes.length > 800) host.removeChild(host.firstChild);
  if (atBottom) host.scrollTop = host.scrollHeight;
}

// ---------- plotter ----------

const plot = createPlot();
let plotLine = null;
let plotSample = null;

function resetPlot() {
  clearPlot(plot);
  plotLine = null;
  plotSample = null;
}

function feedPlot(st) {
  const lines = st.hw.serial;
  for (let i = after(lines, plotLine); i < lines.length; i++) {
    for (const { label, value } of parsePlotLine(lines[i].text)) addPoint(plot, label, lines[i].t, value);
  }
  plotLine = lines[lines.length - 1] || null;
  if (!$('plot-sensors').checked) return;
  // Sensors straight from the sim, no Serial code needed
  const samples = st.samples;
  for (let i = after(samples, plotSample); i < samples.length; i++) {
    const s = samples[i];
    s.ir.forEach((on, k) => addPoint(plot, `IR ${k + 1}`, s.t, on ? 1 : 0, true));
    if (s.cam != null) addPoint(plot, 'camera x', s.t, s.cam, true);
  }
  plotSample = samples[samples.length - 1];
  for (const s of store.project.robot.sensors) {
    const r = st.hw.sonarReads.get(s.id);
    if (r && r.mm < 4000) addPoint(plot, `${s.facing || 'front'} cm`, st.t, r.mm / 10, true);
  }
}

// ---------- coach ----------

function selectDock(which) {
  for (const k of ['coach', 'serial', 'plot']) {
    $(`dock-btn-${k}`).setAttribute('aria-selected', k === which);
    $(`dock-${k}`).hidden = k !== which;
  }
}

function renderCoach(report, running = false) {
  const host = $('dock-coach');
  host.replaceChildren();
  if (!report) {
    host.append(el('div', { className: 'coach-empty' },
      el('p', { textContent: running ? 'Watching the run…' : 'Press Run. When the run ends, this is where you will see what went right and what to fix.' }),
      el('p', { textContent: 'Problems in your code are underlined in the editor as you type.' })));
    return;
  }
  const head = el('div', { className: `verdict ${report.status}` });
  const vt = el('strong', { textContent: report.headline || (report.status === 'pass' ? 'Made it.' : 'Not yet.') });
  vt.insertAdjacentHTML('afterbegin', icons[report.status === 'pass' ? 'check' : report.status === 'stopped' ? 'pause' : 'stop']);
  head.append(vt);
  if (report.example) {
    const cmp = el('button', { className: 'btn small quiet', type: 'button', textContent: 'Compare with a working version' });
    setIcon(cmp, 'compare');
    cmp.addEventListener('click', openDiff);
    head.append(cmp);
  }
  host.append(head);
  if (!report.findings.length) {
    host.append(el('p', { className: 'coach-empty', textContent: report.status === 'pass' ? 'Nothing to fix. Try a harder arena, or make it faster.' : 'No specific problems spotted. Watch the trail on the map to see where it went.' }));
  }
  report.findings.forEach((f, i) => {
    const card = el('article', { className: `finding ${f.severity}` });
    card.style.animationDelay = `${Math.min(i, 6) * 40}ms`;
    const badge = el('span', { className: 'sev', textContent: { error: 'Must fix', warn: 'Worth fixing', tip: 'Tip' }[f.severity] });
    badge.insertAdjacentHTML('afterbegin', icons[{ error: 'stop', warn: 'alert', tip: 'bulb' }[f.severity]]);
    card.append(el('div', { className: 'finding-head' }, el('h3', { textContent: f.title }), badge), el('p', { textContent: f.detail }));
    const acts = el('div', { className: 'acts' });
    if (f.line) {
      const b = el('button', { type: 'button', textContent: `Go to line ${f.line}` });
      b.addEventListener('click', () => goToLine(f.line));
      acts.append(b);
    }
    if (f.fix && f.fix.line && f.fix.text !== undefined) {
      const b = el('button', { type: 'button', textContent: 'Fix it' });
      b.addEventListener('click', async () => {
        await loadEditor();
        const line = view.state.doc.line(f.fix.line);
        view.dispatch({ changes: { from: line.from, to: line.to, insert: f.fix.text } });
        card.remove();
      });
      acts.append(b);
    }
    if (f.at) {
      const b = el('button', { type: 'button', textContent: 'Show on map' });
      b.addEventListener('click', () => { focusPoint = f.at; setTimeout(() => { focusPoint = null; }, 3500); });
      acts.append(b);
    }
    if (f.fix && f.fix.snippet) {
      card.append(el('pre', { textContent: f.fix.snippet }));
      const b = el('button', { type: 'button', textContent: 'Copy' });
      b.addEventListener('click', async () => {
        try { await navigator.clipboard.writeText(f.fix.snippet); b.textContent = 'Copied'; } catch { b.textContent = 'Select and copy'; }
      });
      acts.append(b);
    }
    if (acts.childNodes.length) card.append(acts);
    host.append(card);
  });
}

function openDiff() {
  const p = store.project;
  const example = exampleFor(p.robot, p.kind);
  const dlg = $('diff-dialog');
  const host = $('diff');
  host.replaceChildren();
  if (!example) {
    host.append(el('div', { textContent: p.kind === 'maze'
      ? 'Add at least a front ultrasonic sensor (better: front and right) and this will show a maze solver for your robot.'
      : p.kind === 'grab' ? 'A grabber needs line sensors, a front ultrasonic sensor and a gripper.'
      : p.kind === 'avoid' ? 'Add a front ultrasonic sensor and this will show an obstacle avoider for your robot.'
      : p.kind === 'sumo' ? 'A sumo robot needs two IR sensors at the front to see the white edge and a front ultrasonic sensor to find the opponent.'
      : 'Add at least two IR line sensors and this will show a line follower for your robot.' }));
    $('diff-use').disabled = true;
  } else {
    for (const d of lineDiff(p.code, example)) host.append(el('div', { className: d.type, textContent: d.text || ' ' }));
    $('diff-use').disabled = false;
  }
  dlg.showModal();
}

// ---------- init ----------

export function initRun() {
  $('btn-run').addEventListener('click', () => {
    if (playing) { playing = false; setRunButton(); pipMood(null); return; }
    if (sim && sim.state.status === 'running') { playing = true; setRunButton(); pipMood('busy'); return; }
    start();
  });
  $('btn-skip').addEventListener('click', () => {
    if (!sim || sim.state.status !== 'running') start();
    if (!sim || sim.state.status !== 'running') return;
    sim.runToEnd();
    finish();
  });
  $('btn-reset').addEventListener('click', () => { if (sim) sim.stop(); reset(); renderCoach(null); });
  $('btn-starter').addEventListener('click', () => {
    if (!confirm('Replace your code with the empty starter for this robot? You can undo with Ctrl+Z.')) return;
    setCode(starterFor(store.project.robot, store.project.kind));
  });
  $('btn-example').addEventListener('click', openDiff);
  $('btn-ino').addEventListener('click', downloadSketch);
  $('diff-close').addEventListener('click', () => $('diff-dialog').close());
  $('diff-use').addEventListener('click', () => {
    setCode(exampleFor(store.project.robot, store.project.kind));
    $('diff-dialog').close();
    reset();
    renderCoach(null);
  });
  for (const k of ['coach', 'serial', 'plot']) $(`dock-btn-${k}`).addEventListener('click', () => selectDock(k));
  $('plot-sensors').addEventListener('change', e => {
    if (!e.target.checked) clearPlot(plot, true);
    plotSample = null;
  });
  $('run-switch').addEventListener('click', e => {
    const b = e.target.closest('button[data-view]');
    if (b) showView(b.dataset.view);
  });
  $('speed-seg').addEventListener('click', e => {
    const b = e.target.closest('button[data-speed]');
    if (!b) return;
    $('sim-speed').value = b.dataset.speed;
    for (const x of $('speed-seg').children) x.setAttribute('aria-pressed', x === b);
  });
  setRunButton();

  // Anything that changes the robot or arena makes the current run stale
  const stale = () => { if (sim) { sim.stop(); reset(); renderCoach(null); } else renderReadout(null); };
  store.on('robot', stale);
  store.on('arena', () => { lastTrail = ghost = null; });
  store.on('arena', stale);
  store.on('project', () => {
    if (view && view.state.doc.toString() !== store.project.code) setCode(store.project.code);
  });

  addEventListener('keydown', e => {
    if (visible && (e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); $('btn-run').click(); }
  });

  onTab(id => {
    visible = id === 'tab-run';
    if (visible) { if (view) view.requestMeasure(); else loadEditor(); }
  });
  (window.requestIdleCallback || (fn => setTimeout(fn, 1500)))(() => loadEditor());
  renderCoach(null);
  renderReadout(null);
  requestAnimationFrame(frame);
}
