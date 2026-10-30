// Engine checks. Run with: npm test
import assert from 'node:assert/strict';
import { createSim } from '../src/engine/sim.js';
import { presetById } from '../src/engine/arena.js';
import { defaultRobot, wiringIssues } from '../src/engine/parts.js';
import { exampleFor, starterFor } from '../src/engine/examples.js';
import { transpile } from '../src/engine/transpile.js';
import { lint, diagnose } from '../src/engine/coach.js';
import { scoreRun, challenges } from '../src/engine/score.js';
import { encodeProject, decodeProject } from '../src/studio/share.js';
import { buggySketch } from '../src/studio/tour.js';

let failed = 0;
function check(name, fn) {
  try { fn(); console.log('  ok   ' + name); }
  catch (err) { failed++; console.log('  FAIL ' + name + '\n       ' + err.message.split('\n').join('\n       ')); }
}

function run(kind, map, source, robot = defaultRobot(kind), timeLimit = 90) {
  const arena = presetById(map);
  const sim = createSim({ robot, arena, source, timeLimit });
  sim.runToEnd();
  return { sim, report: diagnose({ robot, arena, source, sim, kind }) };
}
const titles = rep => rep.findings.map(f => f.title).join(' | ');

console.log('transpiler');
check('declarations, arrays, defines, casts', () => {
  const { js } = transpile(`#define SPEED 120\nconst int pins[] = {2, 3, 4};\nint buf[3];\nunsigned long t = 0;\nfloat k = 1.5f;\nvoid setup() { int x = (int)k * 2; }\nvoid loop() {}`);
  assert.match(js, /const SPEED = 120;/);
  assert.match(js, /const pins = \[2, 3, 4\];/);
  assert.match(js, /let buf = new Array\(3\)\.fill\(0\);/);
  assert.match(js, /let t = __int\(0\);/);
  assert.match(js, /let k = 1\.5;/);
  assert.match(js, /function\* setup\(\)/);
  assert.match(js, /~~k \* 2/);
});
check('keeps line numbers', () => {
  const src = 'int a = 1;\n\nvoid helper(int v)\n{\n  a = v / 2;\n}\nvoid setup() {}\nvoid loop() { helper(3); }';
  const { js } = transpile(src);
  assert.equal(js.split('\n').length - 2, src.split('\n').length);
});
check('int division truncates, delay pauses', () => {
  const src = 'int half = 0;\nvoid setup() { Serial.begin(115200); half = 7 / 2; }\nvoid loop() { Serial.println(half); delay(1000); }';
  const sim = createSim({ robot: defaultRobot('line'), arena: presetById('blank'), source: src, timeLimit: 3.5 });
  sim.runToEnd();
  assert.equal(sim.state.hw.serial[0].text, '3');
  assert.ok(sim.state.hw.serial.length >= 3 && sim.state.hw.serial.length <= 4, 'expected one print per second, got ' + sim.state.hw.serial.length);
});
check('while(1) without delay does not hang', () => {
  const sim = createSim({ robot: defaultRobot('line'), arena: presetById('blank'), source: 'void setup() {}\nvoid loop() { while (true) { } }', timeLimit: 4 });
  sim.runToEnd();
  assert.ok(sim.state.t > 2.9);
});
check('do/while and empty wait loops', () => {
  const src = 'int n = 0;\nvoid setup() { do { n++; } while (n < 5); while (millis() < 50); }\nvoid loop() { }';
  const sim = createSim({ robot: defaultRobot('line'), arena: presetById('blank'), source: src, timeLimit: 0.2 });
  sim.runToEnd();
  assert.ok(sim.state.hw.loops > 0);
});
const serialOf = (source, timeLimit = 0.3, hw = () => {}) => {
  const sim = createSim({ robot: defaultRobot('line'), arena: presetById('blank'), source, timeLimit });
  hw(sim.state.hw);
  sim.runToEnd();
  assert.ok(!['compile', 'runtime', 'missing-entry'].includes(sim.state.result.reason), sim.state.result.message);
  return sim.state.hw.serial.map(s => s.text);
};
const once = body => `void setup() {\n  Serial.begin(115200);\n${body}\n}\nvoid loop() { }`;
check('switch with fall-through, default and char cases', () => {
  const out = serialOf(once(`
  for (int i = 0; i < 4; i++) {
    switch (i) {
      case 0: Serial.print("a");
      case 1: Serial.print("b"); break;
      case 2: { Serial.print("c"); break; }
      default: Serial.print("d");
    }
  }
  Serial.println();
  char c = 'r';
  switch (c) {
    case 'l': Serial.println("left"); break;
    case 'r': Serial.println("right"); break;
  }`));
  assert.deepEqual(out, ['abbcd', 'right']);
});
check('structs: members, arrays, brace init, copies', () => {
  const out = serialOf(`
struct Pid { float kp; float kd; int last; };
typedef struct { int x, y; } Point;
Pid pid = {1.0, 0.5, 0};
Pid wheels[2] = {
  {2.0, 0.1, 4},
  {3.0, 0.2, 6}
};
Point path[3];
float gain(Pid &p) { return p.kp * 2; }
${once(`
  pid.last = 7 / 2.0;
  wheels[1].kp += 0.5;
  path[2].x = 9;
  Pid saved = pid;
  saved.kp = 99;
  Serial.println(pid.last);
  Serial.println(wheels[1].kp);
  Serial.println(path[2].x + path[0].y);
  Serial.println(pid.kp);
  Serial.println(gain(wheels[0]));`)}`);
  assert.deepEqual(out, ['3', '3.50', '9', '1', '4']);
});
check('String class', () => {
  const out = serialOf(once(`
  String msg = "speed=" + String(12);
  msg += " ";
  msg += 'x';
  String raw = "  42 ";
  raw.trim();
  String up = "abc";
  up.toUpperCase();
  Serial.println(msg);
  Serial.println(msg.length());
  Serial.println(raw.toInt() + 1);
  Serial.println(String("2.5").toFloat() * 2);
  Serial.println(msg.indexOf('='));
  Serial.println(msg.substring(0, 5));
  Serial.println(msg.charAt(1));
  Serial.println(up.equals("ABC") ? up : "no");
  Serial.println(String(3.14159));`));
  assert.deepEqual(out, ['speed=12 x', '10', '43', '5', '5', 'speed', 'p', 'ABC', '3.14']);
});
check('millis() - start survives the 32-bit wrap', () => {
  const src = 'unsigned long start;\nvoid setup() { Serial.begin(115200); start = millis(); }\nvoid loop() {\n  if (millis() - start >= 1000) { Serial.println(millis() - start); start = millis(); }\n}';
  // start 300 ms before millis() rolls over
  const out = serialOf(src, 2.5, hw => { hw.clockOffset = (2 ** 32 - 300) * 1000; });
  assert.equal(out.length, 2, out.join(','));
  for (const t of out) assert.ok(+t >= 1000 && +t < 1010, t);
});
check('sized integer types wrap like the board', () => {
  const out = serialOf(once(`
  byte b = 250; b += 10;
  uint8_t u = 255; u = u + 1;
  int16_t s = 32767; s += 1;
  unsigned int w = 7 / 2;
  long l = 2147483647; l += 1;
  bool on = 5 > 3;
  Serial.println(b);
  Serial.println(u);
  Serial.println(s);
  Serial.println(w);
  Serial.println(l);
  Serial.println(on);`));
  assert.deepEqual(out, ['4', '0', '-32768', '3', '-2147483648', '1']);
});
check('do/while, ternary, array compound assignment, const char*, static, F()', () => {
  const out = serialOf(`
const char* names[] = {"zero", "one"};
const char *label = "count";
int tally[3];
int nextId() {
  static int calls = 0;
  calls++;
  return calls;
}
${once(`
  int n = 0;
  do { n++; } while (n < 4);
  tally[1] += 5;
  tally[1] /= 2;
  nextId();
  nextId();
  Serial.println(n > 3 ? names[1] : names[0]);
  Serial.println(tally[1]);
  Serial.print(label);
  Serial.println(nextId());
  Serial.println(F("flash"));`)}`);
  assert.deepEqual(out, ['one', '2', 'count3', 'flash']);
});

console.log('examples finish their arenas');
for (const [kind, map] of [['line', 'oval'], ['line', 'snake'], ['line', 'corners'], ['maze', 'maze'], ['grab', 'pickup']]) {
  check(`${kind} on ${map}`, () => {
    const src = exampleFor(defaultRobot(kind), kind);
    const { sim, report } = run(kind, map, src);
    assert.equal(sim.state.result.status, 'pass', sim.state.result.message + ' :: ' + titles(report));
    assert.deepEqual(lint(src).filter(f => f.severity === 'error'), []);
  });
}
check('examples adapt to other parts', () => {
  const robot = defaultRobot('line');
  robot.board = 'esp32'; robot.driver = 'tb6612'; robot.motor = 'n20';
  robot.driverPins = { PWMA: 25, AIN1: 26, AIN2: 27, BIN1: 14, BIN2: 12, PWMB: 13, STBY: 33 };
  robot.sensors = [{ id: 's1', type: 'ir-5a', forward: 70, side: 0, pins: { S1: 36, S2: 39, S3: 34, S4: 35, S5: 32 } }];
  assert.deepEqual(wiringIssues(robot).filter(i => !i.soft), []);
  const { sim } = run('line', 'snake', exampleFor(robot, 'line'), robot);
  assert.equal(sim.state.result.status, 'pass', sim.state.result.message);
});
check('two straddling sensors', () => {
  const robot = defaultRobot('line');
  robot.sensors = [
    { id: 'a', type: 'ir-single', forward: 70, side: -16, pins: { OUT: 2 } },
    { id: 'b', type: 'ir-single', forward: 70, side: 16, pins: { OUT: 3 } },
  ];
  const { sim } = run('line', 'oval', exampleFor(robot, 'line'), robot);
  assert.equal(sim.state.result.status, 'pass', sim.state.result.message);
});
check('starter code compiles', () => {
  for (const kind of ['line', 'maze', 'grab']) {
    const { sim } = run(kind, 'blank', starterFor(defaultRobot(kind), kind), defaultRobot(kind), 1);
    assert.notEqual(sim.state.result.reason, 'compile', sim.state.result.message);
  }
});

console.log('coach');
const lineDrive = `
void drive(int l, int r) {
  digitalWrite(7, l > 0); digitalWrite(8, l <= 0); analogWrite(5, abs(l));
  digitalWrite(9, r > 0); digitalWrite(10, r <= 0); analogWrite(6, abs(r));
}`;
check('reversed steering is spotted', () => {
  const src = `${lineDrive}
void setup() { for (int p = 7; p <= 10; p++) pinMode(p, OUTPUT); }
void loop() {
  int L = digitalRead(2);
  int C = digitalRead(3);
  int R = digitalRead(4);
  if (L == HIGH) {
    drive(160, -60);
  } else if (R == HIGH) {
    drive(-60, 160);
  } else {
    drive(160, 160);
  }
}`;
  const { report } = run('line', 'oval', src);
  assert.equal(report.status, 'fail');
  assert.match(titles(report), /Steering is reversed/);
  const f = report.findings.find(x => x.title.startsWith('Steering'));
  assert.ok(f.line, 'should point at a line');
});
check('missing pinMode on driver pins', () => {
  const src = `${lineDrive}\nvoid setup() { }\nvoid loop() { drive(150, 150); }`;
  const { report } = run('line', 'oval', src);
  assert.match(titles(report), /never set as an output/);
});
check('missing semicolon and = in if', () => {
  const found = lint('void setup() {\n  pinMode(5, OUTPUT)\n}\nvoid loop() {\n  int x = digitalRead(2);\n  if (x = HIGH) { }\n}');
  assert.equal(found[0].title, 'Missing semicolon');
  assert.equal(found[0].line, 2);
  assert.ok(found.some(f => f.title === 'Assignment inside a condition' && f.line === 6));
});
check('no false semicolon warnings on multi-line code', () => {
  const found = lint('const int pins[] = {\n  2, 3,\n  4\n};\nvoid setup()\n{\n  if (true)\n    pinMode(5, OUTPUT);\n  int v = 1 +\n    2;\n}\nvoid loop() {\n  do {\n  } while (false);\n  switch (1) {\n    case 1:\n      break;\n  }\n}');
  assert.deepEqual(found, []);
});
check('case typo', () => {
  assert.ok(lint('void setup() { digitalwrite(5, HIGH); }\nvoid loop() {}').some(f => f.title === 'digitalwrite should be digitalWrite'));
});
check('reading an unconnected pin', () => {
  const src = `${lineDrive}\nvoid setup() { for (int p = 7; p <= 10; p++) pinMode(p, OUTPUT); }\nvoid loop() { if (digitalRead(11) == HIGH) drive(0, 150); else drive(150, 0); }`;
  const { report } = run('line', 'oval', src);
  assert.match(titles(report), /nothing connected/);
});
check('TB6612 left asleep', () => {
  const robot = defaultRobot('maze');
  const src = exampleFor(robot, 'maze').replace(/\s*digitalWrite\(STBY, HIGH\);[^\n]*/, '');
  const { report } = run('maze', 'maze', src, robot, 6);
  assert.match(titles(report), /asleep/);
});
check('pulseIn compared as centimetres', () => {
  const robot = defaultRobot('maze');
  const src = exampleFor(robot, 'maze').replace('return us / 58;', 'return us;');
  const { report } = run('maze', 'maze', src, robot, 30);
  assert.equal(report.status, 'fail');
  assert.match(report.findings.map(f => f.detail).join(' '), /Divide by 58/);
});
check('runtime typo suggests the right name', () => {
  const src = 'int speed = 100;\nvoid setup() {}\nvoid loop() { analogWrite(5, sped); }';
  const { report } = run('line', 'oval', src);
  assert.match(report.findings[0].detail, /Did you mean speed\?/);
  assert.equal(report.findings[0].line, 3);
});
check('no semicolon warning on struct functions with the brace below', () => {
  const src = 'struct Pid\n{\n  float kp;\n};\nPid make(float a)\n{\n  Pid p = {a};\n  return p;\n}\nvoid setup() {}\nvoid loop() {}';
  assert.deepEqual(lint(src).map(f => f.title), []);
});

console.log('camera');
const camRobot = () => {
  const r = defaultRobot('line');
  r.sensors = [{ id: 'cam', type: 'camera', forward: 60, side: 0, pins: {} }];
  return r;
};
for (const map of ['oval', 'snake', 'corners']) {
  check(`Pixy2 line follower on ${map}`, () => {
    const robot = camRobot();
    const src = exampleFor(robot, 'line');
    assert.match(src, /pixy\.line\.vectors->m_x1/);
    const { sim, report } = run('line', map, src, robot);
    assert.equal(sim.state.result.status, 'pass', sim.state.result.message + ' :: ' + titles(report));
  });
}
check('camera frame sees a straight line dead ahead', () => {
  const sim = createSim({ robot: camRobot(), arena: presetById('oval'), source: exampleFor(camRobot(), 'line'), timeLimit: 0.1 });
  sim.runToEnd();
  const v = sim.state.camera.vector;
  assert.ok(v && Math.abs(v.m_x0 - 39) <= 1 && Math.abs(v.m_x1 - 39) <= 1 && v.m_y0 > v.m_y1, JSON.stringify(v));
});
check('forgetting pixy.init()', () => {
  const robot = camRobot();
  const src = exampleFor(robot, 'line').replace('  pixy.init();\n', '');
  const { report } = run('line', 'oval', src, robot);
  assert.match(titles(report), /camera was never started/);
});
check('reversed steering with a camera', () => {
  const robot = camRobot();
  const src = exampleFor(robot, 'line')
    .replace('drive(BASE_SPEED + turn, BASE_SPEED - turn);', 'drive(BASE_SPEED - turn, BASE_SPEED + turn);')
    .replace('if (lastError < 0)', 'if (lastError > 0)');
  const { report } = run('line', 'snake', src, robot);
  assert.equal(report.status, 'fail');
  assert.match(titles(report), /Steering is reversed/);
});
check('Pixy2 needs the SPI pins free', () => {
  const robot = defaultRobot('grab');
  robot.sensors.push({ id: 'cam', type: 'camera', forward: 60, side: 0, pins: {} });
  assert.ok(wiringIssues(robot).some(i => /ICSP header/.test(i.msg)));
});

console.log('scores');
const sane = s => {
  assert.equal(typeof s.passed, 'boolean');
  assert.ok(Number.isInteger(s.stars) && s.stars >= 0 && s.stars <= 3, 'stars ' + s.stars);
  assert.ok(Number.isInteger(s.collisions) && s.collisions >= 0);
  assert.ok(Number.isFinite(s.points) && s.points >= 0);
  assert.ok(s.accuracy === null || (s.accuracy >= 0 && s.accuracy <= 1), 'accuracy ' + s.accuracy);
  assert.ok(s.passed ? s.lapTime > 0 : s.lapTime === null);
};
for (const [kind, map] of [['line', 'oval'], ['line', 'snake'], ['line', 'corners'], ['maze', 'maze'], ['grab', 'pickup']]) {
  check(`example earns a star on ${map}`, () => {
    const { sim } = run(kind, map, exampleFor(defaultRobot(kind), kind));
    const s = scoreRun({ sim, arena: sim.arena, kind });
    sane(s);
    assert.ok(s.passed && s.stars >= 1, JSON.stringify(s));
    assert.ok(challenges[map], 'no challenge for ' + map);
    if (map === 'maze') assert.equal(s.accuracy, null);
    else assert.ok(s.accuracy > 0.5, 'accuracy ' + s.accuracy);
  });
}
check('a failed run scores nothing', () => {
  const { sim } = run('line', 'oval', `${lineDrive}\nvoid setup() { for (int p = 7; p <= 10; p++) pinMode(p, OUTPUT); }\nvoid loop() { drive(150, 150); }`);
  const s = scoreRun({ sim, arena: sim.arena, kind: 'line' });
  sane(s);
  assert.deepEqual([s.passed, s.stars, s.points], [false, 0, 0]);
});
check('arenas without a challenge get a plain score', () => {
  const arena = { ...presetById('snake'), id: 'my-test' };
  const robot = defaultRobot('line');
  const sim = createSim({ robot, arena, source: exampleFor(robot, 'line'), timeLimit: 90 });
  sim.runToEnd();
  const s = scoreRun({ sim, arena, kind: 'line' });
  sane(s);
  assert.equal(s.stars, 1);
  const blank = run('line', 'blank', starterFor(defaultRobot('line'), 'line'), defaultRobot('line'), 1).sim;
  sane(scoreRun({ sim: blank, arena: blank.arena, kind: 'line' }));
});

console.log('studio');
check('tour sketch fails and the coach says why', () => {
  for (const [kind, map, why] of [['line', 'oval', /Steering is reversed/], ['maze', 'maze', /wheel turns backwards/], ['grab', 'pickup', /Steering is reversed|Left the line/]]) {
    const robot = defaultRobot(kind);
    const { report } = run(kind, map, buggySketch(robot, kind), robot, 30);
    assert.equal(report.status, 'fail', kind);
    assert.match(titles(report), why);
    assert.ok(report.example, kind + ' has no working version to compare');
  }
});
// CompressionStream is async, so do the work first and check after
for (const kind of ['line', 'maze', 'grab']) {
  const robot = defaultRobot(kind);
  robot.name = 'Zoë 2';
  const p = { version: 1, kind, robot, arena: presetById('oval'), code: exampleFor(robot, kind) };
  const edited = structuredClone(p);
  edited.arena.id = 'my-test';
  edited.arena.walls.push({ t: 20, a: [0, 0], b: [500, 0] });
  const hash = await encodeProject(p);
  const back = [await decodeProject(hash), await decodeProject(await encodeProject(edited))];
  check(`share link round trip (${kind}, ${hash.length} chars)`, () => {
    assert.match(hash, /^[\w-]+$/);
    assert.ok(hash.length < 3000, 'link is long: ' + hash.length);
    assert.deepEqual(back, [p, edited]);
  });
}
const garbage = await decodeProject('bm90IGEgcHJvamVjdA').then(() => null, err => err);
check('broken share links are refused', () => assert.ok(garbage instanceof Error));

console.log('plotter and tune');
const { parsePlotLine } = await import('../src/studio/plotter.js');
const { findTunables, tuneRange, setTunable } = await import('../src/studio/tune.js');
check('plot lines: bare numbers, separators, labels', () => {
  assert.deepEqual(parsePlotLine('12'), [{ label: 'value 1', value: 12 }]);
  assert.deepEqual(parsePlotLine('1.5, 2\t-3').map(p => p.value), [1.5, 2, -3]);
  assert.deepEqual(parsePlotLine('err:-2 speed:120'), [{ label: 'err', value: -2 }, { label: 'speed', value: 120 }]);
  assert.deepEqual(parsePlotLine('err: -2'), [{ label: 'err', value: -2 }]);
  assert.deepEqual(parsePlotLine('Starting...'), []);
});
const tuneSrc = '#define KP 0.8\nconst float Kd = 2.5f;  // damping\nint baseSpeed = 150;\nconst int ENA = 5;\n/* int kp = 9; */\nvoid loop() {\n  float ki = 3;\n}\n';
check('finds gains and speeds, skips pins, comments and locals', () => {
  assert.deepEqual(findTunables(tuneSrc).map(c => c.name), ['KP', 'Kd', 'baseSpeed']);
  const names = findTunables(exampleFor(defaultRobot('line'), 'line')).map(c => c.name);
  assert.deepEqual(names, ['BASE_SPEED', 'KP', 'KD']);
});
check('slider ranges and rewriting the literal', () => {
  const [kp, kd, base] = findTunables(tuneSrc);
  assert.deepEqual(tuneRange(kp), { min: 0, max: 3.2, step: 0.01 });
  assert.deepEqual(tuneRange(base), { min: 0, max: 255, step: 1 });
  assert.match(setTunable(tuneSrc, kd, 1.234, 0.01), /const float Kd = 1\.23f;  \/\/ damping/);
  assert.match(setTunable(tuneSrc, kp, 2, 0.01), /#define KP 2\.0\n/);
  assert.match(setTunable(tuneSrc, base, 99.6), /int baseSpeed = 100;/);
});

console.log('avoider, sumo and new sensors');
for (const [kind, map] of [['avoid', 'room'], ['sumo', 'dohyo']]) {
  check(`${kind} on ${map}`, () => {
    const src = exampleFor(defaultRobot(kind), kind);
    const { sim, report } = run(kind, map, src);
    assert.equal(sim.state.result.status, 'pass', sim.state.result.message + ' :: ' + titles(report));
    assert.deepEqual(lint(src).filter(f => f.severity === 'error'), []);
    assert.deepEqual(wiringIssues(defaultRobot(kind)).filter(i => !i.soft), []);
    const starter = run(kind, 'blank', starterFor(defaultRobot(kind), kind), defaultRobot(kind), 1);
    assert.notEqual(starter.sim.state.result.reason, 'compile', starter.sim.state.result.message);
  });
}
check('sumo example pushes the opponent out', () => {
  const { sim } = run('sumo', 'dohyo', exampleFor(defaultRobot('sumo'), 'sumo'));
  assert.match(sim.state.result.message, /Pushed the opponent out/);
});
check('avoider that turns too late hits something', () => {
  const src = exampleFor(defaultRobot('avoid'), 'avoid').replace('STOP_CM = 36', 'STOP_CM = 6');
  const { report } = run('avoid', 'room', src);
  assert.equal(report.status, 'fail');
  assert.match(titles(report), /Hit an obstacle/);
});
check('sumo robot that ignores the edge leaves the ring', () => {
  const src = `${lineDrive}\nvoid setup() { for (int p = 5; p <= 10; p++) pinMode(p, OUTPUT); }\nvoid loop() { drive(-150, -150); }`;
  const { report } = run('sumo', 'dohyo', src);
  assert.match(titles(report), /Left the ring/);
  assert.match(report.findings.find(f => f.title.startsWith('Left the ring')).detail, /never read/);
});

// Serial lines from a sketch, split into numbers
function serialRun(robot, arena, src, t = 2) {
  const sim = createSim({ robot, arena, source: src, timeLimit: t });
  sim.runToEnd();
  assert.notEqual(sim.state.result.reason, 'compile', sim.state.result.message);
  assert.notEqual(sim.state.result.reason, 'runtime', sim.state.result.message);
  return { sim, rows: sim.state.hw.serial.map(l => l.text.trim().split(/\s+/).map(Number)) };
}
const withParts = (...extra) => {
  const r = defaultRobot('avoid');
  r.sensors.push(...extra);
  return r;
};
const encoders = { id: 'enc', type: 'encoder', forward: 0, side: 0, pins: { L: 2, R: 3 } };
const imu = { id: 'imu', type: 'mpu6050', forward: 0, side: 0, pins: { SDA: 18, SCL: 19 } };

check('new parts: wiring rules and pin conflicts', () => {
  assert.deepEqual(wiringIssues(withParts(encoders, imu)).filter(i => !i.soft), []);
  const bad = withParts({ ...encoders, pins: { L: 4, R: 3 } }, { ...imu, pins: { SDA: 19, SCL: 18 } });
  const msgs = wiringIssues(bad).map(i => i.msg).join(' | ');
  assert.match(msgs, /can't trigger an interrupt/);
  assert.match(msgs, /SDA and SCL are swapped/);
  const line = defaultRobot('line');
  line.sensors.push(encoders);
  assert.ok(wiringIssues(line).some(i => /D2 is wired to/.test(i.msg)), 'encoder on the IR pin should clash');
  const tcs = withParts({ id: 'c', type: 'tcs3200', forward: 70, side: 0, pins: { S0: 2, S1: 3, S2: 4, S3: 13, OUT: 12 } });
  assert.ok(wiringIssues(tcs).some(i => /D12 is wired to/.test(i.msg)));
});
check('encoders count about 20 ticks per wheel turn', () => {
  const src = `${lineDrive}
volatile long left = 0;
volatile long right = 0;
void onLeft() { left++; }
void onRight() { right++; }
void setup() {
  Serial.begin(115200);
  for (int p = 5; p <= 10; p++) pinMode(p, OUTPUT);
  attachInterrupt(digitalPinToInterrupt(2), onLeft, RISING);
  attachInterrupt(digitalPinToInterrupt(3), onRight, RISING);
}
void loop() { drive(200, 120); Serial.print(left); Serial.print(" "); Serial.println(right); delay(100); }`;
  const { sim, rows } = serialRun(withParts(encoders), presetById('blank'), src, 1.55);
  const [l, r] = rows[rows.length - 1];
  const per = Math.PI * 65 / 20;
  assert.ok(Math.abs(l - sim.state.wheel.travelL / per) < 2, `left ${l} vs ${sim.state.wheel.travelL / per}`);
  assert.ok(Math.abs(r - sim.state.wheel.travelR / per) < 2, `right ${r} vs ${sim.state.wheel.travelR / per}`);
  assert.ok(l > r && r > 10, `${l} ${r}`);
});
check('MPU6050 (Adafruit library): gyro z is the turn rate, z accel is gravity', () => {
  const src = `${lineDrive}
#include <Adafruit_MPU6050.h>
Adafruit_MPU6050 mpu;
void setup() {
  Serial.begin(115200);
  for (int p = 5; p <= 10; p++) pinMode(p, OUTPUT);
  if (!mpu.begin()) Serial.println("no mpu");
  mpu.setGyroRange(MPU6050_RANGE_500_DEG);
}
void loop() {
  drive(180, -180);
  sensors_event_t a, g, temp;
  mpu.getEvent(&a, &g, &temp);
  Serial.print(g.gyro.z, 4); Serial.print(" "); Serial.println(a.acceleration.z);
  delay(50);
}`;
  const { sim, rows } = serialRun(withParts(imu), presetById('blank'), src, 1.5);
  const [gz, az] = rows[rows.length - 1];
  const w = (sim.state.wheel.l - sim.state.wheel.r) / 132;
  assert.ok(gz < 0 && Math.abs(gz + w) < 0.1, `gyro z ${gz}, robot turning at ${w} rad/s`);
  assert.ok(Math.abs(az - 9.81) < 0.2, `accel z ${az}`);
});
check('MPU6050 over plain Wire, and the coach notices it asleep', () => {
  const sketch = wake => `${lineDrive}
#include <Wire.h>
int16_t gz = 0;
void setup() {
  Serial.begin(115200);
  for (int p = 5; p <= 10; p++) pinMode(p, OUTPUT);
  Wire.begin();
${wake ? '  Wire.beginTransmission(0x68);\n  Wire.write(0x6B);\n  Wire.write(0);\n  Wire.endTransmission(true);\n' : ''}}
void loop() {
  drive(-90, 90);   // under 250 deg/s, the default range
  Wire.beginTransmission(0x68);
  Wire.write(0x47);
  Wire.endTransmission(false);
  Wire.requestFrom(0x68, 2, true);
  gz = Wire.read() << 8 | Wire.read();
  Serial.println(gz / 131.0);
  delay(50);
}`;
  const { sim, rows } = serialRun(withParts(imu), presetById('blank'), sketch(true), 1.5);
  const dps = rows[rows.length - 1][0];
  const want = ((sim.state.wheel.r - sim.state.wheel.l) / 132) * (180 / Math.PI);
  assert.ok(dps > 100 && Math.abs(dps - want) < 6, `${dps} deg/s, want ${want}`);
  const robot = withParts(imu);
  const asleep = createSim({ robot, arena: presetById('blank'), source: sketch(false), timeLimit: 1 });
  asleep.runToEnd();
  const rep = diagnose({ robot, arena: presetById('blank'), source: sketch(false), sim: asleep, kind: 'avoid' });
  assert.match(titles(rep), /MPU6050 is still asleep/);
});
check('TCS3200 sees the colour of the patch under it', () => {
  const robot = withParts({ id: 'c', type: 'tcs3200', forward: 70, side: 0, pins: { S0: 2, S1: 3, S2: 4, S3: 13, OUT: 14 } });
  const src = `const int S0 = 2, S1 = 3, S2 = 4, S3 = 13, OUT = 14;
void setup() {
  Serial.begin(115200);
  pinMode(S0, OUTPUT); pinMode(S1, OUTPUT); pinMode(S2, OUTPUT); pinMode(S3, OUTPUT);
  pinMode(OUT, INPUT);
  digitalWrite(S0, HIGH); digitalWrite(S1, LOW);
}
int readColor(int a, int b) { digitalWrite(S2, a); digitalWrite(S3, b); return pulseIn(OUT, LOW); }
void loop() {
  int r = readColor(LOW, LOW);
  int g = readColor(HIGH, HIGH);
  int b = readColor(LOW, HIGH);
  Serial.print(r); Serial.print(" "); Serial.print(g); Serial.print(" "); Serial.println(b);
  delay(100);
}`;
  const seen = {};
  for (const color of ['red', 'green', 'blue', 'white', 'black']) {
    const arena = presetById('blank');
    arena.patches = [{ x: 370, y: 800, r: 60, color }];
    const { rows } = serialRun(robot, arena, src, 0.5);
    seen[color] = rows[rows.length - 1];
  }
  // Shorter pulse = more of that colour
  const min = ([r, g, b]) => ['red', 'green', 'blue'][[r, g, b].indexOf(Math.min(r, g, b))];
  for (const c of ['red', 'green', 'blue']) assert.equal(min(seen[c]), c, `${c}: ${seen[c]}`);
  assert.ok(seen.white.every(v => v > 15 && v < 40) && seen.black.every(v => v > 200), JSON.stringify(seen));
});
check('Pixy2 colour signatures: cans in view, hidden behind walls', () => {
  const src = `#include <Pixy2.h>
Pixy2 pixy;
void setup() { Serial.begin(115200); pixy.init(); }
void loop() {
  pixy.ccc.getBlocks();
  Serial.print(pixy.ccc.numBlocks);
  for (int i = 0; i < pixy.ccc.numBlocks; i++) {
    Serial.print(" "); Serial.print(pixy.ccc.blocks[i].m_signature);
    Serial.print(" "); Serial.print(pixy.ccc.blocks[i].m_x);
    Serial.print(" "); Serial.print(pixy.ccc.blocks[i].m_width);
  }
  Serial.println();
  delay(100);
}`;
  const arena = presetById('blank');
  arena.objects = [{ x: 860, y: 800, r: 22, color: 'green' }, { x: 860, y: 1000, r: 22 }, { x: 300, y: 500, r: 22, color: 'blue' }];
  let { rows } = serialRun(camRobot(), arena, src, 0.3);
  const [n, sig, x, w] = rows[rows.length - 1];
  assert.equal(n, 2, JSON.stringify(rows));    // the blue can is off to the left, out of view
  assert.equal(sig, 2);                        // green, straight ahead
  assert.ok(Math.abs(x - 158) <= 2 && w > 5, `x ${x} width ${w}`);
  assert.equal(rows[rows.length - 1][4], 1);   // red can off to the right
  assert.ok(rows[rows.length - 1][5] > 158 + 40);
  arena.walls = [{ t: 16, a: [600, 600], b: [600, 1100] }];
  rows = serialRun(camRobot(), arena, src, 0.3).rows;
  assert.equal(rows[rows.length - 1][0], 0, 'cans behind a wall should be hidden');
});

console.log(failed ? `\n${failed} failed` : '\nall passed');
process.exit(failed ? 1 : 0);
