// Parts list for the current robot, with rough street prices. Clone boards
// and common modules, one unit each. Kept here and not in the
// engine because prices are a shopping question, not a simulation one.

import { boards, motors, drivers, batteries, chassis, sensors } from '../engine/parts.js';

// id: [USD, INR]
export const prices = {
  uno: [12, 550],
  nano: [8, 350],
  mega: [18, 1100],
  esp32: [7, 400],
  tt: [2.5, 70],
  n20: [6, 350],
  ga25: [9, 600],
  l298n: [4, 150],
  l293d: [2, 60],
  tb6612: [5, 180],
  aa4: [4, 180],
  li2: [12, 450],
  v9: [3, 80],
  round: [8, 350],
  rect: [10, 400],
  mini: [7, 300],
  'ir-single': [1, 40],
  'ir-3': [3, 150],
  'ir-5': [6, 300],
  'ir-5a': [8, 450],
  hcsr04: [2, 80],
  gripper: [12, 600],
  camera: [70, 7500],
  encoder: [4, 200],
  mpu6050: [3, 180],
  tcs3200: [6, 400],
  jumpers: [3, 120],
};

const names = { jumpers: 'Jumper wires, pack of 40' };

export function bomRows(robot) {
  const rows = [];
  const add = (id, qty, list) => {
    const old = rows.find(r => r.id === id);
    if (old) { old.qty += qty; return; }
    const p = prices[id];
    rows.push({ id, qty, name: (list && list[id] && list[id].name) || names[id] || id, usd: p ? p[0] : null, inr: p ? p[1] : null });
  };
  add(robot.board, 1, boards);
  add(robot.chassis, 1, chassis);
  add(robot.motor, 2, motors);
  add(robot.driver, 1, drivers);
  add(robot.battery, 1, batteries);
  for (const s of robot.sensors) add(s.type, 1, sensors);
  add('jumpers', 1);
  return rows;
}

export function bomTotal(rows) {
  const known = rows.filter(r => r.usd !== null);
  return {
    usd: known.reduce((t, r) => t + r.usd * r.qty, 0),
    inr: known.reduce((t, r) => t + r.inr * r.qty, 0),
    missing: rows.length - known.length,
  };
}

export const usd = n => (n === null ? 'price n/a' : '$' + n.toFixed(2));
export const inr = n => (n === null ? 'price n/a' : '₹' + Math.round(n).toLocaleString('en-IN'));

export function bomText(rows, title = 'Robot') {
  const t = bomTotal(rows);
  const lines = rows.map(r => `${r.qty} × ${r.name}  ${r.usd === null ? 'price n/a' : `${usd(r.usd * r.qty)} / ${inr(r.inr * r.qty)}`}`);
  return [`${title}: parts list`, ...lines, `Total  ${usd(t.usd)} / ${inr(t.inr)}${t.missing ? ` (plus ${t.missing} without a price)` : ''}`].join('\n');
}

export function bomCsv(rows) {
  const q = s => `"${String(s).replace(/"/g, '""')}"`;
  const t = bomTotal(rows);
  const lines = rows.map(r => [r.qty, q(r.name), r.usd === null ? '' : r.usd.toFixed(2), r.inr === null ? '' : r.inr, r.usd === null ? '' : (r.usd * r.qty).toFixed(2), r.inr === null ? '' : r.inr * r.qty].join(','));
  // Byte order mark, so Excel reads the file as UTF-8 and keeps the ×
  return String.fromCharCode(0xfeff) + ['Qty,Part,USD each,INR each,USD,INR', ...lines, `,Total,,,${t.usd.toFixed(2)},${t.inr}`].join('\r\n') + '\r\n';
}

// ---------- dialog ----------

const $ = id => document.getElementById(id);

function fill(robot) {
  const rows = bomRows(robot);
  const t = bomTotal(rows);
  const body = $('bom-rows');
  body.replaceChildren();
  for (const r of rows) {
    const tr = document.createElement('tr');
    for (const [text, cls] of [[r.qty, 'num'], [r.name, ''], [r.usd === null ? 'price n/a' : usd(r.usd * r.qty), 'num'], [r.inr === null ? 'price n/a' : inr(r.inr * r.qty), 'num']]) {
      const td = document.createElement('td');
      td.textContent = text;
      if (cls) td.className = cls;
      if (r.usd === null && text === 'price n/a') td.classList.add('na');
      tr.append(td);
    }
    body.append(tr);
  }
  $('bom-total-usd').textContent = usd(t.usd);
  $('bom-total-inr').textContent = inr(t.inr);
  $('bom-missing').hidden = !t.missing;
  $('bom-missing').textContent = t.missing ? `${t.missing} part${t.missing > 1 ? 's have' : ' has'} no price yet and ${t.missing > 1 ? 'are' : 'is'} left out of the total.` : '';
  $('bom-text').hidden = true;
  $('bom-copy').textContent = 'Copy';
  return rows;
}

export function initBom(getRobot) {
  const dlg = $('bom-dialog');
  let rows = [];
  $('bom-open').addEventListener('click', () => {
    rows = fill(getRobot());
    dlg.showModal();
  });
  $('bom-close').addEventListener('click', () => dlg.close());
  dlg.addEventListener('click', e => { if (e.target === dlg) dlg.close(); });

  $('bom-copy').addEventListener('click', async () => {
    const text = bomText(rows, getRobot().name);
    try {
      await navigator.clipboard.writeText(text);
      $('bom-copy').textContent = 'Copied';
    } catch {
      // No clipboard access (old browser or http): show the text to copy by hand
      const box = $('bom-text');
      box.value = text;
      box.hidden = false;
      box.focus();
      box.select();
      $('bom-copy').textContent = 'Select and copy';
    }
  });

  $('bom-csv').addEventListener('click', () => {
    const blob = new Blob([bomCsv(rows)], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${(getRobot().name || 'robot').replace(/[^\w-]+/g, '-').toLowerCase()}-parts.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });
}
