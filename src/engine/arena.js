// Arenas are plain data: tape lines, walls, a start pose, a finish zone and
// loose objects. Units are millimetres, y points down, angle 0 faces +x.

export const TAPE = 20;
export const WALL = 16;

// Paint for floor patches and cans. rgb is how much red, green and blue light
// the surface sends back, which is what a colour sensor measures.
export const PAINT = {
  red: { hex: '#e2484e', rgb: [0.86, 0.2, 0.2] },
  green: { hex: '#3fae6a', rgb: [0.2, 0.72, 0.36] },
  blue: { hex: '#3c7be0', rgb: [0.2, 0.42, 0.86] },
  yellow: { hex: '#f3c326', rgb: [0.95, 0.8, 0.18] },
  black: { hex: '#1a1d1f', rgb: [0.05, 0.05, 0.06] },
  white: { hex: '#fbfcfb', rgb: [0.95, 0.95, 0.95] },
};
// Pixy2 colour signatures 1-4, in this order. A can with no colour is red.
export const SIGNATURES = ['red', 'green', 'blue', 'yellow'];

function mulberry(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function arc(cx, cy, r, a0, a1, steps = 40) {
  const pts = [];
  for (let i = 0; i <= steps; i++) {
    const a = a0 + (a1 - a0) * (i / steps);
    pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
  }
  return pts;
}

function blank(over = {}) {
  return {
    id: 'blank', name: 'Empty arena', kind: 'line', mission: 'reach',
    w: 2400, h: 1600, lines: [], walls: [], objects: [], checkpoints: [],
    start: { x: 300, y: 800, a: 0 }, finish: null,
    ...over,
  };
}

function oval() {
  const pts = [
    ...arc(1800, 800, 450, Math.PI / 2, -Math.PI / 2, 48),
    ...arc(600, 800, 450, -Math.PI / 2, -Math.PI * 1.5, 48),
  ];
  pts.push(pts[0]);
  return blank({
    id: 'oval', name: 'Training oval', kind: 'line',
    blurb: 'One lap of a gentle oval. A good first test for any line follower.',
    lines: [{ w: TAPE, pts }],
    start: { x: 900, y: 1250, a: 0 },
    finish: { x: 960, y: 1170, w: 140, h: 160 },
    checkpoints: [{ x: 1200, y: 350, r: 120 }, { x: 150, y: 800, r: 120 }],
  });
}

function snake() {
  const pts = [];
  for (let x = 200; x <= 2200; x += 20) {
    const k = Math.max(0, Math.min(1, (x - 400) / 200)) * Math.max(0, Math.min(1, (2000 - x) / 200));
    pts.push([x, 800 + Math.sin((x - 400) / 230) * 380 * k]);
  }
  return blank({
    id: 'snake', name: 'S-curves', kind: 'line',
    blurb: 'Curves that switch direction. Bang-bang steering starts to wobble here.',
    lines: [{ w: TAPE, pts }],
    start: { x: 250, y: 800, a: 0 },
    finish: { x: 2100, y: 700, w: 200, h: 200 },
  });
}

function corners() {
  const pts = [[200, 1350], [800, 1350], [800, 450], [1400, 450], [1400, 1150], [2000, 1150], [2000, 250], [2250, 250]];
  return blank({
    id: 'corners', name: 'Right angles', kind: 'line',
    blurb: 'Six 90° turns. Your robot has to remember which way the line went.',
    lines: [{ w: TAPE, pts }],
    start: { x: 260, y: 1350, a: 0 },
    finish: { x: 2150, y: 150, w: 200, h: 200 },
  });
}

function maze(seed = 7, cols = 8, rows = 5, cell = 300) {
  const rand = mulberry(seed);
  // Wall flags per cell: right and bottom. DFS carves a perfect maze.
  const right = Array.from({ length: rows }, () => Array(cols).fill(true));
  const down = Array.from({ length: rows }, () => Array(cols).fill(true));
  const seen = Array.from({ length: rows }, () => Array(cols).fill(false));
  const stack = [[0, 0]];
  seen[0][0] = true;
  while (stack.length) {
    const [r, c] = stack[stack.length - 1];
    const next = [[r - 1, c], [r + 1, c], [r, c - 1], [r, c + 1]]
      .filter(([nr, nc]) => nr >= 0 && nc >= 0 && nr < rows && nc < cols && !seen[nr][nc]);
    if (!next.length) { stack.pop(); continue; }
    const [nr, nc] = next[Math.floor(rand() * next.length)];
    if (nr === r) right[r][Math.min(c, nc)] = false;
    else down[Math.min(r, nr)][c] = false;
    seen[nr][nc] = true;
    stack.push([nr, nc]);
  }
  const walls = [];
  const W = cols * cell, H = rows * cell;
  const add = (ax, ay, bx, by) => walls.push({ t: WALL, a: [ax, ay], b: [bx, by] });
  add(0, 0, W, 0); add(0, H, W, H); add(0, 0, 0, H); add(W, 0, W, H);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = c * cell, y = r * cell;
      if (c < cols - 1 && right[r][c]) add(x + cell, y, x + cell, y + cell);
      if (r < rows - 1 && down[r][c]) add(x, y + cell, x + cell, y + cell);
    }
  }
  return blank({
    id: 'maze', name: 'Classroom maze', kind: 'maze',
    blurb: 'An 8 × 5 maze with one way through. Follow a wall and you will get out.',
    w: W, h: H, walls,
    start: { x: cell / 2, y: cell / 2, a: 0 },
    finish: { x: W - cell + 30, y: H - cell + 30, w: cell - 60, h: cell - 60 },
  });
}

function pickup() {
  const pts = [];
  for (let x = 200; x <= 2250; x += 25) pts.push([x, 800 + Math.sin((x - 200) / 330) * 160]);
  const ox = 1150;
  const oy = 800 + Math.sin((ox - 200) / 330) * 160;
  return blank({
    id: 'pickup', name: 'Pick up and deliver', kind: 'grab', mission: 'deliver',
    blurb: 'Follow the line, grab the can on it, and drop it in the green zone.',
    lines: [{ w: TAPE, pts }],
    objects: [{ x: ox, y: oy, r: 22, target: true }],
    start: { x: 250, y: 800, a: 0 },
    finish: { x: 2030, y: 600, w: 300, h: 300 },
  });
}

// A closed room with boxes and short walls to steer round
function room() {
  const W = 2400, H = 1600;
  const walls = [];
  const add = (ax, ay, bx, by) => walls.push({ t: WALL, a: [ax, ay], b: [bx, by] });
  add(0, 0, W, 0); add(0, H, W, H); add(0, 0, 0, H); add(W, 0, W, H);
  const box = (x, y, s) => { add(x, y, x + s, y); add(x + s, y, x + s, y + s); add(x + s, y + s, x, y + s); add(x, y + s, x, y); };
  box(700, 300, 180); box(1500, 1050, 220); box(1750, 350, 160); box(450, 1100, 160);
  add(1100, 700, 1100, 1100);
  add(1900, 800, 2200, 800);
  return blank({
    id: 'room', name: 'Cluttered room', kind: 'avoid', mission: 'avoid',
    blurb: 'Boxes and short walls everywhere. Keep moving for 30 seconds without touching any of them.',
    walls, duration: 30,
    start: { x: 250, y: 800, a: 0 },
  });
}

// Round sumo ring: black floor with a white edge line, opponent on the far side
function dohyo() {
  const c = 900, r = 770;
  return blank({
    id: 'dohyo', name: 'Sumo ring', kind: 'sumo', mission: 'sumo',
    blurb: 'Push the other robot out of the ring, or last 30 seconds, without crossing the white line yourself.',
    w: 1800, h: 1800,
    patches: [{ x: c, y: c, r, color: 'white' }, { x: c, y: c, r: r - 40, color: 'black' }],
    ring: { x: c, y: c, r },
    objects: [{ x: c + 330, y: c - 120, r: 75, opponent: true, a: Math.PI }],
    duration: 30,
    start: { x: c - 350, y: c, a: 0 },
  });
}

export const presets = [oval(), snake(), corners(), maze(), pickup(), room(), dohyo(), blank()];

export function presetById(id) {
  const p = presets.find(a => a.id === id);
  return p ? structuredClone(p) : null;
}

// --- geometry ---------------------------------------------------------------

function segDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const cx = ax + dx * t, cy = ay + dy * t;
  return { d: Math.hypot(px - cx, py - cy), cx, cy };
}

const CELL = 40;

// Prepares an arena for fast queries. Objects are copied because the
// simulation moves them.
export function compileArena(arena) {
  const segs = [];
  for (const line of arena.lines) {
    for (let i = 1; i < line.pts.length; i++) {
      const [ax, ay] = line.pts[i - 1], [bx, by] = line.pts[i];
      segs.push({ ax, ay, bx, by, hw: line.w / 2 });
    }
  }
  const cols = Math.ceil(arena.w / CELL) + 1;
  const rows = Math.ceil(arena.h / CELL) + 1;
  const grid = new Map();
  for (const s of segs) {
    const pad = s.hw + 8;
    const c0 = Math.max(0, Math.floor((Math.min(s.ax, s.bx) - pad) / CELL));
    const c1 = Math.min(cols, Math.floor((Math.max(s.ax, s.bx) + pad) / CELL));
    const r0 = Math.max(0, Math.floor((Math.min(s.ay, s.by) - pad) / CELL));
    const r1 = Math.min(rows, Math.floor((Math.max(s.ay, s.by) + pad) / CELL));
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const k = r * cols + c;
        if (!grid.has(k)) grid.set(k, []);
        grid.get(k).push(s);
      }
    }
  }
  const walls = arena.walls.map(w => ({ ax: w.a[0], ay: w.a[1], bx: w.b[0], by: w.b[1], r: w.t / 2 }));
  const objects = arena.objects.map(o => ({ ...o, held: false }));

  // 0 = white floor, 1 = fully on tape. Sensor spot is about 8 mm wide.
  function tapeAt(x, y) {
    const list = grid.get(Math.floor(y / CELL) * cols + Math.floor(x / CELL));
    if (!list) return 0;
    let best = 0;
    for (const s of list) {
      const { d } = segDist(x, y, s.ax, s.ay, s.bx, s.by);
      const v = (s.hw + 4 - d) / 8;
      if (v > best) best = v >= 1 ? 1 : v;
    }
    return best;
  }

  // Colour of the floor as [r, g, b]: tape, then the top patch, then plain board
  const patches = arena.patches || [];
  function floorColor(x, y) {
    if (tapeAt(x, y) > 0.5) return PAINT.black.rgb;
    for (let i = patches.length - 1; i >= 0; i--) {
      const p = patches[i];
      const inside = p.w !== undefined ? inRect(p, x, y) : Math.hypot(x - p.x, y - p.y) <= p.r;
      if (inside) return (PAINT[p.color] || PAINT.white).rgb;
    }
    return PAINT.white.rgb;
  }

  function lineDistance(x, y) {
    let best = Infinity;
    for (const s of segs) {
      const { d } = segDist(x, y, s.ax, s.ay, s.bx, s.by);
      if (d < best) best = d;
    }
    return best;
  }

  function wallSdf(x, y, withObjects = true) {
    let best = Infinity;
    for (const w of walls) {
      const d = segDist(x, y, w.ax, w.ay, w.bx, w.by).d - w.r;
      if (d < best) best = d;
    }
    if (withObjects) {
      for (const o of objects) {
        if (o.held) continue;
        const d = Math.hypot(x - o.x, y - o.y) - o.r;
        if (d < best) best = d;
      }
    }
    return best;
  }

  function raycast(x, y, ang, max, withObjects = true) {
    const dx = Math.cos(ang), dy = Math.sin(ang);
    let t = 0;
    for (let i = 0; i < 160 && t < max; i++) {
      const d = wallSdf(x + dx * t, y + dy * t, withObjects);
      if (d < 1) return t;
      t += d;
    }
    return Infinity;
  }

  // Push a circle out of walls. Returns true if it touched one.
  function resolveCircle(p, radius) {
    let hit = false;
    for (let pass = 0; pass < 2; pass++) {
      for (const w of walls) {
        const { d, cx, cy } = segDist(p.x, p.y, w.ax, w.ay, w.bx, w.by);
        const overlap = radius + w.r - d;
        if (overlap > 0) {
          hit = true;
          if (d > 1e-6) {
            p.x += ((p.x - cx) / d) * overlap;
            p.y += ((p.y - cy) / d) * overlap;
          }
        }
      }
    }
    return hit;
  }

  return { arena, segs, walls, objects, patches, tapeAt, floorColor, lineDistance, wallSdf, raycast, resolveCircle };
}

export function inRect(r, x, y) {
  return !!r && x >= r.x && y >= r.y && x <= r.x + r.w && y <= r.y + r.h;
}
