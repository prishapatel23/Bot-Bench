import { store } from './store.js';
import { onTab } from './main.js';
import { presets, presetById, TAPE, WALL } from '../engine/arena.js';
import { fitView, drawArena, colors } from '../ui/draw.js';
import { setIcon } from '../ui/icons.js';
import { bestBadge } from './challenges.js';

const $ = id => document.getElementById(id);
const canvas = $('arena-canvas');
const ctx = canvas.getContext('2d');

let tool = 'tape';
let view = null;
let drag = null;      // the shape being drawn
let hover = null;
let visible = false;
let dirty = false;
const undoStack = [];

const arena = () => store.project.arena;

function snapshot() {
  undoStack.push(JSON.stringify(arena()));
  if (undoStack.length > 60) undoStack.shift();
}

function commit() {
  dirty = true;
  // Editing a ready-made arena turns it into your own copy
  if (presets.some(p => p.id === arena().id)) {
    arena().id = 'my-' + Date.now().toString(36);
    arena().name = 'Copy of ' + arena().name;
    $('arena-name').value = arena().name;
    renderLists();
  }
  store.changed('arena');
}

const snapOn = () => $('snap').checked;
const snap = (v, step = 50) => (snapOn() ? Math.round(v / step) * step : v);

function worldPoint(e) {
  const r = canvas.getBoundingClientRect();
  const p = view.toWorld(e.clientX - r.left, e.clientY - r.top);
  return { x: Math.max(0, Math.min(arena().w, p.x)), y: Math.max(0, Math.min(arena().h, p.y)) };
}

function segDist(px, py, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((px - a[0]) * dx + (py - a[1]) * dy) / l2));
  return Math.hypot(px - (a[0] + dx * t), py - (a[1] + dy * t));
}

function eraseAt(p, radius = 40) {
  const a = arena();
  let changed = false;
  const lines = [];
  for (const l of a.lines) {
    // Split a tape line where the eraser touches it
    let run = [];
    for (const pt of l.pts) {
      if (Math.hypot(pt[0] - p.x, pt[1] - p.y) < radius) {
        changed = true;
        if (run.length > 1) lines.push({ w: l.w, pts: run });
        run = [];
      } else run.push(pt);
    }
    if (run.length > 1) lines.push({ w: l.w, pts: run });
  }
  const walls = a.walls.filter(w => segDist(p.x, p.y, w.a, w.b) > radius);
  const objects = a.objects.filter(o => Math.hypot(o.x - p.x, o.y - p.y) > radius + o.r);
  if (walls.length !== a.walls.length || objects.length !== a.objects.length) changed = true;
  if (changed) { a.lines = lines; a.walls = walls; a.objects = objects; }
  return changed;
}

function pointerDown(e) {
  if (!view) return;
  canvas.setPointerCapture(e.pointerId);
  const p = worldPoint(e);
  snapshot();
  if (tool === 'tape') drag = { kind: 'tape', pts: [[p.x, p.y]] };
  else if (tool === 'straight' || tool === 'wall') drag = { kind: tool, a: [snap(p.x), snap(p.y)], b: [snap(p.x), snap(p.y)] };
  else if (tool === 'finish') drag = { kind: 'finish', a: [snap(p.x), snap(p.y)], b: [snap(p.x), snap(p.y)] };
  else if (tool === 'start') { arena().start = { x: p.x, y: p.y, a: arena().start.a }; drag = { kind: 'start' }; }
  else if (tool === 'erase') { drag = { kind: 'erase', hit: eraseAt(p) }; }
  else if (tool === 'can') {
    const target = arena().mission === 'deliver' && !arena().objects.some(o => o.target);
    arena().objects.push({ x: p.x, y: p.y, r: 22, target });
    commit();
    drag = null;
  }
}

function pointerMove(e) {
  if (!view) return;
  const p = worldPoint(e);
  hover = p;
  if (!drag) return;
  if (drag.kind === 'tape') {
    const last = drag.pts[drag.pts.length - 1];
    if (Math.hypot(p.x - last[0], p.y - last[1]) > 12) drag.pts.push([p.x, p.y]);
  } else if (drag.kind === 'straight' || drag.kind === 'wall' || drag.kind === 'finish') {
    drag.b = [snap(p.x), snap(p.y)];
  } else if (drag.kind === 'start') {
    const s = arena().start;
    if (Math.hypot(p.x - s.x, p.y - s.y) > 20) {
      let a = Math.atan2(p.y - s.y, p.x - s.x);
      if (snapOn()) a = Math.round(a / (Math.PI / 4)) * (Math.PI / 4);
      s.a = a;
    }
  } else if (drag.kind === 'erase') {
    drag.hit = eraseAt(p) || drag.hit;
  }
}

function pointerUp() {
  if (!drag) return;
  const a = arena();
  const d = drag;
  drag = null;
  if (d.kind === 'tape' && d.pts.length > 1) a.lines.push({ w: TAPE, pts: d.pts });
  else if (d.kind === 'straight' && Math.hypot(d.b[0] - d.a[0], d.b[1] - d.a[1]) > 10) a.lines.push({ w: TAPE, pts: [d.a, d.b] });
  else if (d.kind === 'wall' && Math.hypot(d.b[0] - d.a[0], d.b[1] - d.a[1]) > 10) a.walls.push({ t: WALL, a: d.a, b: d.b });
  else if (d.kind === 'finish') {
    const x = Math.min(d.a[0], d.b[0]), y = Math.min(d.a[1], d.b[1]);
    const w = Math.abs(d.b[0] - d.a[0]), h = Math.abs(d.b[1] - d.a[1]);
    if (w > 40 && h > 40) a.finish = { x, y, w, h };
    else { undoStack.pop(); return; }
  } else if (d.kind === 'start') { /* already applied */ }
  else if (d.kind === 'erase' && !d.hit) { undoStack.pop(); return; }
  else { undoStack.pop(); return; }
  commit();
}

function undo() {
  const prev = undoStack.pop();
  if (!prev) return;
  store.project.arena = JSON.parse(prev);
  syncMeta();
  store.changed('arena');
}

// ---------- drawing ----------

function frame() {
  if (visible) {
    const a = arena();
    view = fitView(canvas, a.w, a.h, 28);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    view.apply(ctx);
    drawArena(ctx, a);

    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    if (drag && drag.kind === 'tape') {
      ctx.strokeStyle = colors.tape;
      ctx.lineWidth = TAPE;
      ctx.beginPath();
      drag.pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.stroke();
    } else if (drag && (drag.kind === 'straight' || drag.kind === 'wall')) {
      ctx.strokeStyle = drag.kind === 'wall' ? colors.wall : colors.tape;
      ctx.globalAlpha = 0.7;
      ctx.lineWidth = drag.kind === 'wall' ? WALL : TAPE;
      ctx.beginPath(); ctx.moveTo(...drag.a); ctx.lineTo(...drag.b); ctx.stroke();
      ctx.globalAlpha = 1;
      const len = Math.hypot(drag.b[0] - drag.a[0], drag.b[1] - drag.a[1]);
      ctx.fillStyle = colors.ink;
      ctx.font = `${14 / view.scale}px Atkinson Hyperlegible, sans-serif`;
      ctx.fillText(`${Math.round(len)} mm`, drag.b[0] + 12 / view.scale, drag.b[1] - 12 / view.scale);
    } else if (drag && drag.kind === 'finish') {
      ctx.fillStyle = 'rgba(63,174,106,0.25)';
      ctx.strokeStyle = colors.green;
      ctx.lineWidth = 4;
      const x = Math.min(drag.a[0], drag.b[0]), y = Math.min(drag.a[1], drag.b[1]);
      ctx.fillRect(x, y, Math.abs(drag.b[0] - drag.a[0]), Math.abs(drag.b[1] - drag.a[1]));
      ctx.strokeRect(x, y, Math.abs(drag.b[0] - drag.a[0]), Math.abs(drag.b[1] - drag.a[1]));
    }
    if (hover && tool === 'erase') {
      ctx.strokeStyle = colors.red;
      ctx.lineWidth = 2 / view.scale;
      ctx.beginPath(); ctx.arc(hover.x, hover.y, 40, 0, Math.PI * 2); ctx.stroke();
    }
  }
  requestAnimationFrame(frame);
}

// ---------- side lists and meta ----------

function mapButton(a, onPick) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'map-item';
  b.setAttribute('aria-pressed', a.id === arena().id);
  b.innerHTML = '<strong></strong><span></span>';
  b.querySelector('strong').textContent = a.name;
  b.querySelector('span').textContent = a.blurb || `${a.w / 1000} × ${a.h / 1000} m, ${a.mission === 'deliver' ? 'deliver the can' : 'reach the finish'}`;
  b.addEventListener('click', onPick);
  return b;
}

function pick(a) {
  if (a.id === arena().id) return;
  if (dirty && !store.arenas.some(s => s.id === arena().id && JSON.stringify(s) === JSON.stringify(arena()))) {
    if (!confirm('Switch arenas? Your unsaved drawing will be lost.')) return;
  }
  store.project.arena = structuredClone(a);
  undoStack.length = 0;
  dirty = false;
  syncMeta();
  renderLists();
  store.changed('arena');
}

export function pickPreset(id) {
  pick(presetById(id));
}

export function renderLists() {
  const pl = $('preset-list');
  pl.replaceChildren(...presets.map(p => {
    const li = document.createElement('li');
    const b = mapButton(p, () => pick(presetById(p.id)));
    const best = bestBadge(p.id);
    if (best) b.querySelector('strong').append(best);
    li.append(b);
    return li;
  }));
  const sl = $('saved-list');
  sl.replaceChildren(...store.arenas.map(a => {
    const li = document.createElement('li');
    li.className = 'saved-row';
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'del';
    del.textContent = 'Delete';
    del.setAttribute('aria-label', `Delete ${a.name}`);
    del.addEventListener('click', () => {
      if (!confirm(`Delete "${a.name}"? This can't be undone.`)) return;
      store.deleteArena(a.id);
      renderLists();
    });
    li.append(mapButton(a, () => pick(a)), del);
    return li;
  }));
  $('saved-empty').hidden = store.arenas.length > 0;
}

function syncMeta() {
  const a = arena();
  $('arena-name').value = a.name;
  $('arena-mission').value = a.mission || 'reach';
  const size = `${a.w}x${a.h}`;
  const sel = $('arena-size');
  if (![...sel.options].some(o => o.value === size)) sel.append(new Option(`${a.w / 1000} × ${a.h / 1000} m`, size));
  sel.value = size;
}

function setTool(t) {
  tool = t;
  for (const b of $('tools').querySelectorAll('button')) b.setAttribute('aria-pressed', b.dataset.tool === t);
  canvas.style.cursor = t === 'erase' ? 'none' : 'crosshair';
}

export function initArena() {
  setTool('tape');
  syncMeta();
  renderLists();

  $('tools').addEventListener('click', e => {
    const b = e.target.closest('button[data-tool]');
    if (b) setTool(b.dataset.tool);
  });
  $('undo').addEventListener('click', undo);
  $('clear').addEventListener('click', () => {
    if (!confirm('Clear everything in this arena?')) return;
    snapshot();
    Object.assign(arena(), { lines: [], walls: [], objects: [], checkpoints: [], finish: null });
    commit();
  });
  $('arena-name').addEventListener('input', e => { arena().name = e.target.value || 'Untitled arena'; store.saveSoon(); });
  $('arena-mission').addEventListener('change', e => {
    snapshot();
    arena().mission = e.target.value;
    if (arena().mission === 'deliver' && arena().objects.length && !arena().objects.some(o => o.target)) arena().objects[0].target = true;
    commit();
  });
  $('arena-size').addEventListener('change', e => {
    snapshot();
    const [w, h] = e.target.value.split('x').map(Number);
    Object.assign(arena(), { w, h });
    const s = arena().start;
    s.x = Math.min(s.x, w - 100); s.y = Math.min(s.y, h - 100);
    commit();
  });
  $('save-arena').addEventListener('click', () => {
    if (presets.some(p => p.id === arena().id)) {
      arena().id = 'my-' + Date.now().toString(36);
      if (!arena().name.startsWith('Copy of')) arena().name = 'Copy of ' + arena().name;
      syncMeta();
    }
    store.saveArena(arena());
    dirty = false;
    renderLists();
    const btn = $('save-arena');
    setIcon(btn, 'check', 'Saved');
    setTimeout(() => setIcon(btn, 'save', 'Save arena'), 1200);
  });

  canvas.addEventListener('pointerdown', pointerDown);
  canvas.addEventListener('pointermove', pointerMove);
  canvas.addEventListener('pointerup', pointerUp);
  canvas.addEventListener('pointercancel', () => { drag = null; });
  canvas.addEventListener('pointerleave', () => { hover = null; });

  // Keyboard: arrows move the start, Shift moves it further, [ and ] turn it
  canvas.tabIndex = 0;
  canvas.addEventListener('keydown', e => {
    const step = e.shiftKey ? 100 : 20;
    const move = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
    const turn = { '[': -Math.PI / 12, ']': Math.PI / 12 }[e.key];
    if (!move && !turn) return;
    e.preventDefault();
    snapshot();
    const a = arena(), s = a.start;
    if (move) {
      s.x = Math.max(0, Math.min(a.w, s.x + move[0]));
      s.y = Math.max(0, Math.min(a.h, s.y + move[1]));
    } else s.a += turn;
    commit();
  });
  addEventListener('keydown', e => {
    if (!visible) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !/INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName)) {
      e.preventDefault();
      undo();
    }
  });

  store.on('project', () => { undoStack.length = 0; dirty = false; syncMeta(); renderLists(); });
  onTab(id => { visible = id === 'tab-arena'; });
  requestAnimationFrame(frame);
}
