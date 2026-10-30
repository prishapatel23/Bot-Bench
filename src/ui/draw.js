// Canvas drawing for arenas and robots. Everything is drawn in millimetres;
// fitView() works out the transform for a given canvas.

import { chassis as chassisDefs, sensors as sensorDefs, irChannels, facingAngle } from '../engine/parts.js';
import { viewCorners, CAM_W, CAM_H } from '../engine/camera.js';
import { PAINT } from '../engine/arena.js';

export const colors = {
  mat: '#1c5a70',
  matDeep: '#154759',
  paper: '#edf1ef',
  floor: '#fbfcfb',
  ink: '#15232a',
  tape: '#1a1d1f',
  yellow: '#f3c326',
  red: '#e2484e',
  cyan: '#8bf0ff',
  green: '#3fae6a',
  wall: '#3a4a52',
};

// Dark mode keeps the board light so black tape still reads as tape; it is
// just dimmed a little so it doesn't glare against the dark mat.
const lightColors = { ...colors };
const darkColors = { ...colors, mat: '#123f4f', matDeep: '#0d303d', paper: '#16232a', floor: '#dfe5e2', wall: '#34444c' };
export function usePalette(dark) { Object.assign(colors, dark ? darkColors : lightColors); }

const calm = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };

// Keep a canvas sharp on high-DPI screens. Returns CSS size.
export function sizeCanvas(canvas) {
  const r = canvas.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = Math.max(1, Math.round(r.width * dpr));
  const h = Math.max(1, Math.round(r.height * dpr));
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  return { w: r.width, h: r.height, dpr };
}

export function fitView(canvas, worldW, worldH, pad = 24) {
  const { w, h, dpr } = sizeCanvas(canvas);
  const scale = Math.min((w - pad * 2) / worldW, (h - pad * 2) / worldH);
  return {
    scale, dpr,
    ox: (w - worldW * scale) / 2,
    oy: (h - worldH * scale) / 2,
    toWorld(px, py) { return { x: (px - this.ox) / this.scale, y: (py - this.oy) / this.scale }; },
    apply(ctx) { ctx.setTransform(dpr * scale, 0, 0, dpr * scale, dpr * this.ox, dpr * this.oy); },
  };
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

function checker(ctx, r, size = 25) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(r.x, r.y, r.w, r.h);
  ctx.clip();
  ctx.fillStyle = 'rgba(63,174,106,0.18)';
  ctx.fillRect(r.x, r.y, r.w, r.h);
  ctx.fillStyle = 'rgba(21,35,42,0.75)';
  for (let y = 0; y < r.h; y += size) {
    for (let x = ((y / size) % 2) * size; x < r.w; x += size * 2) {
      if (y < size || y >= r.h - size || x < size || x >= r.w - size * 1.01) ctx.fillRect(r.x + x, r.y + y, size, size);
    }
  }
  ctx.restore();
  ctx.strokeStyle = colors.green;
  ctx.lineWidth = 4;
  ctx.strokeRect(r.x, r.y, r.w, r.h);
}

export function drawArena(ctx, arena, opts = {}) {
  // Floor board with a faint 100 mm grid
  ctx.fillStyle = colors.floor;
  ctx.shadowColor = 'rgba(0,0,0,0.25)';
  ctx.shadowBlur = 30;
  ctx.shadowOffsetY = 8;
  roundRect(ctx, 0, 0, arena.w, arena.h, 18);
  ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.strokeStyle = 'rgba(21,35,42,0.06)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  for (let x = 100; x < arena.w; x += 100) { ctx.moveTo(x, 0); ctx.lineTo(x, arena.h); }
  for (let y = 100; y < arena.h; y += 100) { ctx.moveTo(0, y); ctx.lineTo(arena.w, y); }
  ctx.stroke();

  // Painted floor patches, later ones on top
  for (const p of arena.patches || []) {
    const paint = PAINT[p.color] || PAINT.white;
    ctx.fillStyle = paint.hex;
    ctx.beginPath();
    if (p.r) ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
    else ctx.rect(p.x, p.y, p.w, p.h);
    ctx.fill();
    if (p.color === 'white') {
      ctx.strokeStyle = 'rgba(21,35,42,0.15)';
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }

  if (arena.finish) checker(ctx, arena.finish);

  for (const c of arena.checkpoints || []) {
    ctx.setLineDash([12, 12]);
    ctx.strokeStyle = opts.checkpoints && opts.checkpoints[(arena.checkpoints || []).indexOf(c)] ? 'rgba(63,174,106,0.7)' : 'rgba(21,35,42,0.18)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(c.x, c.y, c.r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const l of arena.lines) {
    if (l.pts.length < 2) continue;
    ctx.strokeStyle = colors.tape;
    ctx.lineWidth = l.w;
    ctx.beginPath();
    ctx.moveTo(l.pts[0][0], l.pts[0][1]);
    for (let i = 1; i < l.pts.length; i++) ctx.lineTo(l.pts[i][0], l.pts[i][1]);
    ctx.stroke();
  }

  for (const w of arena.walls) {
    ctx.strokeStyle = colors.wall;
    ctx.lineWidth = w.t;
    ctx.beginPath();
    ctx.moveTo(w.a[0], w.a[1]);
    ctx.lineTo(w.b[0], w.b[1]);
    ctx.stroke();
  }
  ctx.lineCap = 'butt';

  const objects = opts.objects || arena.objects;
  for (const o of objects) drawCan(ctx, o);

  if (opts.showStart !== false && arena.start) {
    const s = arena.start;
    ctx.save();
    ctx.translate(s.x, s.y);
    ctx.rotate(s.a);
    ctx.strokeStyle = 'rgba(21,35,42,0.35)';
    ctx.setLineDash([10, 8]);
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(0, 0, 70, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(21,35,42,0.35)';
    ctx.beginPath();
    ctx.moveTo(95, 0); ctx.lineTo(75, -12); ctx.lineTo(75, 12);
    ctx.fill();
    ctx.restore();
  }
}

// The sumo opponent: a dark wedge-fronted bot pointing along o.a
function drawOpponent(ctx, o) {
  ctx.save();
  ctx.translate(o.x, o.y);
  ctx.rotate(o.a || 0);
  ctx.fillStyle = 'rgba(0,0,0,0.2)';
  ctx.beginPath(); ctx.arc(4, 6, o.r, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#5b3ea6';
  ctx.strokeStyle = 'rgba(255,255,255,0.7)';
  ctx.lineWidth = 3;
  ctx.beginPath(); ctx.arc(0, 0, o.r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#c9d1d5';
  ctx.beginPath();
  ctx.moveTo(o.r, -o.r * 0.7); ctx.lineTo(o.r * 1.12, 0); ctx.lineTo(o.r, o.r * 0.7);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = colors.cyan;
  ctx.beginPath(); ctx.arc(o.r * 0.45, -o.r * 0.28, 7, 0, Math.PI * 2); ctx.arc(o.r * 0.45, o.r * 0.28, 7, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

function drawCan(ctx, o) {
  if (o.opponent) { drawOpponent(ctx, o); return; }
  const paint = PAINT[o.color] || PAINT.red;
  ctx.save();
  ctx.translate(o.x, o.y);
  ctx.fillStyle = 'rgba(0,0,0,0.18)';
  ctx.beginPath(); ctx.arc(3, 5, o.r, 0, Math.PI * 2); ctx.fill();
  const g = ctx.createRadialGradient(-o.r * 0.3, -o.r * 0.3, 2, 0, 0, o.r);
  g.addColorStop(0, 'rgba(255,255,255,0.55)');
  g.addColorStop(0.35, paint.hex);
  g.addColorStop(1, paint.hex);
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(0, 0, o.r, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.6)';
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(0, 0, o.r * 0.62, 0, Math.PI * 2); ctx.stroke();
  ctx.restore();
}

export function drawTrail(ctx, trail, color = 'rgba(226,72,78,0.45)') {
  if (trail.length < 2) return;
  ctx.strokeStyle = color;
  ctx.lineWidth = 4;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(trail[0][0], trail[0][1]);
  for (let i = 1; i < trail.length; i++) ctx.lineTo(trail[i][0], trail[i][1]);
  ctx.stroke();
}

// The previous run's path, faint and dashed, drawn under the live trail
export function drawGhost(ctx, trail) {
  ctx.save();
  ctx.setLineDash([14, 10]);
  drawTrail(ctx, trail, 'rgba(21,35,42,0.32)');
  ctx.restore();
}

export function drawMarkers(ctx, markers, t = 0, scale = 1) {
  for (const m of markers) {
    const pulse = calm.matches ? 1 : 1 + Math.sin(t * 5) * 0.12;
    const r = (14 / scale) * pulse;
    ctx.fillStyle = m.kind === 'fail' ? colors.red : colors.yellow;
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 3 / scale;
    ctx.beginPath();
    ctx.arc(m.x, m.y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.strokeStyle = m.kind === 'fail' ? 'rgba(226,72,78,0.35)' : 'rgba(243,195,38,0.4)';
    ctx.lineWidth = 2 / scale;
    ctx.beginPath();
    ctx.arc(m.x, m.y, r * 2.1, 0, Math.PI * 2);
    ctx.stroke();
  }
}

const boardLook = {
  uno: { w: 68, h: 53, fill: '#1b6f8f' },
  nano: { w: 43, h: 18, fill: '#1b6f8f' },
  mega: { w: 101, h: 53, fill: '#1b6f8f' },
  esp32: { w: 52, h: 28, fill: '#1d1f22' },
};
const driverLook = {
  l298n: { w: 43, h: 43, fill: '#c8343a' },
  l293d: { w: 30, h: 20, fill: '#2a2d30' },
  tb6612: { w: 20, h: 20, fill: '#5b3ea6' },
};

// Draw a robot at pose. live = { ir: [0..1], servo: angle, travelL, travelR, sonar: [{mm}] }
export function drawRobot(ctx, robot, pose, live = {}) {
  const ch = chassisDefs[robot.chassis];
  ctx.save();
  ctx.translate(pose.x, pose.y);
  ctx.rotate(pose.a);

  // Camera field of view on the floor
  const cam = robot.sensors.find(s => s.type === 'camera');
  if (cam && live.camView) {
    ctx.fillStyle = live.camSeen ? 'rgba(139,240,255,0.16)' : 'rgba(226,72,78,0.12)';
    ctx.strokeStyle = live.camSeen ? 'rgba(60,160,190,0.5)' : 'rgba(226,72,78,0.4)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    viewCorners().forEach(([f, s], i) => (i ? ctx.lineTo(cam.forward + f, cam.side + s) : ctx.moveTo(cam.forward + f, cam.side + s)));
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }

  // Sonar beams under everything
  if (live.beams) {
    for (const b of live.beams) {
      const ang = facingAngle[b.facing] || 0;
      const len = Math.min(b.mm, 900);
      if (!Number.isFinite(len)) continue;
      ctx.save();
      ctx.translate(b.forward, b.side);
      ctx.rotate(ang);
      const g = ctx.createLinearGradient(0, 0, len, 0);
      g.addColorStop(0, 'rgba(139,240,255,0.35)');
      g.addColorStop(1, 'rgba(139,240,255,0.02)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(len, -len * 0.26);
      ctx.lineTo(len, len * 0.26);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  }

  // Shadow
  ctx.fillStyle = 'rgba(0,0,0,0.16)';
  ctx.beginPath();
  if (ch.shape === 'round') ctx.arc(4, 6, ch.radius, 0, Math.PI * 2);
  else ctx.roundRect(-ch.length / 2 + 4, -ch.width / 2 + 6, ch.length, ch.width, 14);
  ctx.fill();

  // Chassis plate
  ctx.fillStyle = 'rgba(232,244,248,0.92)';
  ctx.strokeStyle = 'rgba(21,35,42,0.35)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  if (ch.shape === 'round') ctx.arc(0, 0, ch.radius, 0, Math.PI * 2);
  else ctx.roundRect(-ch.length / 2, -ch.width / 2, ch.length, ch.width, 14);
  ctx.fill();
  ctx.stroke();

  // Wheels sit on top of the plate, in its cut-outs
  const wheelW = 26, wheelL = 64;
  for (const [side, travel] of [[-1, live.travelL || 0], [1, live.travelR || 0]]) {
    const y = (side * ch.track) / 2;
    ctx.fillStyle = '#23272a';
    ctx.beginPath();
    ctx.roundRect(-wheelL / 2, y - wheelW / 2, wheelL, wheelW, 6);
    ctx.fill();
    ctx.save();
    ctx.beginPath();
    ctx.rect(-wheelL / 2, y - wheelW / 2, wheelL, wheelW);
    ctx.clip();
    ctx.strokeStyle = 'rgba(255,255,255,0.14)';
    ctx.lineWidth = 3;
    const off = ((travel % 10) + 10) % 10;
    for (let x = -wheelL / 2 - 10 + off; x < wheelL / 2 + 10; x += 10) {
      ctx.beginPath(); ctx.moveTo(x, y - wheelW / 2); ctx.lineTo(x - 4, y + wheelW / 2); ctx.stroke();
    }
    ctx.restore();
    ctx.fillStyle = colors.yellow;
    ctx.fillRect(-18, y - side * (wheelW / 2 + 9) - 7, 36, 14);
  }

  // Caster
  ctx.fillStyle = '#9aa7ad';
  ctx.beginPath();
  ctx.arc(-(ch.shape === 'round' ? ch.radius : ch.length / 2) + 18, 0, 9, 0, Math.PI * 2);
  ctx.fill();

  // Battery, driver, board
  ctx.fillStyle = robot.battery === 'li2' ? '#2f6fd1' : robot.battery === 'v9' ? '#d9a21b' : '#3a3f44';
  ctx.beginPath();
  ctx.roundRect(-ch.length * 0.38, -24, 34, 48, 5);
  ctx.fill();
  const d = driverLook[robot.driver];
  ctx.fillStyle = d.fill;
  ctx.beginPath();
  ctx.roundRect(-d.w / 2 - 6, -d.h / 2, d.w, d.h, 3);
  ctx.fill();
  if (robot.driver === 'l298n') {
    ctx.fillStyle = '#222';
    ctx.fillRect(-d.w / 2 - 6 + 8, -d.h / 2 + 4, d.w - 16, 10);
  }
  const b = boardLook[robot.board];
  ctx.save();
  ctx.translate(Math.min(18, ch.length / 2 - b.w / 2 - 24), 0);
  ctx.fillStyle = b.fill;
  ctx.beginPath();
  ctx.roundRect(-b.w / 2, -b.h / 2, b.w, b.h, 4);
  ctx.fill();
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.fillRect(-b.w / 2 + 6, -b.h / 2 + 2, b.w - 12, 4);
  ctx.fillRect(-b.w / 2 + 6, b.h / 2 - 6, b.w - 12, 4);
  ctx.fillStyle = '#d9dee1';
  ctx.fillRect(-b.w / 2 + b.w * 0.35, -6, 12, 12);
  ctx.fillStyle = live.running ? colors.yellow : 'rgba(243,195,38,0.3)';
  ctx.beginPath(); ctx.arc(b.w / 2 - 8, -b.h / 2 + 12, 2.5, 0, Math.PI * 2); ctx.fill();
  ctx.restore();

  // Jumper wires from the board to the front sensors
  const wires = [colors.yellow, colors.red, '#3c7be0', '#3fae6a'];
  let wi = 0;
  for (const s of robot.sensors) {
    ctx.strokeStyle = wires[wi++ % wires.length];
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.moveTo(18, -6 + wi * 3);
    ctx.quadraticCurveTo((18 + s.forward) / 2, s.side * 0.4 + 14 - wi * 6, s.forward - 6, s.side);
    ctx.stroke();
  }

  // Sensors
  const chans = irChannels(robot);
  for (const s of robot.sensors) {
    const def = sensorDefs[s.type];
    if (def.kind === 'ir') {
      const n = def.channels;
      const span = (n - 1) * (def.spacing || 0) + 16;
      ctx.fillStyle = '#1f2a30';
      ctx.beginPath();
      ctx.roundRect(s.forward - 8, s.side - span / 2, 16, span, 3);
      ctx.fill();
    } else if (def.kind === 'sonar') {
      ctx.save();
      ctx.translate(s.forward, s.side);
      ctx.rotate(facingAngle[s.facing || 'front'] || 0);
      ctx.fillStyle = '#2462b8';
      ctx.fillRect(-8, -22, 10, 44);
      ctx.fillStyle = '#c9d1d5';
      ctx.beginPath(); ctx.arc(4, -11, 8, 0, Math.PI * 2); ctx.arc(4, 11, 8, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#58646a';
      ctx.beginPath(); ctx.arc(4, -11, 4, 0, Math.PI * 2); ctx.arc(4, 11, 4, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    } else if (def.kind === 'camera') {
      // Pixy2 on a little mast: board, lens, and the white lamp LEDs
      ctx.save();
      ctx.translate(s.forward, s.side);
      ctx.fillStyle = '#1d1f22';
      ctx.beginPath();
      ctx.roundRect(-14, -19, 28, 38, 4);
      ctx.fill();
      ctx.fillStyle = '#3a3f44';
      ctx.beginPath(); ctx.arc(2, 0, 10, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#5ab0d6';
      ctx.beginPath(); ctx.arc(3, -1, 5, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.8)';
      ctx.beginPath(); ctx.arc(5, -3, 1.6, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = live.running ? '#fff7c2' : '#8a8f93';
      ctx.fillRect(9, -16, 4, 4);
      ctx.fillRect(9, 12, 4, 4);
      ctx.restore();
    } else if (def.kind === 'gripper') {
      const angle = live.servo ?? 90;
      const open = Math.max(0, Math.min(1, (angle - 10) / 80));
      ctx.save();
      ctx.translate(s.forward - 10, s.side);
      ctx.fillStyle = '#3c7be0';
      ctx.fillRect(-10, -10, 14, 20);
      ctx.strokeStyle = '#e7ecee';
      ctx.lineWidth = 6;
      ctx.lineCap = 'round';
      for (const side of [-1, 1]) {
        ctx.save();
        ctx.translate(2, side * 8);
        ctx.rotate(side * (0.08 + open * 0.55));
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(30, 0);
        ctx.lineTo(38, -side * 8);
        ctx.stroke();
        ctx.restore();
      }
      ctx.restore();
    } else if (def.kind === 'imu') {
      ctx.fillStyle = '#2462b8';
      ctx.fillRect(s.forward - 10, s.side - 8, 20, 16);
      ctx.fillStyle = '#1d1f22';
      ctx.fillRect(s.forward - 4, s.side - 4, 8, 8);
    } else if (def.kind === 'color') {
      ctx.fillStyle = '#1d6b3a';
      ctx.fillRect(s.forward - 14, s.side - 14, 28, 28);
      ctx.fillStyle = live.running ? '#fff7c2' : '#c9d1d5';
      for (const [dx, dy] of [[-8, -8], [8, -8], [-8, 8], [8, 8]]) {
        ctx.beginPath(); ctx.arc(s.forward + dx, s.side + dy, 3, 0, Math.PI * 2); ctx.fill();
      }
    } else if (def.kind === 'encoder') {
      // Slotted discs just inside each wheel
      for (const side of [-1, 1]) {
        ctx.fillStyle = '#3a3f44';
        ctx.fillRect(-14, (side * ch.track) / 2 - side * 20 - 3, 28, 6);
      }
    }
  }
  chans.forEach((c, i) => {
    const on = live.ir ? live.ir[i] > 0.5 : false;
    ctx.fillStyle = on ? '#ff4d4d' : '#5d6a70';
    if (on) { ctx.shadowColor = '#ff4d4d'; ctx.shadowBlur = 10; }
    ctx.beginPath();
    ctx.arc(c.forward, c.side, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
  });

  ctx.restore();
}

// Live data for drawRobot from a running sim
export function liveFromSim(sim) {
  const st = sim.state;
  const grip = sim.robot.sensors.find(s => s.type === 'gripper');
  const beams = sim.robot.sensors
    .filter(s => sensorDefs[s.type].kind === 'sonar')
    .map(s => {
      const r = st.hw.sonarReads.get(s.id);
      return { facing: s.facing || 'front', forward: s.forward, side: s.side, mm: r && st.t - r.t < 0.3 ? r.mm : NaN };
    });
  return {
    ir: st.irReadings,
    servo: grip ? st.servoAngle.get(grip.id) : undefined,
    travelL: st.wheel.travelL, travelR: st.wheel.travelR,
    beams, running: st.status === 'running',
    camView: !!st.camera, camSeen: !!(st.camera && st.camera.vector),
  };
}

// What the Pixy2 sees: the 79 × 52 line-mode picture with its vector on top
export function drawCameraView(canvas, frame) {
  const ctx = canvas.getContext('2d');
  const { w, h, dpr } = sizeCanvas(canvas);
  const sx = (w * dpr) / CAM_W, sy = (h * dpr) / CAM_H;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#2b3439';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  if (!frame) return;
  ctx.fillStyle = '#d8e0dd';
  for (let v = 0; v < CAM_H; v++) {
    for (let u = 0; u < CAM_W; u++) {
      if (!frame.img[v * CAM_W + u]) ctx.fillRect(u * sx, v * sy, Math.ceil(sx), Math.ceil(sy));
    }
  }
  const vec = frame.vector;
  if (!vec) return;
  const x0 = (vec.m_x0 + 0.5) * sx, y0 = (vec.m_y0 + 0.5) * sy;
  const x1 = (vec.m_x1 + 0.5) * sx, y1 = (vec.m_y1 + 0.5) * sy;
  ctx.strokeStyle = '#f3c326';
  ctx.fillStyle = '#f3c326';
  ctx.lineWidth = 2.5 * dpr;
  ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
  const a = Math.atan2(y1 - y0, x1 - x0), k = 7 * dpr;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x1 - k * Math.cos(a - 0.5), y1 - k * Math.sin(a - 0.5));
  ctx.lineTo(x1 - k * Math.cos(a + 0.5), y1 - k * Math.sin(a + 0.5));
  ctx.fill();
}
