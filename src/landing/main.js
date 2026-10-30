import { createSim } from '../engine/sim.js';
import { presetById } from '../engine/arena.js';
import { defaultRobot } from '../engine/parts.js';
import { lineFollower } from '../engine/examples.js';
import { diagnose } from '../engine/coach.js';
import { fitView, drawArena, drawRobot, drawTrail, drawMarkers, liveFromSim, sizeCanvas } from '../ui/draw.js';
import '../ui/offline.js';

const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const finePointer = matchMedia('(hover: hover) and (pointer: fine)').matches;
const $ = id => document.getElementById(id);
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const easeOut = t => 1 - Math.pow(1 - clamp(t), 3);
const span = (p, a, b) => clamp((p - a) / (b - a));

// ---------- intro ----------

const pip = $('pip');
const eyes = $('eyes');
const head = pip.querySelector('.head');
const bubble = $('bubble');
const wrap = pip.parentElement;
let awake = false;

requestAnimationFrame(() => requestAnimationFrame(() => document.body.classList.remove('intro')));
// Background tabs don't run animation frames; don't leave the page blank there
setTimeout(() => document.body.classList.remove('intro'), 120);
pip.classList.add('asleep');
setTimeout(() => pip.classList.remove('asleep'), reduced ? 0 : 1000);
setTimeout(() => { awake = true; pip.classList.add('wave'); }, reduced ? 0 : 1400);
setTimeout(() => bubble.classList.add('show'), reduced ? 0 : 1650);
setTimeout(() => pip.classList.remove('wave'), 3000);

function blink(twice) {
  pip.classList.add('blink');
  setTimeout(() => {
    pip.classList.remove('blink');
    if (twice) setTimeout(() => blink(false), 160);
  }, 120);
}
(function scheduleBlink() {
  setTimeout(() => {
    if (!document.hidden && awake) blink(Math.random() < 0.25);
    scheduleBlink();
  }, 2200 + Math.random() * 3200);
})();

pip.addEventListener('click', () => {
  pip.classList.add('happy');
  bubble.textContent = 'Beep! Let\'s build something.';
  bubble.classList.add('show');
  setTimeout(() => pip.classList.remove('happy'), 900);
});

// ---------- hero: light, parallax, gaze ----------

const hero = $('hero');
const words = [...hero.querySelectorAll('.word')];
const floaters = [...hero.querySelectorAll('.floater')];
const gaze = { x: 0, y: 0, tx: 0, ty: 0 };
const pointer = { x: 0, y: 0, sx: 0, sy: 0 };

addEventListener('pointermove', e => {
  const r = pip.getBoundingClientRect();
  const cx = r.left + r.width / 2, cy = r.top + r.height * 0.33;
  const dx = e.clientX - cx, dy = e.clientY - cy;
  const d = Math.hypot(dx, dy) || 1;
  const pull = Math.min(1, d / 400);
  gaze.tx = (dx / d) * 14 * pull;
  gaze.ty = (dy / d) * 10 * pull;
  pointer.x = e.clientX / innerWidth - 0.5;
  pointer.y = e.clientY / innerHeight - 0.5;
  if (scrollY < innerHeight) {
    hero.style.setProperty('--lx', `${e.clientX}px`);
    hero.style.setProperty('--ly', `${e.clientY}px`);
  }
}, { passive: true });

function heroFrame() {
  const s = Math.min(1, scrollY / innerHeight);
  if (s < 1) {
    const ty = gaze.ty * (1 - s) + 12 * s;
    gaze.x += (gaze.tx * (1 - s) - gaze.x) * 0.15;
    gaze.y += (ty - gaze.y) * 0.15;
    if (awake) eyes.style.transform = `translate(${gaze.x.toFixed(2)}px, ${gaze.y.toFixed(2)}px)`;
    head.style.transform = `rotate(${(gaze.x * 0.25).toFixed(2)}deg)`;
    // Pip sinks behind the words only when they sit beside it
    wrap.style.transform = innerWidth > 720 ? `translateY(${(s * 70).toFixed(1)}px)` : "";

    if (finePointer && !reduced) {
      pointer.sx += (pointer.x - pointer.sx) * 0.08;
      pointer.sy += (pointer.y - pointer.sy) * 0.08;
      for (const w of words) w.style.translate = `${(-pointer.sx * 14).toFixed(1)}px ${(-pointer.sy * 8 - s * 40).toFixed(1)}px`;
      for (const f of floaters) {
        const k = +f.dataset.depth;
        f.style.translate = `${(pointer.sx * 60 * k).toFixed(1)}px ${(pointer.sy * 40 * k - s * 120 * k).toFixed(1)}px`;
      }
    }
    if (s > 0.35) bubble.classList.remove('show');
    else if (awake && s < 0.08 && !bubble.classList.contains('show')) bubble.classList.add('show');
  }
  requestAnimationFrame(heroFrame);
}
requestAnimationFrame(heroFrame);

// ---------- nav ----------

const nav = $('nav');
const navLinks = [...nav.querySelectorAll('nav a')];
const onScrollNav = () => nav.classList.toggle('solid', scrollY > 30);
addEventListener('scroll', onScrollNav, { passive: true });
onScrollNav();
const sectionIo = new IntersectionObserver(entries => {
  for (const e of entries) {
    if (!e.isIntersecting) continue;
    navLinks.forEach(a => a.classList.toggle('active', a.getAttribute('href') === '#' + e.target.id));
  }
}, { rootMargin: '-45% 0px -50% 0px' });
['how', 'parts', 'demo', 'bots', 'faq'].forEach(id => sectionIo.observe($(id)));
$('year').textContent = new Date().getFullYear();

// ---------- things that only animate while on screen ----------

const io = new IntersectionObserver(entries => {
  for (const e of entries) e.target.classList.toggle('in', e.isIntersecting);
}, { threshold: 0.25 });
document.querySelectorAll('.reveal, .end').forEach(el => io.observe(el));

const irItem = document.querySelector('.pc-ir');
if (irItem) {
  const leds = [...irItem.querySelectorAll('.irs circle')];
  const tape = irItem.querySelector('.tape');
  const path = [0, 1, 2, 3, 4, 3, 2, 1];
  let i = 0;
  setInterval(() => {
    if (!irItem.closest('.in')) return;
    const at = path[i++ % path.length];
    tape.style.transform = `translateX(${(at - 2) * 24}px)`;
    setTimeout(() => leds.forEach((l, k) => l.classList.toggle('on', k === at)), 250);
  }, 650);
}

// Parts tilt towards the pointer
if (finePointer && !reduced) {
  for (const item of document.querySelectorAll('.bin-item')) {
    const art = item.querySelector('.bin-art');
    item.addEventListener('pointermove', e => {
      const r = art.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
      art.style.setProperty('--ry', `${((x - 0.5) * 14).toFixed(2)}deg`);
      art.style.setProperty('--rx', `${((0.5 - y) * 10).toFixed(2)}deg`);
      art.style.setProperty('--mx', `${(x * 100).toFixed(1)}%`);
      art.style.setProperty('--my', `${(y * 100).toFixed(1)}%`);
      item.classList.add('hover');
    });
    item.addEventListener('pointerleave', () => {
      art.style.setProperty('--rx', '0deg');
      art.style.setProperty('--ry', '0deg');
      item.classList.remove('hover');
    });
  }
}

// ---------- scroll story ----------

const steps = [...document.querySelectorAll('.story-step')];
const scenes = [...document.querySelectorAll('.scene')];
const dots = [...document.querySelectorAll('.stage-dots i')];
const stageLabel = $('stage-label');
const note = $('scene-note');
const labels = ['Robot', 'Wiring', 'Sketch', 'Test run'];

const buildParts = {
  chassis: [0, 0.15, el => `scale(${0.8 + 0.2 * el})`],
  shadow: [0, 0.15, () => ''],
  'wheel-l': [0.12, 0.35, e => `translateX(${-150 * (1 - e)}px)`],
  'wheel-r': [0.12, 0.35, e => `translateX(${150 * (1 - e)}px)`],
  battery: [0.3, 0.45, e => `translateY(${180 * (1 - e)}px)`],
  driver: [0.4, 0.55, e => `translateY(${-220 * (1 - e)}px)`],
  board: [0.5, 0.66, e => `translateY(${-260 * (1 - e)}px)`],
  sensor: [0.62, 0.78, e => `translateY(${-200 * (1 - e)}px)`],
  caster: [0.3, 0.42, e => `scale(${e})`],
  label: [0.82, 1, () => ''],
};
const buildEls = Object.fromEntries(Object.keys(buildParts).map(k => [k, document.querySelector('.b-' + k)]));
for (const el of Object.values(buildEls)) { el.style.transformBox = 'fill-box'; el.style.transformOrigin = 'center'; }

function sceneBuild(p) {
  for (const [k, [a, b, tf]] of Object.entries(buildParts)) {
    const e = easeOut(span(p, a, b));
    buildEls[k].style.opacity = k === 'chassis' ? 0.3 + 0.7 * e : e;
    buildEls[k].style.transform = tf(e);
  }
}

const wires = [...document.querySelectorAll('.scene-wire .wire')];
const wireLens = wires.map(w => w.getTotalLength());
wires.forEach((w, i) => { w.style.strokeDasharray = wireLens[i]; });
const wireOk = document.querySelector('.wire-ok');
function sceneWire(p) {
  wires.forEach((w, i) => {
    const e = easeOut(span(p, 0.05 + i * 0.13, 0.3 + i * 0.13));
    w.style.strokeDashoffset = wireLens[i] * (1 - e);
  });
  wireOk.style.opacity = easeOut(span(p, 0.85, 0.95));
}

const CODE = `void loop() {
  // read the three line sensors
  int L = digitalRead(2);
  int C = digitalRead(3);
  int R = digitalRead(4);

  if (C == HIGH) {
    drive(180, 180);     // on the line
  } else if (L == HIGH) {
    drive(60, 180);      // line is left
  } else if (R == HIGH) {
    drive(180, 60);      // line is right
  }
}`;
const tokens = [];
for (const m of CODE.matchAll(/(\/\/[^\n]*)|\b(void|int|if|else)\b|\b(HIGH|LOW)\b|(\b\d+\b)|(\b[a-zA-Z_]\w*(?=\())|([\s\S])/g)) {
  const cls = m[1] ? 'c' : m[2] ? 'k' : m[3] ? 't' : m[4] ? 'n' : m[5] ? 'f' : '';
  tokens.push({ text: m[0], cls });
}
const codeEl = $('story-code');
let shownChars = -1;
const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
function sceneCode(p) {
  const n = Math.floor(easeOut(span(p, 0.05, 0.85)) * CODE.length);
  if (n === shownChars) return;
  shownChars = n;
  let left = n, html = '';
  for (const t of tokens) {
    if (left <= 0) break;
    const s = t.text.slice(0, left);
    left -= s.length;
    html += t.cls ? `<span class="${t.cls}">${esc(s)}</span>` : esc(s);
  }
  codeEl.innerHTML = html + '<span class="caret"></span>';
}

const runPath = $('run-path');
const runLen = runPath.getTotalLength();
const runBot = document.querySelector('.run-bot');
const runTrail = document.querySelector('.run-trail');
const runMiss = document.querySelector('.run-miss');
const offStart = runPath.getPointAtLength(runLen * 0.55);
const offAhead = runPath.getPointAtLength(runLen * 0.57);
const offAng = Math.atan2(offAhead.y - offStart.y, offAhead.x - offStart.x) + 0.7;
const offEnd = { x: offStart.x + Math.cos(offAng) * 60, y: offStart.y + Math.sin(offAng) * 60 };
runMiss.setAttribute('transform', `translate(${offEnd.x} ${offEnd.y})`);

function sceneRun(p) {
  let pos, ang, trail = [], fixed = p > 0.78;
  const along = t => {
    const a = runPath.getPointAtLength(runLen * t), b = runPath.getPointAtLength(Math.min(runLen, runLen * t + 2));
    return { x: a.x, y: a.y, a: Math.atan2(b.y - a.y, b.x - a.x) };
  };
  if (!fixed) {
    const t = easeOut(span(p, 0, 0.5)) * 0.55;
    for (let k = 0; k <= 30; k++) trail.push(along((t * k) / 30));
    pos = along(t);
    ang = pos.a;
    const off = easeOut(span(p, 0.5, 0.65));
    if (off > 0) {
      pos = { x: offStart.x + (offEnd.x - offStart.x) * off, y: offStart.y + (offEnd.y - offStart.y) * off };
      ang = offAng;
      trail.push(pos);
    }
  } else {
    const t = easeOut(span(p, 0.78, 1));
    for (let k = 0; k <= 40; k++) trail.push(along((t * k) / 40));
    pos = along(t);
    ang = pos.a;
  }
  runBot.setAttribute('transform', `translate(${pos.x} ${pos.y}) rotate(${(ang * 180) / Math.PI})`);
  runTrail.setAttribute('d', trail.map((q, i) => `${i ? 'L' : 'M'}${q.x.toFixed(1)} ${q.y.toFixed(1)}`).join(''));
  runTrail.setAttribute('stroke', fixed ? 'rgba(63,174,106,0.6)' : 'rgba(226,72,78,0.5)');
  runMiss.style.opacity = !fixed && p > 0.62 ? 1 : 0;
  if (!fixed && p > 0.64) {
    note.className = 'scene-note show';
    note.innerHTML = '<strong>Left the line at 4.2 s</strong><span>When the line is on the right, your code turns left. Swap the wheel speeds in that branch.</span>';
  } else if (fixed && p > 0.86) {
    note.className = 'scene-note show good';
    note.innerHTML = '<strong>Finished in 11.8 s</strong><span>Steering fixed. Try the S-curves next.</span>';
  } else {
    note.className = 'scene-note';
  }
}

const sceneFns = [sceneBuild, sceneWire, sceneCode, sceneRun];
let activeScene = -1;

function storyFrame() {
  // On phones the stage sits on top, so steps start counting as soon as they appear
  const mark = innerHeight * (innerWidth <= 900 ? 0.85 : 0.55);
  let active = 0, prog = 0;
  steps.forEach((s, i) => {
    const r = s.getBoundingClientRect();
    if (r.top < mark) { active = i; prog = clamp((mark - r.top) / r.height); }
  });
  if (reduced) prog = 1;
  if (active !== activeScene) {
    activeScene = active;
    scenes.forEach((s, i) => s.classList.toggle('on', i === active));
    steps.forEach((s, i) => s.classList.toggle('active', i === active));
    dots.forEach((d, i) => d.classList.toggle('on', i <= active));
    stageLabel.textContent = labels[active];
    if (active !== 3) note.className = 'scene-note';
  }
  sceneFns[active](prog);
  requestAnimationFrame(storyFrame);
}
requestAnimationFrame(storyFrame);

// ---------- live demo ----------

const canvas = $('demo-canvas');
const ctx = canvas.getContext('2d');
const chart = $('demo-chart');
const cctx = chart.getContext('2d');
const ledsEl = $('demo-leds');
const breakBtn = $('demo-break');
const coachEl = $('demo-coach');
const pill = $('demo-pill');
const codeView = $('demo-code');

const robot = defaultRobot('line');
const arena = presetById('oval');
const good = lineFollower(robot);
const broken = good
  .replace('drive(BASE_SPEED + turn, BASE_SPEED - turn);', 'drive(BASE_SPEED - turn, BASE_SPEED + turn);')
  .replace('if (lastError < 0)', 'if (lastError > 0)');
const KP = +(good.match(/const float KP = (\d+)/) || [0, 60])[1];
let source = good;
let sim;
let visible = false;
const history = [];
let chartClock = 0;

for (let i = 0; i < 3; i++) ledsEl.appendChild(document.createElement('span'));

function restart() {
  sim = createSim({ robot, arena, source, timeLimit: 600 });
  coachEl.hidden = true;
  history.length = 0;
  chartClock = 0;
  pill.className = 'pill';
  pill.textContent = 'Running';
}

breakBtn.addEventListener('click', () => {
  source = source === good ? broken : good;
  breakBtn.textContent = source === good ? 'Swap the steering' : 'Put it back';
  restart();
});
$('demo-reset').addEventListener('click', restart);

function showCoach() {
  const report = diagnose({ robot, arena, source, sim, kind: 'line' });
  const top = report.findings.find(f => f.severity === 'error') || report.findings[0];
  coachEl.hidden = false;
  coachEl.classList.toggle('good', report.status === 'pass');
  $('demo-coach-title').textContent = report.status === 'pass' ? report.headline : top ? top.title : report.headline;
  $('demo-coach-text').textContent = report.status === 'pass' ? 'Lap complete. It goes round again in a moment.' : top ? top.detail : '';
  pill.className = 'pill ' + (report.status === 'pass' ? 'pass' : 'fail');
  pill.textContent = report.status === 'pass' ? 'Finished' : 'Off the line';
}

function renderCode(ir) {
  const on = ir.map(v => v > 0.5);
  const seen = on.filter(Boolean).length;
  const w = [-2, 0, 2];
  const error = seen ? on.reduce((s, b, i) => s + (b ? w[i] : 0), 0) / seen : null;
  const turn = error === null ? null : Math.round(KP * error);
  const steer = source === good ? 'drive(BASE + turn, BASE - turn);' : 'drive(BASE - turn, BASE + turn);';
  const lines = [
    ['if (seen == 0) {', seen === 0],
    ['  turnTowardsLastSide();', seen === 0],
    ['}', false],
    [`float error = sum / seen;  <span class="val">${error === null ? '' : '// ' + error.toFixed(2)}</span>`, seen > 0],
    [`float turn = KP * error;   <span class="val">${turn === null ? '' : '// ' + turn}</span>`, seen > 0],
    [steer, seen > 0],
  ];
  codeView.innerHTML = lines.map(([t, hl]) => (hl ? `<span class="hl">${t}</span>` : `${t}\n`)).join('');
}

function drawChart() {
  const { w, h, dpr } = sizeCanvas(chart);
  cctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  cctx.clearRect(0, 0, w, h);
  cctx.strokeStyle = 'rgba(21,35,42,0.1)';
  cctx.lineWidth = 1;
  cctx.beginPath(); cctx.moveTo(0, h / 2); cctx.lineTo(w, h / 2); cctx.stroke();
  const n = 240;
  const line = (key, color) => {
    cctx.strokeStyle = color;
    cctx.lineWidth = 2;
    cctx.lineJoin = 'round';
    cctx.beginPath();
    history.forEach((s, i) => {
      const x = w - ((history.length - 1 - i) / n) * w;
      const y = h / 2 - s[key] * (h / 2 - 6);
      if (i) cctx.lineTo(x, y); else cctx.moveTo(x, y);
    });
    cctx.stroke();
  };
  line('l', '#1c5a70');
  line('r', '#d9a90d');
}

new IntersectionObserver(([e]) => { visible = e.isIntersecting; }, { threshold: 0.05 }).observe(canvas);

let last = performance.now();
let endedAt = 0;
function demoFrame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (visible) {
    if (sim.state.status === 'running') {
      sim.advance(dt);
      // One chart point per 25 ms of sim time, lightly smoothed so it reads as a trend
      const st = sim.state;
      while (chartClock < st.t) {
        chartClock += 0.025;
        const prev = history[history.length - 1] || { l: 0, r: 0 };
        history.push({ l: prev.l + (st.wheel.tl - prev.l) * 0.35, r: prev.r + (st.wheel.tr - prev.r) * 0.35 });
      }
      while (history.length > 240) history.shift();
      if (sim.state.status !== 'running') { showCoach(); endedAt = now; }
    } else if (sim.state.status === 'pass' && now - endedAt > 2500) {
      restart();
    }
    const view = fitView(canvas, arena.w, arena.h, 14);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    view.apply(ctx);
    drawArena(ctx, arena, { checkpoints: sim.state.checkpoints, showStart: false });
    drawTrail(ctx, sim.state.trail);
    drawMarkers(ctx, sim.state.markers, now / 1000, view.scale);
    drawRobot(ctx, robot, sim.state.pose, liveFromSim(sim));

    const ir = sim.state.irReadings;
    [...ledsEl.children].forEach((el, i) => el.classList.toggle('on', ir[i] > 0.5));
    $('demo-time').textContent = `${sim.state.t.toFixed(1)} s`;
    drawChart();
    renderCode(ir);
  }
  requestAnimationFrame(demoFrame);
}

restart();
requestAnimationFrame(demoFrame);
