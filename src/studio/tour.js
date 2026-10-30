// "Your first robot in 3 minutes": a few coach marks over the real workbench.
// Each step moves on when the student does the thing it asks for, or on Next.

import { exampleFor } from '../engine/examples.js';

// A working sketch with one mistake the coach knows how to explain:
// steering turned the wrong way for a line follower, otherwise the right
// motor's IN pins swapped so that wheel runs backwards.
export function buggySketch(robot, kind) {
  const good = exampleFor(robot, kind);
  if (!good) return null;
  if (kind === 'line') {
    const flipped = good
      .replace(/drive\((\w+) \+ (\w+), \1 - \2\)/, 'drive($1 - $2, $1 + $2)')
      .replace('if (lastError < 0)', 'if (lastError > 0)');
    if (flipped !== good) return flipped;
  }
  return good.replace(/right >= 0 \? (HIGH : LOW|LOW : HIGH)/g, (_, v) => `right >= 0 ? ${v === 'HIGH : LOW' ? 'LOW : HIGH' : 'HIGH : LOW'}`);
}

const $ = id => document.getElementById(id);
const q = sel => document.querySelector(sel);

const pipSvg = `<svg class="mini-pip" viewBox="0 0 64 56" aria-hidden="true">
  <line x1="32" y1="9" x2="32" y2="3" stroke="#9aa7ad" stroke-width="2.5" stroke-linecap="round"/>
  <circle class="ant" cx="32" cy="3" r="3" fill="#e2484e"/>
  <rect x="6" y="9" width="52" height="42" rx="13" fill="#f6f8f7"/>
  <rect x="12" y="15" width="40" height="29" rx="9" fill="#15232a"/>
  <g class="eyes"><rect class="eye" x="20" y="22" width="8" height="12" rx="4" fill="#8bf0ff"/><rect class="eye" x="36" y="22" width="8" height="12" rx="4" fill="#8bf0ff"/></g>
</svg>`;

let app;            // { store, selectTab }
let at = -1;
let spot, card, raf = 0;
let undo = [];      // listeners of the current step
let sketchLoaded = false;
let lastTarget = null;

const phone = () => matchMedia('(max-width: 860px)').matches;
const shown = id => !$(id).hidden;
const runVisible = () => shown('tab-run') && !(phone() && $('tab-run').classList.contains('view-code'));
const simDone = () => /\b(fail|pass)\b/.test($('sim-status').className);

function on(target, type, fn = next) {
  const h = e => fn(e);
  target.addEventListener(type, h);
  undo.push(() => target.removeEventListener(type, h));
}

function loadSketch() {
  if (sketchLoaded) return;
  const { store } = app;
  const code = buggySketch(store.project.robot, store.project.kind);
  if (!code) return;
  sketchLoaded = true;
  store.project.code = code;
  store.changed('project');
}

const steps = [
  {
    title: 'Pick a kind of bot',
    text: 'Hi, I’m Pip. Each kind comes with its own parts and arena. A line follower is a good first robot.',
    enter: () => app.selectTab('tab-robot'),
    target: () => $('kind-seg'),
    wait: () => on($('kind-seg'), 'click', () => setTimeout(next, 150)),
  },
  {
    title: 'Look at the parts and wiring',
    text: 'Parts are on the left. The wiring table says which board pin each wire goes to, and anything wired wrong shows up underneath in red.',
    enter: () => app.selectTab('tab-robot'),
    target: () => q('.wiring'),
    wait: () => on($('pin-rows'), 'change'),
  },
  {
    title: 'Open Code & run, then press Run',
    text: 'I’ve written a sketch for your robot with one mistake in it. Run it and see if you can spot what goes wrong.',
    enter: loadSketch,
    target: () => !shown('tab-run') ? $('tab-btn-run') : runVisible() ? $('btn-run') : q('#run-switch [data-view="sim"]'),
    wait: () => on($('btn-run'), 'click', () => setTimeout(next, 50)),
  },
  {
    title: 'Watch it fail',
    text: 'The code looks fine, but keep an eye on where the robot goes.',
    enter() {
      loadSketch();
      if (!shown('tab-run')) app.selectTab('tab-run');
      if (!runVisible()) q('#run-switch [data-view="sim"]').click();
      if (!simDone() && !$('btn-run').classList.contains('playing')) $('btn-run').click();
    },
    target: () => q('.sim-stage'),
    wait() {
      const check = () => { if (simDone()) next(); };
      const mo = new MutationObserver(check);
      mo.observe($('sim-status'), { attributes: true, attributeFilter: ['class'] });
      undo.push(() => mo.disconnect());
      setTimeout(check);
    },
  },
  {
    title: 'Compare with a working version',
    text: 'The coach explains what went wrong. Press Compare with a working version to see the fix, then Use this version.',
    mood: 'sad',
    enter() { if (!shown('tab-run')) app.selectTab('tab-run'); },
    target: () => q('#dock-coach .verdict .btn') || (phone() && !runVisible() ? $('btn-example') : q('#dock-coach')),
    wait: () => on($('diff-use'), 'click', () => setTimeout(next, 50)),
  },
  {
    title: 'That’s the whole loop',
    text: 'Build, run, read the coach, fix. Press Run again to watch the fixed version drive. The ? button up top replays this tour.',
    mood: 'happy',
    last: true,
    target: () => runVisible() ? $('btn-run') : null,
  },
];

function build() {
  spot = document.createElement('div');
  spot.className = 'tour-spot';
  spot.setAttribute('aria-hidden', 'true');
  card = document.createElement('div');
  card.className = 'tour-card';
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-modal', 'false');
  card.setAttribute('aria-labelledby', 'tour-title');
  card.tabIndex = -1;
  card.innerHTML = `${pipSvg}
    <div class="tour-body" aria-live="polite">
      <p class="tour-count"></p>
      <h2 id="tour-title"></h2>
      <p class="tour-text"></p>
    </div>
    <div class="tour-acts">
      <button class="btn quiet small" type="button" data-act="skip">Skip tour</button>
      <button class="btn small" type="button" data-act="next">Next</button>
    </div>`;
  card.addEventListener('click', e => {
    const act = e.target.closest('[data-act]');
    if (act) act.dataset.act === 'next' ? next() : end();
  });
  document.body.append(spot, card);
}

function show(i) {
  undo.forEach(fn => fn());
  undo = [];
  at = i;
  const s = steps[i];
  if (s.enter) s.enter();
  card.querySelector('.tour-count').textContent = s.last ? 'Done' : `Step ${i + 1} of ${steps.length - 1}`;
  card.querySelector('#tour-title').textContent = s.title;
  card.querySelector('.tour-text').textContent = s.text;
  card.querySelector('[data-act="next"]').textContent = s.last ? 'Done' : 'Next';
  card.querySelector('[data-act="skip"]').hidden = !!s.last;
  const pip = card.querySelector('.mini-pip');
  pip.classList.remove('happy', 'sad');
  if (s.mood) pip.classList.add(s.mood);
  if (s.wait) s.wait();
  lastTarget = null;
}

function next() {
  if (at < 0) return;
  if (at >= steps.length - 1) end();
  else show(at + 1);
}

// Follow the target every frame: panels scroll, tabs switch, phones rotate
function place() {
  raf = requestAnimationFrame(place);
  const dialogOpen = !!q('dialog[open]');
  spot.hidden = card.hidden = dialogOpen;
  if (dialogOpen) return;
  const el = steps[at].target();
  const r = el && el.getClientRects().length ? el.getBoundingClientRect() : null;
  if (el !== lastTarget) {
    lastTarget = el;
    if (r && (r.top < 60 || r.bottom > innerHeight - 80)) el.scrollIntoView({ block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  }
  const vw = innerWidth, vh = innerHeight;
  const bottomBar = phone() ? 76 : 0;
  if (r) {
    const pad = 6;
    Object.assign(spot.style, { left: `${r.left - pad}px`, top: `${r.top - pad}px`, width: `${r.width + pad * 2}px`, height: `${r.height + pad * 2}px` });
    spot.classList.remove('none');
  } else spot.classList.add('none');

  const cw = card.offsetWidth, ch = card.offsetHeight, gap = 14, m = 12;
  const maxTop = vh - bottomBar - ch - m;
  let x, y;
  if (!r) { x = (vw - cw) / 2; y = maxTop; }
  else if (r.bottom + gap + ch <= vh - bottomBar - m) { x = r.left; y = r.bottom + gap; }
  else if (r.top - gap - ch >= m) { x = r.left; y = r.top - gap - ch; }
  else if (r.right + gap + cw <= vw - m) { x = r.right + gap; y = r.top; }
  else if (r.left - gap - cw >= m) { x = r.left - gap - cw; y = r.top; }
  else { x = r.left + (r.width - cw) / 2; y = Math.min(r.bottom, vh) - ch - m; }
  x = Math.max(m, Math.min(vw - cw - m, x));
  y = Math.max(m, Math.min(maxTop, y));
  card.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
}

function onKey(e) {
  if (e.key === 'Escape' && !q('dialog[open]')) end();
}

export function startTour() {
  if (at >= 0) end();
  try { localStorage.setItem('botbench.toured', '1'); } catch { /* fine, it just shows again */ }
  if (!card) build();
  sketchLoaded = false;
  spot.hidden = card.hidden = false;
  addEventListener('keydown', onKey);
  show(0);
  place();
  card.focus({ preventScroll: true });
}

function end() {
  undo.forEach(fn => fn());
  undo = [];
  at = -1;
  cancelAnimationFrame(raf);
  spot.hidden = card.hidden = true;
  removeEventListener('keydown', onKey);
  if (card.contains(document.activeElement)) $('btn-tour').focus();
}

export function initTour(deps) {
  app = deps;
  $('btn-tour').addEventListener('click', startTour);
  let seen = false;
  try { seen = !!localStorage.getItem('botbench.toured'); } catch { seen = true; }
  return !seen;
}
