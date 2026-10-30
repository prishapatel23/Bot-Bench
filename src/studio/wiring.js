// Wiring diagram for the Robot tab. The board's header runs down the left,
// every module sits on the right with its own pins, and each connection is
// drawn as a jumper wire. Colours follow the usual kit habit: red for 5 V,
// black for GND, yellow for PWM, anything else for plain signals.
//
// diagramSvg() only builds a string, so it runs under Node too.

import { boards, drivers, batteries, sensors as sensorDefs, pinLabel, wiringIssues } from '../engine/parts.js';

const ROW = 14;
const GAP_ROW = 10;
const W = 300;
const PX = 180;          // left edge of the module column
const PW = 114;
const CH = 5.1;          // width of one pin label character

const RED = '#e2484e';
const ORANGE = '#f08a24';
const BLACK = '#2b2f33';
const PWM = '#f3c326';
const signal = ['#2f7fd8', '#3fae6a', '#8e5bd6', '#14a3b8', '#c25b9a', '#8a6a3b', '#7c8b91'];

const powerColor = { '5V': RED, '3V3': ORANGE, GND: BLACK, 'BAT+': RED, 'BAT-': BLACK };

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const short = (s, n = 25) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

// Board outlines: width, room above and below the header rows, PCB colour
const shapes = {
  uno: { w: 96, top: 26, bottom: 16, fill: '#1b6f8f', tag: 'UNO' },
  nano: { w: 74, top: 26, bottom: 18, fill: '#1f5f9e', tag: 'NANO' },
  mega: { w: 106, top: 26, bottom: 16, fill: '#1b6f8f', tag: 'MEGA 2560' },
  esp32: { w: 86, top: 64, bottom: 24, fill: '#1d1f22', tag: 'ESP32' },
};

// Real pin order on the module, where it isn't just VCC, GND, signals
const pinOrder = {
  hcsr04: ['VCC', 'TRIG', 'ECHO', 'GND'],
  gripper: ['GND', 'VCC', 'SIG'],
};

const partFill = { l298n: '#c8343a', l293d: '#2a2d30', tb6612: '#5b3ea6', hcsr04: '#1f5f9e', gripper: '#2f6fd1', camera: '#3a3f44' };
const batteryFill = { aa4: '#3a3f44', li2: '#2f6fd1', v9: '#d9a21b' };

function spiNames(board) {
  if (board.id === 'esp32') return { 18: 'SCK', 19: 'MISO', 23: 'MOSI' };
  if (board.id === 'mega') return { 50: 'MISO', 51: 'MOSI', 52: 'SCK' };
  return { 11: 'MOSI', 12: 'MISO', 13: 'SCK' };
}

// Everything the diagram needs, without any coordinates yet
export function wiringModel(robot) {
  const b = boards[robot.board] || boards.uno;
  const d = drivers[robot.driver];
  const bad = new Set(wiringIssues(robot).filter(i => !i.soft && i.pin !== undefined).map(i => i.pin));
  const low = b.logic < 5;
  let n = 0;
  const nextColor = () => signal[n++ % signal.length];
  const parts = [];

  if (d) {
    const logic = d.id === 'tb6612' && low ? '3V3' : '5V';
    const supply = {
      l298n: [['12V', ['BAT+']], ['GND', ['BAT-', 'GND']], ['5V', [logic]]],
      l293d: [['VCC2', ['BAT+']], ['VCC1', [logic]], ['GND', ['BAT-', 'GND']]],
      tb6612: [['VM', ['BAT+']], ['VCC', [logic]], ['GND', ['BAT-', 'GND']]],
    }[d.id] || [['VM', ['BAT+']], ['GND', ['BAT-', 'GND']]];
    const pins = supply.map(([name, to]) => ({ name, to, key: 'power:' + to[to.length - 1], color: powerColor[to[0]] }));
    for (const role of d.roles) {
      const pwm = d.pwmRoles.includes(role);
      pins.push({ name: role, to: [robot.driverPins[role]], key: `driver:${role}`, color: pwm ? PWM : nextColor() });
    }
    parts.push({ title: d.name, fill: partFill[d.id] || '#2a2d30', pins });
  }

  robot.sensors.forEach((s, i) => {
    const def = sensorDefs[s.type];
    if (!def) return;
    const same = robot.sensors.filter(x => x.type === s.type).length > 1;
    const sub = [same ? `#${i + 1}` : '', s.facing ? `facing ${s.facing}` : ''].filter(Boolean).join(', ');
    const vcc = def.kind === 'ir' && low ? '3V3' : '5V';
    const power = name => ({ name, to: [name === 'GND' ? 'GND' : vcc], key: 'power:' + (name === 'GND' ? 'GND' : vcc), color: powerColor[name === 'GND' ? 'GND' : vcc] });
    const pins = [];
    if (def.kind === 'camera' || def.bus === 'spi') {
      const names = spiNames(b);
      pins.push(power('VCC'), power('GND'));
      for (const p of b.spiPins) pins.push({ name: names[p] || pinLabel(b, p), to: [p], key: `${s.id}:spi`, color: nextColor() });
    } else {
      const roles = def.roles || [];
      const fixed = (pinOrder[s.type] || []).filter(r => r === 'VCC' || r === 'GND' || roles.includes(r));
      const order = fixed.length ? fixed.concat(roles.filter(r => !fixed.includes(r))) : ['VCC', 'GND', ...roles];
      for (const name of order) {
        if (name === 'VCC' || name === 'GND') { pins.push(power(name)); continue; }
        pins.push({ name, to: [s.pins ? s.pins[name] : undefined], key: `${s.id}:${name}`, color: nextColor() });
      }
    }
    parts.push({ title: def.name, sub, fill: partFill[s.type] || '#2a3a40', pins });
  });

  for (const p of parts) for (const pin of p.pins) pin.bad = pin.to.some(t => typeof t === 'number' && (bad.has(t) || !b.pins.includes(t)));
  return { board: b, battery: batteries[robot.battery], batteryId: robot.battery, parts, bad };
}

// Header rows for the board: power first, then every pin. Big boards fold
// runs of unused pins into one short row so the drawing stays readable.
function headerRows(model) {
  const b = model.board;
  const keysFor = new Map();
  for (const part of model.parts) {
    for (const pin of part.pins) {
      for (const t of pin.to) {
        if (t === undefined || t === 'jumper' || t === 'BAT+' || t === 'BAT-') continue;
        if (!keysFor.has(t)) keysFor.set(t, []);
        if (!keysFor.get(t).includes(pin.key)) keysFor.get(t).push(pin.key);
      }
    }
  }
  const rows = [];
  for (const name of b.logic < 5 ? ['3V3', '5V', 'GND'] : ['5V', 'GND']) {
    rows.push({ power: name, label: name, keys: keysFor.get(name) || [], h: ROW });
  }
  rows.push({ spacer: true, h: 6 });
  const fold = b.pins.length > 30;
  let run = [];
  const flush = () => {
    if (!run.length) return;
    if (fold && run.length > 1) rows.push({ gap: true, label: `${pinLabel(b, run[0])}–${pinLabel(b, run[run.length - 1])}`, h: GAP_ROW });
    else for (const p of run) rows.push({ pin: p, label: (b.pwm.includes(p) ? '~' : '') + pinLabel(b, p), keys: [], h: ROW });
    run = [];
  };
  for (const p of b.pins) {
    if (!keysFor.has(p)) { run.push(p); continue; }
    flush();
    rows.push({ pin: p, label: (b.pwm.includes(p) ? '~' : '') + pinLabel(b, p), keys: keysFor.get(p), h: ROW, bad: model.bad.has(p) });
  }
  flush();
  return rows;
}

function boardArt(id, x, y, w, h, shape) {
  const left = w - 52;   // room left of the pin labels
  const holes = `<circle cx="${x + 6}" cy="${y + 6}" r="2.4" class="hole"/><circle cx="${x + 6}" cy="${y + h - 6}" r="2.4" class="hole"/>`;
  const name = `<text x="${x + 8}" y="${y + 17}" class="board-tag">${shape.tag}</text>`;
  const usbB = `<rect x="${x - 5}" y="${y + 34}" width="24" height="20" rx="1.5" fill="#c9d1d4" stroke="#8e9a9f"/>`;
  const jack = `<rect x="${x - 4}" y="${y + 66}" width="21" height="15" rx="2" fill="#151719"/>`;
  const qfp = (cx, cy, s) => `<rect x="${cx - s / 2}" y="${cy - s / 2}" width="${s}" height="${s}" rx="1" fill="#151719" stroke="#b9c2c6" stroke-width="1.4" stroke-dasharray="1.2 1.6" transform="rotate(45 ${cx} ${cy})"/>`;
  if (id === 'nano') {
    return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="4" fill="${shape.fill}"/>`
      + `<rect x="${x + left / 2 - 4}" y="${y - 5}" width="16" height="11" rx="1.5" fill="#c9d1d4" stroke="#8e9a9f"/>`
      + qfp(x + left / 2 + 4, y + h * 0.5, 13)
      + `<rect x="${x + left / 2}" y="${y + h - 16}" width="8" height="8" rx="1" fill="#e6e9ea"/>`
      + `<text x="${x + 8}" y="${y + 20}" class="board-tag">${shape.tag}</text>`;
  }
  if (id === 'esp32') {
    let zig = `M${x + 10} ${y + 16}`;
    for (let i = 0; i < 8; i++) zig += ` v-8 h${(w - 20) / 16} v8 h${(w - 20) / 16}`;
    return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="4" fill="${shape.fill}"/>`
      + `<rect x="${x + 6}" y="${y + 3}" width="${w - 12}" height="54" rx="2" fill="#2b3137"/>`
      + `<path d="${zig}" fill="none" stroke="#d9a21b" stroke-width="1.2"/>`
      + `<rect x="${x + 9}" y="${y + 20}" width="${w - 18}" height="33" rx="1.5" fill="#c9d1d4" stroke="#8e9a9f"/>`
      + `<text x="${x + w / 2}" y="${y + 40}" class="board-tag dark" text-anchor="middle">${shape.tag}</text>`
      + `<rect x="${x + left / 2 - 2}" y="${y + h - 7}" width="16" height="10" rx="1.5" fill="#c9d1d4" stroke="#8e9a9f"/>`
      + `<rect x="${x + 5}" y="${y + h - 14}" width="7" height="7" rx="1" fill="#e6e9ea"/>`
      + `<rect x="${x + left - 2}" y="${y + h - 14}" width="7" height="7" rx="1" fill="#e6e9ea"/>`;
  }
  // Uno, Mega, and anything new that looks like them
  const chip = id === 'mega'
    ? qfp(x + left / 2 + 2, y + h * 0.55, 24)
    : `<rect x="${x + left / 2 - 5}" y="${y + h * 0.42}" width="16" height="${Math.min(90, h * 0.42)}" rx="1.5" fill="#151719"/>`
      + `<line x1="${x + left / 2 - 6}" y1="${y + h * 0.42 + 3}" x2="${x + left / 2 - 6}" y2="${y + h * 0.42 + Math.min(90, h * 0.42) - 2}" stroke="#b9c2c6" stroke-width="2.2" stroke-dasharray="1.6 2.6"/>`
      + `<line x1="${x + left / 2 + 12}" y1="${y + h * 0.42 + 3}" x2="${x + left / 2 + 12}" y2="${y + h * 0.42 + Math.min(90, h * 0.42) - 2}" stroke="#b9c2c6" stroke-width="2.2" stroke-dasharray="1.6 2.6"/>`
      + `<circle cx="${x + left / 2 + 3}" cy="${y + h * 0.42 + 4}" r="2" fill="#3a3f44"/>`;
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="6" fill="${shape.fill}"/>${holes}${usbB}${jack}${chip}${name}`;
}

// White tag behind a label that has a wiring problem, so it reads on any PCB colour
function pill(x, y, label, anchor) {
  const w = label.length * CH + 6;
  return `<rect x="${anchor === 'end' ? x - w + 3 : x - 3}" y="${y - 6}" width="${w}" height="12" rx="3" fill="#fff"/>`;
}

function wirePath(x1, y1, x2, y2, i) {
  const t = 0.3 + 0.4 * ((i * 0.618) % 1);
  const mx = x1 + (x2 - x1) * t;
  return `M${x1} ${y1} C${mx.toFixed(1)} ${y1}, ${mx.toFixed(1)} ${y2}, ${x2} ${y2}`;
}

export function diagramSvg(robot) {
  const model = wiringModel(robot);
  const b = model.board;
  const shape = shapes[b.id] || { ...shapes.uno, tag: b.name.toUpperCase() };
  const rows = headerRows(model);
  const bx = 10;
  const by = 10;
  const padX = bx + shape.w - 10;

  // Header rows
  let y = by + shape.top;
  const at = new Map();
  for (const r of rows) {
    r.y = y + r.h / 2;
    if (r.power) at.set(r.power, r.y);
    if (r.pin !== undefined) at.set(r.pin, r.y);
    y += r.h;
  }
  const boardH = y - by + shape.bottom;

  // Battery under the board
  const batY = by + boardH + 18;
  const batW = 92;
  at.set('BAT+', batY + 13);
  at.set('BAT-', batY + 29);

  // Modules down the right
  let py = by;
  const blocks = model.parts.map(part => {
    const head = part.sub ? 28 : 18;
    const h = head + part.pins.length * ROW + 4;
    const blk = { part, y: py, h };
    part.pins.forEach((pin, i) => { pin.y = py + head + i * ROW + ROW / 2; });
    py += h + 10;
    return blk;
  });
  const H = Math.max(batY + 44, py) + 4;

  const base = [];
  const wires = [];
  const top = [];

  base.push(boardArt(b.id, bx, by, shape.w, boardH, shape));
  base.push(`<rect x="${padX - 6}" y="${by + shape.top - 4}" width="12" height="${y - by - shape.top + 8}" rx="2" fill="#151719"/>`);
  for (const r of rows) {
    if (r.spacer) continue;
    if (r.gap) {
      top.push(`<text x="${padX - 9}" y="${r.y}" dy=".35em" class="pin-lbl dim gap" text-anchor="end">${esc(r.label)}</text>`
        + `<line x1="${padX}" y1="${r.y - 2}" x2="${padX}" y2="${r.y + 2}" stroke="#d9a21b" stroke-width="2" stroke-dasharray="1 1.5"/>`);
      continue;
    }
    const used = r.keys.length > 0;
    const cls = `pin-lbl${used ? '' : ' dim'}${r.bad ? ' bad' : ''}`;
    top.push(`<g class="pin-row${used ? ' used' : ''}"${used ? ` data-keys="${esc(r.keys.join(' '))}"` : ''}>`
      + (r.bad ? pill(padX - 9, r.y, r.label, 'end') : '')
      + `<rect class="pad" x="${padX - 3}" y="${r.y - 3}" width="6" height="6" fill="${r.bad ? RED : '#d9a21b'}"/>`
      + `<text x="${padX - 9}" y="${r.y}" dy=".35em" class="${cls}" text-anchor="end">${esc(r.label)}</text></g>`);
  }

  // Battery pack
  base.push(`<rect x="${bx}" y="${batY}" width="${batW}" height="40" rx="5" fill="${batteryFill[model.batteryId] || '#3a3f44'}"/>`
    + `<text x="${bx + 8}" y="${batY + 23}" class="part-title">${esc(short(model.battery ? model.battery.name : 'Battery', 17))}</text>`);
  for (const [t, label, key] of [['BAT+', '+', 'power:BAT+'], ['BAT-', '−', 'power:GND']]) {
    top.push(`<g class="part-pin" data-keys="${key}"><rect class="pad" x="${bx + batW - 3}" y="${at.get(t) - 3}" width="6" height="6" fill="#d9a21b"/>`
      + `<text x="${bx + batW - 7}" y="${at.get(t)}" dy=".35em" class="pin-lbl" text-anchor="end">${label}</text></g>`);
  }

  // Modules and wires
  let wi = 0;
  for (const { part, y: ty, h } of blocks) {
    base.push(`<rect x="${PX}" y="${ty}" width="${PW}" height="${h}" rx="5" fill="${part.fill}"/>`
      + `<text x="${PX + 7}" y="${ty + 12}" class="part-title">${esc(short(part.title))}</text>`
      + (part.sub ? `<text x="${PX + 7}" y="${ty + 22}" class="part-sub">${esc(part.sub)}</text>` : ''));
    for (const pin of part.pins) {
      const cls = `pin-lbl${pin.bad ? ' bad' : ''}`;
      let note = '';
      for (const t of pin.to) {
        const from = typeof t === 'number' || powerColor[t] ? at.get(t) : undefined;
        if (t === 'jumper') {
          note = `<rect x="${PX - 5}" y="${pin.y - 4.5}" width="10" height="9" rx="1.5" fill="#111"/>`
            + `<text x="${PX - 9}" y="${pin.y}" dy=".35em" class="note" text-anchor="end">jumper on</text>`;
          continue;
        }
        if (from === undefined) {
          const what = t === undefined ? 'not wired' : `no pin ${t}`;
          note = `<line x1="${PX}" y1="${pin.y}" x2="${PX - 16}" y2="${pin.y}" stroke="${RED}" stroke-width="2" stroke-dasharray="3 2"/>`
            + `<text x="${PX - 20}" y="${pin.y}" dy=".35em" class="note bad" text-anchor="end">${what}</text>`;
          continue;
        }
        const x1 = t === 'BAT+' || t === 'BAT-' ? bx + batW : padX;
        const d = wirePath(x1, from, PX, pin.y, wi++);
        const fromLabel = t === 'BAT+' ? 'Battery +' : t === 'BAT-' ? 'Battery −' : typeof t === 'number' ? pinLabel(b, t) : t;
        wires.push(`<g class="wire${pin.bad ? ' bad' : ''}" data-keys="${esc(pin.key)}" tabindex="0" role="button" aria-label="${esc(`${fromLabel} to ${part.title} ${pin.name}`)}">`
          + `<path class="hit" d="${d}"/><path class="sheath" d="${d}"/>`
          + `<path class="core" d="${d}" stroke="${pin.color}"/></g>`);
      }
      top.push(`<g class="part-pin" data-keys="${esc(pin.key)}">${note}`
        + (pin.bad ? pill(PX + 7, pin.y, pin.name, 'start') : '')
        + `<rect class="pad" x="${PX - 3}" y="${pin.y - 3}" width="6" height="6" fill="${pin.bad ? RED : '#d9a21b'}"/>`
        + `<text x="${PX + 7}" y="${pin.y}" dy=".35em" class="${cls}">${esc(pin.name)}</text></g>`);
    }
  }

  return `<svg class="wire-svg" viewBox="0 0 ${W} ${Math.ceil(H)}" role="group" aria-label="Wiring diagram for the ${esc(b.name)}">`
    + base.join('') + wires.join('') + top.join('') + '</svg>';
}

// ---------- in the page ----------

let hot = '';

function mark() {
  const fig = document.getElementById('wire-diagram');
  for (const n of document.querySelectorAll('.wiring [data-keys]')) {
    n.classList.toggle('hot', !!hot && n.dataset.keys.split(' ').includes(hot));
  }
  fig.classList.toggle('has-hot', !!hot && !!fig.querySelector('.wire.hot'));
}

export function renderWiring(robot) {
  document.getElementById('wire-diagram').innerHTML = diagramSvg(robot);
  mark();
}

export function initWiring() {
  const fig = document.getElementById('wire-diagram');
  const pick = e => {
    const n = e.target.closest('[data-keys]');
    const key = n ? n.dataset.keys.split(' ')[0] : '';
    hot = key === hot ? '' : key;
    mark();
    const row = hot && document.querySelector(`#pin-rows tr.hot`);
    if (row) row.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  };
  fig.addEventListener('click', pick);
  fig.addEventListener('keydown', e => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    pick(e);
  });
  const fromTable = e => {
    const tr = e.target.closest('tr[data-keys]');
    if (!tr || tr.dataset.keys === hot) return;
    hot = tr.dataset.keys;
    mark();
  };
  const rows = document.getElementById('pin-rows');
  rows.addEventListener('click', fromTable);
  rows.addEventListener('focusin', fromTable);
}
