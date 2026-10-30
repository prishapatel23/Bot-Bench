// Pixy2-style line tracking. The camera looks down and ahead at the floor;
// we sample that patch into the 79 × 52 grid Pixy2 uses in line mode, then
// pull out the main line vector the same way the real firmware reports it:
// tail (m_x0, m_y0) near the robot, head (m_x1, m_y1) further ahead.

export const CAM_W = 79;
export const CAM_H = 52;

const NEAR = 30;    // mm ahead of the lens where the bottom row lands
const FAR = 330;    // mm ahead for the top row

// Perspective: equal rows cover more floor the further away they look
export function rowDistance(v) {
  const k = v / (CAM_H - 1);
  return 1 / (1 / FAR + (1 / NEAR - 1 / FAR) * k);
}
export function halfWidth(d) { return 40 + 0.5 * d; }

// Floor points for the four corners, for drawing the field of view
export function viewCorners() {
  return [
    [NEAR, -halfWidth(NEAR)], [FAR, -halfWidth(FAR)],
    [FAR, halfWidth(FAR)], [NEAR, halfWidth(NEAR)],
  ];
}

// toWorld(forward, side) maps robot-relative mm to arena mm
export function captureFrame(tapeAt, toWorld, cam) {
  const img = new Uint8Array(CAM_W * CAM_H);
  for (let v = 0; v < CAM_H; v++) {
    const d = rowDistance(v);
    const hw = halfWidth(d);
    for (let u = 0; u < CAM_W; u++) {
      const side = cam.side + ((u - (CAM_W - 1) / 2) / ((CAM_W - 1) / 2)) * hw;
      const p = toWorld(cam.forward + d, side);
      img[v * CAM_W + u] = tapeAt(p.x, p.y) > 0.5 ? 1 : 0;
    }
  }
  return { img, ...findVector(img) };
}

function runsInRow(img, v) {
  const runs = [];
  let start = -1;
  for (let u = 0; u <= CAM_W; u++) {
    const on = u < CAM_W && img[v * CAM_W + u];
    if (on && start < 0) start = u;
    else if (!on && start >= 0) { runs.push([start, u - 1]); start = -1; }
  }
  return runs;
}

export function findVector(img) {
  const track = [];
  let prev = null, gap = 0, intersection = false;
  for (let v = CAM_H - 1; v >= 0; v--) {
    const runs = runsInRow(img, v);
    // Tape is 20 mm wide; anything much wider than that in a row is a junction
    const tapePx = 20 / ((2 * halfWidth(rowDistance(v))) / CAM_W);
    if (runs.length >= 2 || runs.some(([a, b]) => b - a + 1 > tapePx * 2.4)) {
      if (track.length) intersection = true;
    }
    const want = prev === null ? (CAM_W - 1) / 2 : prev;
    let best = null;
    for (const [a, b] of runs) {
      const c = (a + b) / 2;
      if (best === null || Math.abs(c - want) < Math.abs(best - want)) best = c;
    }
    if (best === null || (prev !== null && Math.abs(best - prev) > 8)) {
      if (track.length && ++gap > 3) break;
      continue;
    }
    gap = 0;
    prev = best;
    track.push({ x: Math.round(best), y: v });
  }
  if (track.length < 4) return { vector: null, intersection: false };
  const tail = track[0], head = track[track.length - 1];
  return {
    vector: { m_x0: tail.x, m_y0: tail.y, m_x1: head.x, m_y1: head.y, m_index: 0, m_flags: intersection ? 2 : 0 },
    intersection,
  };
}

// Colour-signature mode (pixy.ccc). Here the camera looks straight ahead.
// Each coloured can or floor patch in view becomes one block, in the
// 316 × 208 frame Pixy2 uses for blocks, biggest first like the firmware.
export const CCC_W = 316;
export const CCC_H = 208;

const FOV_X = (60 * Math.PI) / 180;
const FOV_Y = (40 * Math.PI) / 180;
const LENS_H = 90;    // mm above the floor
const CAN_H = 110;
const MAX_RANGE = 2000;

// things: [{ f, s, r, sig, floor }] in mm relative to the lens
export function findBlocks(things) {
  const px = a => CCC_W / 2 + (a / FOV_X) * CCC_W;
  const py = a => CCC_H / 2 + (a / FOV_Y) * CCC_H;    // a > 0 is below the horizon
  const blocks = [];
  for (const t of things) {
    const d = Math.hypot(t.f, t.s);
    if (t.f < 20 || d > MAX_RANGE) continue;
    const bearing = Math.atan2(t.s, t.f);
    const half = Math.atan(t.r / d);
    const x0 = Math.max(0, px(bearing - half)), x1 = Math.min(CCC_W - 1, px(bearing + half));
    const near = Math.max(1, t.f - t.r), far = t.f + t.r;
    const top = t.floor ? Math.atan(LENS_H / far) : -Math.atan((CAN_H - LENS_H) / t.f);
    const bottom = t.floor ? Math.atan(LENS_H / near) : Math.atan(LENS_H / t.f);
    const y0 = Math.max(0, py(top)), y1 = Math.min(CCC_H - 1, py(bottom));
    if (x1 - x0 < 1 || y1 - y0 < 1) continue;
    blocks.push({
      m_signature: t.sig,
      m_x: Math.round((x0 + x1) / 2), m_y: Math.round((y0 + y1) / 2),
      m_width: Math.round(x1 - x0), m_height: Math.round(y1 - y0),
      m_angle: 0, m_index: blocks.length, m_age: 1,
    });
  }
  return blocks.sort((a, b) => b.m_width * b.m_height - a.m_width * a.m_height);
}
