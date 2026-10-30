// Tune panel: finds the gains and speeds at the top of a sketch and gives each one a slider.

const TYPES = '(?:unsigned\\s+)?(?:float|double|int|long|short|byte|word|u?int(?:8|16|32)_t)';
const NUM = '(\\d+\\.?\\d*|\\.\\d+)f?';
const DEFINE = new RegExp(`^\\s*#define\\s+(\\w+)\\s+${NUM}\\s*$`, 'd');
const DECL = new RegExp(`^\\s*(?:static\\s+)?(?:const\\s+)?(?:volatile\\s+)?(${TYPES})\\s+(\\w+)\\s*=\\s*${NUM}\\s*;\\s*$`, 'd');

const isGain = name => /^[kK]_?[pPiIdD](?:$|[_\dA-Z])|_[kK][pPiIdD]$/.test(name);
const isSpeed = name => /speed|base/i.test(name);

// Globals and #defines only. Each result knows where its number sits in the source.
export function findTunables(source) {
  // Blank out strings and comments so braces and slashes in them don't count
  const clean = source.replace(/"(?:\\.|[^"\\\n])*"|\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, m => m.replace(/[^\n]/g, ' '));
  const out = [];
  let depth = 0, at = 0;
  for (const line of clean.split('\n')) {
    const d = depth === 0 && DEFINE.exec(line);
    const m = d || (depth === 0 && DECL.exec(line));
    if (m) {
      const [type, name, n] = d ? [null, m[1], 2] : [m[1], m[2], 3];
      if ((isGain(name) || isSpeed(name)) && !out.some(c => c.name === name)) {
        out.push({
          name,
          value: +m[n],
          float: type ? /float|double/.test(type) : m[n].includes('.') || isGain(name),
          speed: isSpeed(name) && !isGain(name),
          from: at + m.indices[n][0],
          to: at + m.indices[n][1],
        });
      }
    }
    for (const ch of line) depth += ch === '{' ? 1 : ch === '}' ? -1 : 0;
    at += line.length + 1;
  }
  return out;
}

// Speeds go 0-255 like analogWrite, everything else 0 to four times what it is now
export function tuneRange(c) {
  if (c.speed) return { min: 0, max: Math.max(255, c.value), step: 1 };
  const max = c.value > 0 ? +(c.value * 4).toPrecision(6) : c.float ? 1 : 10;
  return { min: 0, max, step: c.float ? 10 ** (Math.floor(Math.log10(max)) - 2) : 1 };
}

export function formatTuned(c, v, step = tuneRange(c).step) {
  if (!c.float) return String(Math.round(v));
  const s = v.toFixed(Math.max(1, Math.ceil(-Math.log10(step)))).replace(/0+$/, '');
  return s.endsWith('.') ? s + '0' : s;
}

export function setTunable(source, c, v, step) {
  return source.slice(0, c.from) + formatTuned(c, v, step) + source.slice(c.to);
}

function row(c, onInput) {
  const r = tuneRange(c);
  const div = document.createElement('div');
  div.className = 'tune-row';
  const slider = Object.assign(document.createElement('input'), { type: 'range', id: `tune-${c.name}`, min: r.min, max: r.max, step: r.step, value: c.value });
  const num = Object.assign(document.createElement('input'), { type: 'number', min: r.min, step: 'any', value: c.value });
  num.setAttribute('aria-label', `${c.name} value`);
  slider.addEventListener('input', () => {
    num.value = slider.value;
    onInput(c.name, +slider.value, r.step);
  });
  num.addEventListener('input', () => {
    if (num.value === '' || !Number.isFinite(+num.value)) return;
    if (+num.value > +slider.max) slider.max = num.value;
    slider.value = num.value;
    onInput(c.name, +num.value, r.step);
  });
  div.append(Object.assign(document.createElement('label'), { htmlFor: slider.id, textContent: c.name }), slider, num);
  return div;
}

export function renderTune(box, rows, list, onInput) {
  box.hidden = !list.length;
  const key = list.map(c => c.name).join();
  if (rows.dataset.key !== key) {
    rows.dataset.key = key;
    rows.replaceChildren(...list.map(c => row(c, onInput)));
    return;
  }
  list.forEach((c, i) => {
    for (const input of rows.children[i].querySelectorAll('input')) if (input !== document.activeElement) input.value = c.value;
  });
}
