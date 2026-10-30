import { store } from './store.js';
import { onTab, switchKind } from './main.js';
import {
  boards, motors, drivers, batteries, chassis as chassisDefs, sensors as sensorDefs,
  pinLabel, isAnalogPin, wiringIssues, irChannels, pinMap, motorTopSpeed,
} from '../engine/parts.js';
import { fitView, drawRobot } from '../ui/draw.js';
import { initWiring, renderWiring } from './wiring.js';
import { initBom } from './bom.js';

const $ = id => document.getElementById(id);
const el = (tag, props = {}, ...kids) => {
  const n = Object.assign(document.createElement(tag), props);
  for (const k of kids) n.append(k);
  return n;
};

// Tiny pictures next to each choice
const swatch = {
  board: id => `<svg viewBox="0 0 26 20"><rect x="1" y="2" width="24" height="16" rx="3" fill="${id === 'esp32' ? '#1d1f22' : '#1b6f8f'}"/><rect x="5" y="4" width="16" height="2" fill="#0d2f3b"/></svg>`,
  chassis: id => id === 'round'
    ? '<svg viewBox="0 0 26 20"><circle cx="13" cy="10" r="9" fill="#cfe3ea" stroke="#7c8b91"/></svg>'
    : `<svg viewBox="0 0 26 20"><rect x="${id === 'mini' ? 6 : 2}" y="3" width="${id === 'mini' ? 14 : 22}" height="14" rx="3" fill="#cfe3ea" stroke="#7c8b91"/></svg>`,
  motor: () => '<svg viewBox="0 0 26 20"><rect x="1" y="6" width="13" height="8" rx="2" fill="#f3c326"/><circle cx="18" cy="10" r="7" fill="#23272a"/><circle cx="18" cy="10" r="3" fill="#f3c326"/></svg>',
  driver: id => `<svg viewBox="0 0 26 20"><rect x="3" y="2" width="20" height="16" rx="2" fill="${id === 'l298n' ? '#c8343a' : id === 'tb6612' ? '#5b3ea6' : '#2a2d30'}"/></svg>`,
  battery: id => `<svg viewBox="0 0 26 20"><rect x="2" y="4" width="21" height="12" rx="3" fill="${id === 'li2' ? '#2f6fd1' : id === 'v9' ? '#d9a21b' : '#3a3f44'}"/><rect x="23" y="8" width="2" height="4" fill="#9aa7ad"/></svg>`,
};

const groups = [
  { key: 'board', title: 'Board', list: boards, pic: swatch.board },
  { key: 'chassis', title: 'Chassis', list: chassisDefs, pic: swatch.chassis },
  { key: 'motor', title: 'Motors', list: motors, pic: swatch.motor },
  { key: 'driver', title: 'Motor driver', list: drivers, pic: swatch.driver },
  { key: 'battery', title: 'Battery', list: batteries, pic: swatch.battery },
];

const robot = () => store.project.robot;
const board = () => boards[robot().board];

// ---------- pin helpers ----------

const hasCamera = () => robot().sensors.some(s => s.type === 'camera');

function usedPins(except) {
  const used = new Set();
  for (const [pin, users] of pinMap(robot())) {
    if (users.some(u => u !== except)) used.add(pin);
  }
  // The Pixy2 owns the SPI pins through the ICSP header
  if (hasCamera()) for (const p of board().spiPins) used.add(p);
  return used;
}

// Move anything sitting on the SPI pins once a Pixy2 is plugged in
function clearSpiPins() {
  const r = robot();
  const b = board();
  const taken = usedPins();
  const d = drivers[r.driver];
  for (const role of d.roles) {
    if (b.spiPins.includes(r.driverPins[role])) r.driverPins[role] = freePin({ pwm: d.pwmRoles.includes(role) }, taken);
  }
  for (const s of r.sensors) {
    const def = sensorDefs[s.type];
    for (const role of def.roles) {
      if (b.spiPins.includes(s.pins[role])) s.pins[role] = freePin({ analog: def.signal === 'analog', output: role === 'TRIG' || role === 'SIG' }, taken);
    }
  }
}

function freePin({ pwm = false, analog = false, output = true } = {}, taken = usedPins()) {
  const b = board();
  const ok = p => !taken.has(p) && !b.serialPins.includes(p)
    && (!pwm || b.pwm.includes(p))
    && (!analog || isAnalogPin(b, p))
    && (!output || (!b.inputOnly.includes(p) && !b.analogOnly.includes(p)));
  const order = analog ? b.pins.filter(p => isAnalogPin(b, p)) : b.pins.filter(p => !isAnalogPin(b, p)).concat(b.pins.filter(p => isAnalogPin(b, p)));
  const p = order.find(ok);
  if (p !== undefined) taken.add(p);
  return p;
}

function rewireDriver() {
  const r = robot();
  const d = drivers[r.driver];
  const taken = new Set();
  for (const s of r.sensors) for (const p of Object.values(s.pins)) taken.add(p);
  const pins = {};
  for (const role of d.pwmRoles) pins[role] = freePin({ pwm: true }, taken);
  for (const role of d.roles) if (!(role in pins)) pins[role] = freePin({}, taken);
  r.driverPins = pins;
}

function pinsForSensor(type) {
  const def = sensorDefs[type];
  const taken = usedPins();
  const pins = {};
  const b = board();
  def.roles.forEach((role, i) => {
    // I2C only works on the board's SDA/SCL pins, encoders need interrupt pins
    if (def.bus === 'i2c') { pins[role] = b.i2cPins[i]; return; }
    const irq = def.interrupt ? b.interruptPins.find(p => !taken.has(p) && !b.serialPins.includes(p)) : undefined;
    if (irq !== undefined) { taken.add(irq); pins[role] = irq; return; }
    pins[role] = freePin({ analog: def.signal === 'analog', output: role === 'TRIG' || role === 'SIG' || (def.outputs || []).includes(role) }, taken);
  });
  return pins;
}

// When the board changes, move wires off pins the new board doesn't have
function fitPinsToBoard() {
  const r = robot();
  const b = board();
  const taken = new Set([...pinMap(r).keys()].filter(p => b.pins.includes(p)));
  const d = drivers[r.driver];
  for (const role of d.roles) {
    const p = r.driverPins[role];
    if (p === 'jumper') continue;
    if (!b.pins.includes(p) || (d.pwmRoles.includes(role) && !b.pwm.includes(p))) r.driverPins[role] = freePin({ pwm: d.pwmRoles.includes(role) }, taken);
  }
  for (const s of r.sensors) {
    const def = sensorDefs[s.type];
    if (def.bus === 'i2c') { [s.pins.SDA, s.pins.SCL] = b.i2cPins; continue; }
    for (const role of def.roles) {
      const p = s.pins[role];
      const needAnalog = def.signal === 'analog';
      if (!b.pins.includes(p) || (needAnalog && !isAnalogPin(b, p))) s.pins[role] = freePin({ analog: needAnalog, output: role === 'TRIG' || role === 'SIG' }, taken);
    }
  }
}

// ---------- rendering ----------

function renderKind() {
  for (const b of $('kind-seg').querySelectorAll('button')) b.setAttribute('aria-pressed', b.dataset.kind === store.project.kind);
}

function renderGroups() {
  const host = $('part-groups');
  host.replaceChildren();
  for (const g of groups) {
    const list = el('div', { className: 'choice-list' });
    for (const item of Object.values(g.list)) {
      const btn = el('button', { type: 'button', className: 'choice' });
      btn.setAttribute('aria-pressed', robot()[g.key] === item.id);
      btn.innerHTML = `${g.pic(item.id)}<span class="name"></span><span class="blurb"></span>`;
      btn.querySelector('.name').textContent = item.name;
      btn.querySelector('.blurb').textContent = item.blurb || describeChassis(item);
      btn.addEventListener('click', () => {
        if (robot()[g.key] === item.id) return;
        robot()[g.key] = item.id;
        if (g.key === 'driver') rewireDriver();
        if (g.key === 'board') fitPinsToBoard();
        if (hasCamera()) clearSpiPins();
        store.changed('robot');
      });
      list.append(btn);
    }
    host.append(el('h2', { textContent: g.title }), list);
  }
}

function describeChassis(c) {
  return c.length ? `${c.length} × ${c.width} mm, wheels ${c.track} mm apart.` : '';
}

function slider(label, value, min, max, onInput) {
  const out = el('output', { textContent: `${value} mm` });
  const input = el('input', { type: 'range', min, max, step: 1, value });
  input.addEventListener('input', () => {
    out.textContent = `${input.value} mm`;
    onInput(+input.value);
  });
  return el('label', {}, el('span', { textContent: label }), input, out);
}

function renderSensors() {
  const host = $('sensor-list');
  host.replaceChildren();
  const ch = chassisDefs[robot().chassis];
  robot().sensors.forEach(s => {
    const def = sensorDefs[s.type];
    const remove = el('button', { type: 'button', textContent: 'Remove' });
    remove.setAttribute('aria-label', `Remove ${def.name}`);
    remove.addEventListener('click', () => {
      robot().sensors = robot().sensors.filter(x => x !== s);
      store.changed('robot');
    });
    const box = el('div', { className: 'sensor' }, el('div', { className: 'sensor-head' }, el('strong', { textContent: def.name }), remove));
    const live = () => { store.changed('robot', { quiet: true }); };
    box.append(slider('Ahead of axle', s.forward, -40, Math.round(ch.length / 2 + 30), v => { s.forward = v; live(); }));
    box.append(slider('Sideways', s.side, -70, 70, v => { s.side = v; live(); }));
    if (def.kind === 'sonar') {
      const sel = el('select');
      for (const f of ['front', 'left', 'right']) sel.append(el('option', { value: f, textContent: f[0].toUpperCase() + f.slice(1), selected: (s.facing || 'front') === f }));
      sel.addEventListener('change', () => { s.facing = sel.value; store.changed('robot'); });
      box.append(el('label', {}, el('span', { textContent: 'Facing' }), sel, el('span')));
    }
    host.append(box);
  });
  if (!robot().sensors.length) host.append(el('p', { className: 'hint', textContent: 'No sensors yet. A robot with no sensors can only drive blind.' }));
}

function renderAddSensor() {
  const sel = $('add-sensor-type');
  sel.replaceChildren();
  for (const def of Object.values(sensorDefs)) {
    sel.append(el('option', { value: def.id, textContent: def.soon ? `${def.name} (coming soon)` : def.name, disabled: !!def.soon }));
  }
}

function pinOptions(select, current, { allowJumper = false } = {}) {
  const b = board();
  select.replaceChildren();
  if (allowJumper) select.append(el('option', { value: 'jumper', textContent: 'Jumper (on)', selected: current === 'jumper' }));
  if (current === undefined) select.append(el('option', { value: '', textContent: 'Not wired', selected: true }));
  for (const p of b.pins) {
    select.append(el('option', { value: p, textContent: `${b.pwm.includes(p) ? '~' : ' '}${pinLabel(b, p)}`, selected: p === current }));
  }
}

function renderPins() {
  const tbody = $('pin-rows');
  tbody.replaceChildren();
  const r = robot();
  const d = drivers[r.driver];
  const issues = wiringIssues(r);
  const badPins = new Set(issues.filter(i => !i.soft && i.pin !== undefined).map(i => i.pin));

  const row = (label, key, current, set, opts) => {
    const sel = el('select');
    sel.setAttribute('aria-label', label);
    pinOptions(sel, current, opts);
    sel.addEventListener('change', () => {
      set(sel.value === 'jumper' ? 'jumper' : sel.value === '' ? undefined : +sel.value);
      store.changed('robot');
    });
    const tr = el('tr', {}, el('td', { textContent: label }), el('td', {}, sel));
    tr.dataset.keys = key;
    if (badPins.has(current)) tr.classList.add('bad');
    tbody.append(tr);
  };
  const head = text => tbody.append(el('tr', {}, el('th', { colSpan: 2, textContent: text })));

  head(`${d.name}  (A = left wheel, B = right)`);
  for (const role of d.roles) {
    row(role, `driver:${role}`, r.driverPins[role], v => { r.driverPins[role] = v; }, { allowJumper: d.pwmRoles.includes(role) && d.id !== 'tb6612' });
  }
  const flips = el('td', { colSpan: 2 });
  for (const [key, label] of [['flipA', 'Motor A wires swapped'], ['flipB', 'Motor B wires swapped']]) {
    const box = el('input', { type: 'checkbox', checked: !!r[key] });
    box.addEventListener('change', () => { r[key] = box.checked; store.changed('robot'); });
    flips.append(el('label', { className: 'check' }, box, ` ${label}`), ' ');
  }
  tbody.append(el('tr', {}, flips));

  r.sensors.forEach((s, i) => {
    const def = sensorDefs[s.type];
    if (def.kind === 'camera') {
      head(def.name);
      const spi = board().spiPins.map(p => pinLabel(board(), p)).join(', ');
      const tr = el('tr', {}, el('td', { textContent: 'ICSP cable' }), el('td', { textContent: spi }));
      tr.dataset.keys = `${s.id}:spi`;
      tbody.append(tr);
      return;
    }
    if (!def.roles.length) return;
    head(`${def.name}${r.sensors.filter(x => x.type === s.type).length > 1 ? ` ${i + 1}` : ''}${s.facing ? `, ${s.facing}` : ''}`);
    for (const role of def.roles) row(role, `${s.id}:${role}`, s.pins[role], v => { s.pins[role] = v; });
  });

  const ul = $('wiring-issues');
  ul.replaceChildren();
  for (const i of issues) ul.append(el('li', { className: i.soft ? 'soft' : '', textContent: i.msg }));
  if (!issues.length) ul.append(el('li', { className: 'ok', textContent: 'Wiring looks right.' }));
}

function renderSpecs() {
  const r = robot();
  const chans = irChannels(r);
  const volts = Math.max(0, batteries[r.battery].volts - drivers[r.driver].drop);
  const used = pinMap(r).size + (hasCamera() ? board().spiPins.length : 0);
  const items = [
    ['Top speed', `${(motorTopSpeed(r) / 1000).toFixed(2)} m/s`],
    ['Motors get', `${volts.toFixed(1)} V`],
    ['Pins used', `${used} of ${board().pins.length}`],
  ];
  if (chans.length) items.push(['Line sensors', `${chans.length}, ${Math.round(chans[0].forward)} mm ahead`]);
  $('specs').replaceChildren(...items.map(([k, v]) => el('div', {}, el('dt', { textContent: k }), el('dd', { textContent: v }))));
}

// ---------- preview ----------

const canvas = $('robot-canvas');
const ctx = canvas.getContext('2d');
let visible = true;
let spin = 0;

// Labels with leader lines, like a parts drawing. Robot coordinates have the
// nose along +x; the preview is turned so the nose points up the screen.
function drawCallouts(r, ch, size, view, now) {
  const dpr = view.dpr;
  const toScreen = (x, y) => ({ x: view.ox + (size / 2 + y) * view.scale, y: view.oy + (size / 2 - x) * view.scale });
  const half = ch.shape === 'round' ? ch.radius : ch.length / 2;
  const items = [
    { at: [Math.min(18, half - 50 - 24), 20], text: boards[r.board].name, side: 1 },
    { at: [-6, -12], text: drivers[r.driver].name, side: -1 },
    { at: [-half * 0.76 + 17, 10], text: batteries[r.battery].name, side: 1 },
    { at: [0, -ch.track / 2], text: `${motors[r.motor].name} ×2`, side: -1 },
  ];
  const seen = new Set();
  for (const s of r.sensors) {
    if (seen.has(s.type)) continue;
    seen.add(s.type);
    items.push({ at: [s.forward, s.side], text: sensorDefs[s.type].name, side: s.side > 0 ? 1 : -1 });
  }

  const center = toScreen(0, 0);
  const reach = half * view.scale + 46;
  const w = canvas.width / dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  // Narrow screens have no room beside the robot for labels
  if (w < 560) items.length = 0;
  ctx.font = '700 12px Atkinson Hyperlegible, sans-serif';
  ctx.textBaseline = 'middle';

  for (const dir of [-1, 1]) {
    const list = items.filter(i => i.side === dir).map(i => ({ ...i, p: toScreen(...i.at) })).sort((a, b) => a.p.y - b.p.y);
    let lastY = -Infinity;
    for (const it of list) {
      const ly = Math.max(it.p.y, lastY + 30);
      lastY = ly;
      const tw = ctx.measureText(it.text).width + 18;
      let lx = center.x + dir * reach;
      lx = dir > 0 ? Math.min(lx, w - tw - 8) : Math.max(lx, tw + 8);

      ctx.strokeStyle = 'rgba(255,255,255,0.55)';
      ctx.lineWidth = 1.2;
      ctx.setLineDash([4, 4]);
      ctx.lineDashOffset = -now / 60;
      ctx.beginPath();
      ctx.moveTo(it.p.x, it.p.y);
      ctx.lineTo(lx - dir * 14, ly);
      ctx.lineTo(lx, ly);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.arc(it.p.x, it.p.y, 3, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.beginPath(); ctx.arc(it.p.x, it.p.y, 6, 0, Math.PI * 2); ctx.stroke();

      const bx = dir > 0 ? lx : lx - tw;
      ctx.fillStyle = 'rgba(15, 40, 50, 0.78)';
      ctx.beginPath(); ctx.roundRect(bx, ly - 12, tw, 24, 12); ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.fillText(it.text, bx + 9, ly + 0.5);
    }
  }

  // Track width under the robot
  const a = toScreen(0, -ch.track / 2), b = toScreen(0, ch.track / 2);
  const y = center.y + half * view.scale + 26;
  ctx.strokeStyle = 'rgba(255,255,255,0.5)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(a.x, y); ctx.lineTo(b.x, y);
  ctx.moveTo(a.x, y - 5); ctx.lineTo(a.x, y + 5);
  ctx.moveTo(b.x, y - 5); ctx.lineTo(b.x, y + 5);
  ctx.stroke();
  const label = `${ch.track} mm between wheels`;
  ctx.font = '12px Atkinson Hyperlegible, sans-serif';
  const lw = ctx.measureText(label).width + 12;
  ctx.fillStyle = '#1c5a70';
  ctx.fillRect((a.x + b.x) / 2 - lw / 2, y - 9, lw, 18);
  ctx.fillStyle = 'rgba(255,255,255,0.8)';
  ctx.textAlign = 'center';
  ctx.fillText(label, (a.x + b.x) / 2, y + 0.5);
  ctx.textAlign = 'start';
}

const calm = matchMedia('(prefers-reduced-motion: reduce)');

function drawPreview(now) {
  if (visible) {
    if (calm.matches) { now = 0; spin -= 0.6; }   // hold the demo still
    const r = robot();
    const ch = chassisDefs[r.chassis];
    const size = Math.max(ch.length, ch.width) + 150;
    const view = fitView(canvas, size, size, 30);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    view.apply(ctx);
    ctx.translate(size / 2, size / 2);
    ctx.rotate(-Math.PI / 2);   // nose up reads better on screen

    spin += 0.6;
    const n = irChannels(r).length;
    const lit = Math.floor(now / 260) % Math.max(1, n * 2 - 2);
    const idx = lit < n ? lit : n * 2 - 2 - lit;
    const grip = r.sensors.find(s => s.type === 'gripper');
    drawRobot(ctx, r, { x: 0, y: 0, a: 0 }, {
      travelL: spin, travelR: spin,
      ir: irChannels(r).map((_, i) => (i === idx ? 1 : 0)),
      servo: grip ? 50 + Math.sin(now / 700) * 40 : undefined,
      beams: r.sensors.filter(s => s.type === 'hcsr04').map(s => ({ facing: s.facing || 'front', forward: s.forward, side: s.side, mm: 140 + Math.sin(now / 400) * 20 })),
      running: true,
    });

    // forward arrow
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    const tip = (ch.shape === 'round' ? ch.radius : ch.length / 2) + 46;
    ctx.beginPath();
    ctx.moveTo(tip + 16, 0); ctx.lineTo(tip, -9); ctx.lineTo(tip, 9);
    ctx.fill();

    drawCallouts(r, ch, size, view, now);
  }
  requestAnimationFrame(drawPreview);
}

function renderAll() {
  renderKind();
  renderGroups();
  renderSensors();
  renderPins();
  renderWiring(robot());
  renderSpecs();
}

export function initRobot() {
  initWiring();
  initBom(robot);
  renderAddSensor();
  renderAll();

  $('kind-seg').addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b || b.dataset.kind === store.project.kind) return;
    const labels = { line: 'line follower', maze: 'maze solver', grab: 'grabber', avoid: 'obstacle avoider', sumo: 'sumo robot' };
    if (confirm(`Start a ${labels[b.dataset.kind]}? This replaces the robot, arena and code with a fresh set. Export first if you want to keep them.`)) {
      switchKind(b.dataset.kind);
    }
  });

  $('add-sensor').addEventListener('click', () => {
    const type = $('add-sensor-type').value;
    const def = sensorDefs[type];
    const ch = chassisDefs[robot().chassis];
    const front = ch.shape === 'round' ? ch.radius : ch.length / 2;
    const s = { id: 's' + Date.now().toString(36), type, side: 0, forward: Math.round(front - 10), pins: pinsForSensor(type) };
    if (def.kind === 'sonar') { s.facing = 'front'; s.forward = Math.round(front - 20); }
    if (def.kind === 'gripper') s.forward = Math.round(front + 5);
    if (def.kind === 'camera') s.forward = Math.round(front - 25);
    if (def.kind === 'encoder' || def.kind === 'imu') s.forward = 0;
    robot().sensors.push(s);
    if (def.kind === 'camera') clearSpiPins();
    store.changed('robot');
  });

  store.on('robot', detail => {
    if (detail && detail.quiet) { renderSpecs(); return; }
    renderAll();
  });
  store.on('project', renderAll);
  onTab(id => { visible = id === 'tab-robot'; });
  requestAnimationFrame(drawPreview);
}
