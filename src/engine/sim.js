// Physics and stepping. One Sim is one run of one sketch on one arena.

import { compileArena, inRect, SIGNATURES } from './arena.js';
import { chassis as chassisDefs, drivers, motors, sensors as sensorDefs, irChannels, facingAngle, motorTopSpeed } from './parts.js';
import { createHardware } from './runtime.js';
import { compile, errorLine } from './transpile.js';
import { captureFrame, findBlocks, CAM_W } from './camera.js';

const DT = 0.004;
const DEADBAND = 0.15;
const LOST_LINE_MM = 55;
const OPPONENT_SPEED = 260;   // mm/s, a bit under half what a TT robot manages flat out

export function createSim({ robot, arena, source, timeLimit = 60 }) {
  const world = compileArena(arena);
  const ch = chassisDefs[robot.chassis];
  const motor = motors[robot.motor];
  const driver = drivers[robot.driver];
  const top = motorTopSpeed(robot);
  const ir = irChannels(robot);
  const grippers = robot.sensors.filter(s => sensorDefs[s.type].kind === 'gripper');
  const sonars = robot.sensors.filter(s => sensorDefs[s.type].kind === 'sonar');
  const camera = robot.sensors.find(s => sensorDefs[s.type].kind === 'camera');
  // Where the robot "looks" for the line: its IR bar, or the middle of the camera view
  const lookPoint = ir.length
    ? { f: ir.reduce((s, c) => s + c.forward, 0) / ir.length, s: ir.reduce((s, c) => s + c.side, 0) / ir.length }
    : camera ? { f: camera.forward + 110, s: camera.side } : null;

  const pose = { x: arena.start.x, y: arena.start.y, a: arena.start.a };
  const wheel = { l: 0, r: 0, tl: 0, tr: 0, travelL: 0, travelR: 0 };
  const motion = { v: 0, w: 0, accel: 0 };
  const servoAngle = new Map(grippers.map(g => [g.id, 90]));
  const opponent = arena.mission === 'sumo' ? world.objects.find(o => o.opponent) : null;
  const ring = arena.ring;

  const toWorld = (f, s) => ({
    x: pose.x + f * Math.cos(pose.a) - s * Math.sin(pose.a),
    y: pose.y + f * Math.sin(pose.a) + s * Math.cos(pose.a),
  });

  const irCache = new Map();
  const worldIo = {
    irCoverage(chan) {
      const key = chan.sensor.id + chan.role;
      const c = irCache.get(key);
      if (c !== undefined) return c;
      const p = toWorld(chan.forward, chan.side);
      let v = world.tapeAt(p.x, p.y);
      // Coloured paper still reflects infrared; only dark patches look like tape
      if (world.patches.length) v = Math.max(v, 1 - Math.max(...world.floorColor(p.x, p.y)));
      irCache.set(key, v);
      return v;
    },
    floorColor(sensor) {
      const p = toWorld(sensor.forward, sensor.side);
      return world.floorColor(p.x, p.y);
    },
    // Body rates for the IMU: x forward, y left, z up, so a right turn is negative gz
    imu() {
      return { ax: motion.accel / 1000, ay: (-motion.v * motion.w) / 1000, az: 9.81, gx: 0, gy: 0, gz: -motion.w };
    },
    pixyBlocks(sensor) {
      let blocks = irCache.get('ccc');
      if (blocks) return blocks;
      const lens = toWorld(sensor.forward, sensor.side);
      const c = Math.cos(pose.a), s = Math.sin(pose.a);
      const things = [];
      const look = (x, y, r, color, floor) => {
        const sig = SIGNATURES.indexOf(color) + 1;
        if (!sig) return;
        const dx = x - lens.x, dy = y - lens.y;
        const d = Math.hypot(dx, dy);
        // Walls hide cans behind them; patches are flat on the floor and hidden less often, so skip the check
        if (!floor && world.raycast(lens.x, lens.y, Math.atan2(dy, dx), d - r, false) < d - r) return;
        things.push({ f: dx * c + dy * s, s: -dx * s + dy * c, r, sig, floor });
      };
      for (const o of world.objects) if (!o.held && !o.opponent) look(o.x, o.y, o.r, o.color || 'red', false);
      for (const p of world.patches) {
        if (p.r) look(p.x, p.y, p.r, p.color, true);
        else look(p.x + p.w / 2, p.y + p.h / 2, Math.min(p.w, p.h) / 2, p.color, true);
      }
      blocks = findBlocks(things);
      irCache.set('ccc', blocks);
      return blocks;
    },
    sonarDistance(sensor) {
      const p = toWorld(sensor.forward, sensor.side);
      const base = pose.a + (facingAngle[sensor.facing || 'front'] || 0);
      const cone = sensorDefs.hcsr04.cone;
      let best = Infinity;
      for (const off of [-cone, -cone / 2, 0, cone / 2, cone]) {
        const d = world.raycast(p.x, p.y, base + off, 4200);
        if (d < best) best = d;
      }
      return best;
    },
    cameraFrame(sensor) {
      let f = irCache.get('cam');
      if (!f) {
        f = captureFrame(world.tapeAt, toWorld, sensor);
        irCache.set('cam', f);
      }
      return f;
    },
  };

  const hw = createHardware(robot, worldIo);
  const state = {
    t: 0, status: 'running', result: null,
    pose, wheel, servoAngle, objects: world.objects,
    trail: [], samples: [], events: [], markers: [],
    checkpoints: (arena.checkpoints || []).map(() => false),
    leftFinish: !inRect(arena.finish, pose.x, pose.y),
    undriven: new Set(), stbyLow: false, weak: 0, everMoved: false, maxLineDist: 0,
    lostSince: null, lostAt: null, lastWallHit: -1, odometer: 0, contactAt: null,
    hw, top, irReadings: ir.map(() => 0),
  };

  let program = null;
  let gen = null;
  let phase = 'setup';
  let loopStart = 0;

  function fail(reason, message, extra = {}) {
    return { status: 'fail', reason, message, t: state.t, x: pose.x, y: pose.y, ...extra };
  }

  function finish(result) {
    state.status = result.status;
    state.result = result;
    if (result.status === 'fail' && result.reason !== 'compile' && result.reason !== 'missing-entry') {
      state.markers.push({ x: result.markerX ?? result.x, y: result.markerY ?? result.y, kind: 'fail', reason: result.reason, t: result.t });
    }
    return api;
  }

  function runCode(untilMicros) {
    let guard = 0;
    while (hw.clock < untilMicros) {
      let r;
      try {
        r = gen.next();
      } catch (err) {
        const line = errorLine(err, state.transpiled.headerLines);
        let msg = err.message;
        if (err instanceof RangeError && /call stack/i.test(msg)) msg = 'A function keeps calling itself and never stops (stack overflow).';
        else if (err instanceof ReferenceError) msg = msg.replace(/^(\w+) is not defined$/, '"$1" is used but never declared.');
        finish(fail('runtime', msg, { line }));
        return;
      }
      if (r.done) {
        if (phase === 'setup') phase = 'loop';
        else {
          hw.loops++;
          const took = hw.clock - loopStart;
          hw.loopTime.total += took;
          if (took > hw.loopTime.max) hw.loopTime.max = took;
        }
        hw.clock += 10;
        loopStart = hw.clock;
        gen = program.loop();
      } else if (r.value === 0) {
        hw.clock += 1;
      }
      if (++guard > 2e6) {
        finish(fail('frozen', 'The code ran for a long time without letting time pass.'));
        return;
      }
    }
  }

  function duty(side) {
    const A = side === 'A';
    const roles = driver.id === 'tb6612'
      ? (A ? ['PWMA', 'AIN1', 'AIN2'] : ['PWMB', 'BIN1', 'BIN2'])
      : (A ? ['ENA', 'IN1', 'IN2'] : ['ENB', 'IN3', 'IN4']);
    const lv = role => {
      const pin = robot.driverPins[role];
      if (pin === 'jumper') return 1;
      const v = hw.level(pin);
      if (v === null) state.undriven.add(role);
      return v;
    };
    const [e, a, b] = roles.map(lv);
    if (driver.id === 'tb6612') {
      const s = lv('STBY');
      if (!s) { state.stbyLow = true; return 0; }
    }
    if (e === null || a === null || b === null) return 0;
    return e * (a - b);
  }

  function physics() {
    irCache.clear();
    let dl = duty('A'), dr = duty('B');
    if (robot.flipA) dl = -dl;
    if (robot.flipB) dr = -dr;
    wheel.tl = dl; wheel.tr = dr;
    const eff = d => (Math.abs(d) < DEADBAND ? 0 : d * top);
    // Both wheels asked to move but neither can beat friction
    if ((dl || dr) && Math.abs(dl) < DEADBAND && Math.abs(dr) < DEADBAND) state.weak++;
    const k = 1 - Math.exp(-DT / motor.tau);
    wheel.l += (eff(dl) - wheel.l) * k;
    wheel.r += (eff(dr) - wheel.r) * k;
    wheel.travelL += wheel.l * DT;
    wheel.travelR += wheel.r * DT;
    hw.updateEncoders(wheel.travelL, wheel.travelR);
    if (Math.abs(wheel.l) + Math.abs(wheel.r) > 20) state.everMoved = true;

    const v = (wheel.l + wheel.r) / 2;
    const w = (wheel.l - wheel.r) / ch.track;
    motion.accel = (v - motion.v) / DT;
    motion.v = v;
    motion.w = w;
    state.odometer += Math.abs(v) * DT;
    pose.a += w * DT;
    pose.x += v * Math.cos(pose.a) * DT;
    pose.y += v * Math.sin(pose.a) * DT;

    if (world.resolveCircle(pose, ch.radius)) {
      if (state.t - state.lastWallHit > 0.6) {
        state.events.push({ t: state.t, kind: 'wall', x: pose.x, y: pose.y, sonar: lastSonar() });
        state.markers.push({ x: pose.x + Math.cos(pose.a) * ch.radius, y: pose.y + Math.sin(pose.a) * ch.radius, kind: 'wall', t: state.t });
      }
      state.lastWallHit = state.t;
    }

    if (opponent) pushOpponent(v);

    // Gripper servos move at about 600 degrees per second
    for (const g of grippers) {
      const target = hw.servos.has(g.id) ? hw.servos.get(g.id) : 90;
      const cur = servoAngle.get(g.id);
      const step = 600 * DT;
      servoAngle.set(g.id, Math.abs(target - cur) <= step ? target : cur + Math.sign(target - cur) * step);
    }

    const jaw = grippers.length ? toWorld(grippers[0].forward + 8, grippers[0].side) : null;
    const closed = grippers.length && servoAngle.get(grippers[0].id) <= 45;
    for (const o of world.objects) {
      if (o.opponent) continue;
      if (o.held) {
        if (!closed) { o.held = false; state.events.push({ t: state.t, kind: 'release', x: o.x, y: o.y }); }
        else { o.x = jaw.x; o.y = jaw.y; continue; }
      }
      if (jaw && closed && Math.hypot(o.x - jaw.x, o.y - jaw.y) < o.r + 10) {
        o.held = true;
        state.events.push({ t: state.t, kind: 'grab', x: o.x, y: o.y });
        continue;
      }
      const d = Math.hypot(o.x - pose.x, o.y - pose.y);
      const overlap = ch.radius + o.r - d;
      if (overlap > 0 && d > 1e-6) {
        o.x += ((o.x - pose.x) / d) * overlap;
        o.y += ((o.y - pose.y) / d) * overlap;
        world.resolveCircle(o, o.r);
      }
    }
  }

  // Scripted sumo opponent: waits a second, then turns towards the robot and
  // drives at it. Near the edge, and not touching, it heads back to the middle.
  function pushOpponent(v) {
    const o = opponent;
    if (o.a === undefined) o.a = 0;
    const touching = Math.hypot(o.x - pose.x, o.y - pose.y) < ch.radius + o.r + 5;
    let speed = 0;
    if (state.t > 1) {
      const home = ring && !touching && Math.hypot(o.x - ring.x, o.y - ring.y) > ring.r - 150;
      const want = home ? Math.atan2(ring.y - o.y, ring.x - o.x) : Math.atan2(pose.y - o.y, pose.x - o.x);
      const da = Math.atan2(Math.sin(want - o.a), Math.cos(want - o.a));
      o.a += Math.max(-2.5 * DT, Math.min(2.5 * DT, da));
      speed = Math.abs(da) < 0.6 ? OPPONENT_SPEED : 60;
    }
    const vx = Math.cos(o.a) * speed, vy = Math.sin(o.a) * speed;
    o.x += vx * DT;
    o.y += vy * DT;

    const dx = o.x - pose.x, dy = o.y - pose.y;
    const d = Math.hypot(dx, dy);
    const overlap = ch.radius + o.r - d;
    if (overlap <= 0 || d < 1e-6) return;
    const nx = dx / d, ny = dy / d;
    // Whoever is pushing harder along the line between them gives less ground
    const mine = Math.max(0, v * (Math.cos(pose.a) * nx + Math.sin(pose.a) * ny));
    const theirs = Math.max(0, -(vx * nx + vy * ny));
    const k = mine + theirs > 1 ? theirs / (mine + theirs) : 0.5;
    pose.x -= nx * overlap * k;
    pose.y -= ny * overlap * k;
    o.x += nx * overlap * (1 - k);
    o.y += ny * overlap * (1 - k);
    // Friction between the two: the harder pusher drags the other sideways too,
    // so a slightly off-centre push doesn't just slide round the opponent
    const tx = -ny, ty = nx;
    if (mine > theirs) {
      const vt = v * (Math.cos(pose.a) * tx + Math.sin(pose.a) * ty) * DT;
      o.x += tx * vt; o.y += ty * vt;
    } else {
      const vt = (vx * tx + vy * ty) * DT;
      pose.x += tx * vt; pose.y += ty * vt;
    }
    if (!state.contactAt) state.contactAt = state.t;
  }

  function lastSonar() {
    const out = {};
    for (const s of sonars) {
      const r = hw.sonarReads.get(s.id);
      out[s.facing || 'front'] = r ? { mm: r.mm, age: hw.clock / 1e6 - r.t } : null;
    }
    return out;
  }

  // History used to detect spinning and getting stuck
  const hist = [];

  function checks() {
    const { arena: a } = world;
    if (pose.x < -100 || pose.y < -100 || pose.x > a.w + 100 || pose.y > a.h + 100) {
      return fail('out', 'The robot drove off the edge of the arena.');
    }

    (a.checkpoints || []).forEach((c, i) => {
      if (!state.checkpoints[i] && Math.hypot(pose.x - c.x, pose.y - c.y) < c.r) state.checkpoints[i] = true;
    });
    const inFinish = inRect(a.finish, pose.x, pose.y);
    if (!inFinish) state.leftFinish = true;
    const allChecks = state.checkpoints.every(Boolean);
    if (a.mission === 'deliver') {
      const target = world.objects.find(o => o.target);
      if (target && !target.held && inRect(a.finish, target.x, target.y)) return { status: 'pass', t: state.t, message: 'Delivered.' };
    } else if (a.finish && inFinish && state.leftFinish && allChecks) {
      return { status: 'pass', t: state.t, message: 'Reached the finish.' };
    }

    if (a.mission === 'avoid' && state.lastWallHit >= 0) {
      const hit = state.events.find(e => e.kind === 'wall');
      return fail('hit-obstacle', 'The robot ran into an obstacle.', { x: hit.x, y: hit.y, markerX: pose.x + Math.cos(pose.a) * ch.radius, markerY: pose.y + Math.sin(pose.a) * ch.radius });
    }
    if (a.mission === 'sumo' && ring) {
      if (Math.hypot(pose.x - ring.x, pose.y - ring.y) > ring.r) return fail('ring-out', 'The robot left the ring.', { pushed: !!state.contactAt });
      if (opponent && Math.hypot(opponent.x - ring.x, opponent.y - ring.y) > ring.r) return { status: 'pass', t: state.t, message: 'Pushed the opponent out of the ring.' };
      if (a.duration && state.t >= a.duration) return { status: 'pass', t: state.t, message: `Still in the ring after ${a.duration} seconds.` };
    }
    if (a.mission === 'avoid' && a.duration && state.t >= a.duration) {
      return { status: 'pass', t: state.t, message: `Drove for ${a.duration} seconds without touching anything.` };
    }

    // Lost the line: the sensor bar is far from any tape for a full second
    if (lookPoint && world.segs.length) {
      const p = toWorld(lookPoint.f, lookPoint.s);
      // A camera robot may run beside the line on curves; it's lost once the line leaves the picture
      const lost = ir.length ? world.lineDistance(p.x, p.y) > LOST_LINE_MM : !worldIo.cameraFrame(camera).vector;
      if (lost) {
        if (state.lostSince === null) { state.lostSince = state.t; state.lostAt = { x: p.x, y: p.y, sample: state.samples[state.samples.length - 1] }; }
        else if (state.t - state.lostSince > 1.0) {
          return fail('lost-line', 'The robot lost the line and never found it again.', { markerX: state.lostAt.x, markerY: state.lostAt.y, lostT: state.lostSince });
        }
      } else {
        state.lostSince = null;
      }
    }

    hist.push({ t: state.t, x: pose.x, y: pose.y, a: pose.a, odo: state.odometer, cmd: Math.abs(wheel.tl) + Math.abs(wheel.tr) });
    while (hist.length && state.t - hist[0].t > 4) hist.shift();
    const h0 = hist[0];
    if (state.t > 3 && !state.everMoved) {
      return fail('idle', 'The robot never moved.');
    }
    // Circling while it looks for the opponent is normal in sumo
    if (h0 && state.t - h0.t > 3.9 && a.mission !== 'sumo') {
      const moved = Math.hypot(pose.x - h0.x, pose.y - h0.y);
      if (a.mission === 'avoid' && state.odometer - h0.odo < 60 && Math.abs(pose.a - h0.a) < Math.PI * 4) {
        return fail('parked', 'The robot stopped going anywhere.');
      }
      const turned = Math.abs(pose.a - h0.a);
      const recent = hist.filter(p => state.t - p.t < 2);
      const pushing = recent.every(p => p.cmd > 0.4);
      const r0 = recent[0];
      if (pushing && r0 && Math.hypot(pose.x - r0.x, pose.y - r0.y) < 15 && Math.abs(pose.a - r0.a) < 0.2) {
        return fail('stuck', 'The motors are running but the robot is not going anywhere.');
      }
      if (turned > Math.PI * 4 && moved < 150) {
        return fail('spin', 'The robot is spinning in place.');
      }
    }
    if (state.t >= timeLimit) return fail('timeout', `Time ran out after ${timeLimit} seconds.`);
    return null;
  }

  let sampleClock = 0;
  function sample() {
    state.irReadings = ir.map(c => worldIo.irCoverage(c));
    const s = {
      t: state.t, x: pose.x, y: pose.y, a: pose.a,
      dl: wheel.tl, dr: wheel.tr, vl: wheel.l, vr: wheel.r,
      ir: state.irReadings.map(v => v > 0.5),
    };
    if (camera) {
      const f = worldIo.cameraFrame(camera);
      state.camera = f;
      s.cam = f.vector ? f.vector.m_x1 - (CAM_W - 1) / 2 : null;   // < 0: line to the left
    }
    state.samples.push(s);
    if (state.samples.length > 6000) state.samples.splice(0, 1000);
    state.trail.push([pose.x, pose.y]);
    if (state.trail.length > 5000) state.trail.splice(0, 500);
  }

  function step() {
    const target = (state.t + DT) * 1e6;
    runCode(target);
    if (state.status !== 'running') return;
    physics();
    state.t += DT;
    sampleClock += DT;
    if (sampleClock >= 0.02) { sampleClock = 0; sample(); }
    const r = checks();
    if (r) finish(r);
  }

  const api = {
    state, robot, arena, world,
    // Advance by sim seconds; returns false once the run is over.
    advance(seconds) {
      const n = Math.round(seconds / DT);
      for (let i = 0; i < n && state.status === 'running'; i++) step();
      return state.status === 'running';
    },
    runToEnd() {
      while (state.status === 'running') step();
      return state.result;
    },
    stop() {
      if (state.status === 'running') finish({ status: 'stopped', t: state.t, message: 'Stopped.' });
    },
    toWorld,
  };
  sample();
  try {
    const out = compile(source, hw.api);
    program = out.program;
    state.transpiled = out;
    if (!program.setup || !program.loop) {
      return finish(fail('missing-entry', !program.setup ? 'Your sketch has no setup() function.' : 'Your sketch has no loop() function.'));
    }
  } catch (err) {
    return finish(fail('compile', err.message, { line: err.line ?? null }));
  }
  gen = program.setup();
  return api;
}
