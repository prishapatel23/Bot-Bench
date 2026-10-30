// Generates a sketch that works for the robot as it is wired right now.
// The coach shows these next to the student's code.

import { boards, drivers, sensors as sensorDefs, irChannels, pinLabel, isAnalogPin, motorTopSpeed } from './parts.js';

const pinName = (board, pin) => (board.id === 'esp32' ? String(pin) : pinLabel(board, pin).replace(/^D/, ''));

function driverBlock(robot) {
  const board = boards[robot.board];
  const d = drivers[robot.driver];
  const p = robot.driverPins;
  const n = role => (p[role] === 'jumper' ? null : pinName(board, p[role]));
  const tb = d.id === 'tb6612';
  const names = tb
    ? { ENA: 'PWMA', IN1: 'AIN1', IN2: 'AIN2', IN3: 'BIN1', IN4: 'BIN2', ENB: 'PWMB' }
    : { ENA: 'ENA', IN1: 'IN1', IN2: 'IN2', IN3: 'IN3', IN4: 'IN4', ENB: 'ENB' };
  const decl = [];
  const setup = [];
  for (const key of ['ENA', 'IN1', 'IN2', 'IN3', 'IN4', 'ENB']) {
    const role = names[key];
    const pin = n(role);
    if (pin === null) continue;
    decl.push(`const int ${role} = ${pin};`);
    setup.push(`  pinMode(${role}, OUTPUT);`);
  }
  if (tb) {
    decl.push(`const int STBY = ${n('STBY')};`);
    setup.push('  pinMode(STBY, OUTPUT);', '  digitalWrite(STBY, HIGH);  // wake the driver up');
  }
  // Wires flipped on the robot? Then forward is the other way round.
  const a1 = robot.flipA ? 'LOW' : 'HIGH', a2 = robot.flipA ? 'HIGH' : 'LOW';
  const b1 = robot.flipB ? 'LOW' : 'HIGH', b2 = robot.flipB ? 'HIGH' : 'LOW';
  const en = (role, v) => (n(role) === null ? '' : `  analogWrite(${role}, ${v});\n`);
  const pwmA = names.ENA, pwmB = names.ENB;
  const fn = `// Drive both wheels. Speeds go from -255 (full reverse) to 255 (full forward).
void drive(int left, int right) {
  left = constrain(left, -255, 255);
  right = constrain(right, -255, 255);

  digitalWrite(${names.IN1}, left >= 0 ? ${a1} : ${a2});
  digitalWrite(${names.IN2}, left >= 0 ? ${a2} : ${a1});
${en(pwmA, 'abs(left)')}
  digitalWrite(${names.IN3}, right >= 0 ? ${b1} : ${b2});
  digitalWrite(${names.IN4}, right >= 0 ? ${b2} : ${b1});
${en(pwmB, 'abs(right)')}}`;
  return { decl: decl.join('\n'), setup: setup.join('\n'), fn };
}

// Pick a cruising PWM that gives roughly the same speed whatever the motor
// and battery, so the tuning below holds.
function cruise(robot, mmPerSec) {
  const top = motorTopSpeed(robot);
  return Math.max(70, Math.min(230, Math.round((mmPerSec / top) * 255)));
}

export function lineFollower(robot, opts = {}) {
  const board = boards[robot.board];
  const chans = irChannels(robot);
  if (chans.length < 2) return null;
  const analog = chans.every(c => c.signal === 'analog' && isAnalogPin(board, c.pin));
  const drv = driverBlock(robot);
  const base = cruise(robot, opts.speed || 300);
  const pins = chans.map(c => pinName(board, c.pin)).join(', ');
  const half = (chans.length - 1) / 2;
  const weights = chans.map((_, i) => Math.round((i - half) * (2 / half) * 10) / 10).join(', ');
  const threshold = Math.round(board.adcMax * 0.5);
  const kp = Math.round(base * (chans.length >= 5 ? 0.42 : 0.55));
  const kd = Math.round(kp * 1.6);
  const read = analog
    ? `    bool onLine = analogRead(SENSOR_PINS[i]) > THRESHOLD;   // high reading = black tape`
    : `    bool onLine = digitalRead(SENSOR_PINS[i]) == HIGH;      // HIGH = black tape`;

  // Two sensors usually sit either side of the tape, so "neither sees it"
  // means the robot is centred, not lost.
  if (chans.length === 2) {
    const [l, r] = chans.map(c => pinName(board, c.pin));
    const readOne = name => analog ? `analogRead(${name}) > ${threshold}` : `digitalRead(${name}) == HIGH`;
    return `// Line follower with two sensors that straddle the tape.
// Neither sees black: go straight. One sees black: turn towards it.

${drv.decl}
const int LEFT_IR = ${l};
const int RIGHT_IR = ${r};

const int SPEED = ${base};
const int TURN = ${Math.round(base * 0.9)};

${drv.fn}

void setup() {
${drv.setup}
  pinMode(LEFT_IR, INPUT);
  pinMode(RIGHT_IR, INPUT);
}

void loop() {
  bool left = ${readOne('LEFT_IR')};
  bool right = ${readOne('RIGHT_IR')};

  if (left && !right) {
    drive(-SPEED / 3, TURN);        // line is under the left sensor: turn left
  } else if (right && !left) {
    drive(TURN, -SPEED / 3);        // under the right sensor: turn right
  } else {
    drive(SPEED, SPEED);
  }
}
`;
  }

  return `// Line follower: ${chans.length} sensors, proportional steering.
// Sensors are listed left to right. Each one says whether it sees the tape,
// and the average position of the ones that do tells us how far off centre
// the line is.

${drv.decl}

const int SENSOR_PINS[] = {${pins}};
const float WEIGHTS[] = {${weights}};   // left is negative, right is positive
const int SENSOR_COUNT = ${chans.length};
${analog ? `const int THRESHOLD = ${threshold};\n` : ''}
const int BASE_SPEED = ${base};
const float KP = ${kp};     // how hard to steer per unit of error
const float KD = ${kd};     // damps the wobble on curves

float lastError = 0;

${drv.fn}

void setup() {
${drv.setup}
  for (int i = 0; i < SENSOR_COUNT; i++) {
    pinMode(SENSOR_PINS[i], INPUT);
  }
}

void loop() {
  float sum = 0;
  int seen = 0;
  for (int i = 0; i < SENSOR_COUNT; i++) {
${read}
    if (onLine) {
      sum += WEIGHTS[i];
      seen++;
    }
  }

  if (seen == 0) {
    // Lost the line: spin towards the side we last saw it on
    if (lastError < 0) drive(-BASE_SPEED / 2, BASE_SPEED);
    else drive(BASE_SPEED, -BASE_SPEED / 2);
    return;
  }

  float error = sum / seen;           // -2 (far left) .. 0 (centre) .. 2 (far right)
  float turn = KP * error + KD * (error - lastError);
  lastError = error;

  // Line to the right (error > 0): speed up the left wheel to turn right
  drive(BASE_SPEED + turn, BASE_SPEED - turn);
  delay(5);
}
`;
}

function sonarSetup(list) {
  return list.map(s => `  pinMode(${s.name}_TRIG, OUTPUT);\n  pinMode(${s.name}_ECHO, INPUT);`).join('\n');
}

const READ_CM = `// Distance in cm from an HC-SR04. 0 means nothing in range.
int readCm(int trig, int echo) {
  digitalWrite(trig, LOW);
  delayMicroseconds(2);
  digitalWrite(trig, HIGH);
  delayMicroseconds(10);
  digitalWrite(trig, LOW);
  long us = pulseIn(echo, HIGH, 25000);   // give up after 25 ms (~4 m)
  return us / 58;
}`;

function sonarsByFacing(robot) {
  const board = boards[robot.board];
  const out = {};
  for (const s of robot.sensors) {
    if (sensorDefs[s.type].kind !== 'sonar') continue;
    const facing = s.facing || 'front';
    if (out[facing]) continue;
    out[facing] = { name: facing.toUpperCase(), trig: pinName(board, s.pins.TRIG), echo: pinName(board, s.pins.ECHO) };
  }
  return out;
}

export function mazeSolver(robot) {
  const son = sonarsByFacing(robot);
  const drv = driverBlock(robot);
  const list = Object.values(son);
  const decl = list.map(s => `const int ${s.name}_TRIG = ${s.trig};\nconst int ${s.name}_ECHO = ${s.echo};`).join('\n');
  const base = cruise(robot, 230);

  if (son.front && son.right) {
    return `// Maze solver: keep a wall on the right and follow it to the exit.
// Works for any maze where the walls are all connected to the outside.

${drv.decl}
${decl}

const int BASE_SPEED = ${base};
const int WALL_CM = 9;        // how far from the right wall we want to be
const int FRONT_STOP_CM = 11; // wall ahead closer than this: turn left
const int OPEN_CM = 25;       // right side further than this: there's a gap

${drv.fn}

${READ_CM}

void setup() {
${drv.setup}
${sonarSetup(list)}
}

void loop() {
  int front = readCm(FRONT_TRIG, FRONT_ECHO);
  int right = readCm(RIGHT_TRIG, RIGHT_ECHO);
  if (front == 0) front = 400;
  if (right == 0) right = 400;

  if (front < FRONT_STOP_CM) {
    // Dead end or corner: turn left on the spot until the way is clear
    drive(-BASE_SPEED, BASE_SPEED);
    delay(40);
    return;
  }

  if (right > OPEN_CM) {
    // Opening on the right: drive past the corner, then curve into it
    drive(BASE_SPEED, 0);
    return;
  }

  // Hug the wall: steer in proportion to how far off we are
  int error = right - WALL_CM;
  int turn = constrain(error * 9, -BASE_SPEED / 2, BASE_SPEED / 2);
  drive(BASE_SPEED + turn, BASE_SPEED - turn);
}
`;
  }
  if (son.front) {
    return `// Obstacle avoider: drive until something is close, then turn away.
// With only a front sensor the robot can explore but can't follow a wall.
// Add left and right sensors to solve a maze properly.

${drv.decl}
${decl}

const int BASE_SPEED = ${base};
const int STOP_CM = 14;

${drv.fn}

${READ_CM}

void setup() {
${drv.setup}
${sonarSetup(list)}
}

void loop() {
  int front = readCm(FRONT_TRIG, FRONT_ECHO);
  if (front > 0 && front < STOP_CM) {
    drive(BASE_SPEED, -BASE_SPEED);
    delay(200 + random(300));
  } else {
    drive(BASE_SPEED, BASE_SPEED);
  }
}
`;
  }
  return null;
}

export function grabber(robot) {
  const board = boards[robot.board];
  const lf = lineFollower(robot, { speed: 220 });
  const son = sonarsByFacing(robot);
  const grip = robot.sensors.find(s => sensorDefs[s.type].kind === 'gripper');
  if (!lf || !son.front || !grip) return null;
  const gripPin = pinName(board, grip.pins.SIG);

  // Reuse the line follower and add the grab step around it
  let code = lf
    .replace(/^\/\/ Line follower:[^\n]*\n(\/\/[^\n]*\n)*/, `// Grabber: follow the line, grab the can when it's in the jaws,
// carry it along the line and let go inside the finish zone.

#include <Servo.h>
`)
    .replace('float lastError = 0;', `float lastError = 0;

const int FRONT_TRIG = ${son.front.trig};
const int FRONT_ECHO = ${son.front.echo};
const int GRIP_PIN = ${gripPin};
const int GRAB_CM = 3;

Servo grip;
bool holding = false;
unsigned long grabbedAt = 0;`)
    .replace('void setup() {\n', `${READ_CM}

void setup() {
  grip.attach(GRIP_PIN);
  grip.write(90);          // jaws open
  pinMode(FRONT_TRIG, OUTPUT);
  pinMode(FRONT_ECHO, INPUT);
`)
    .replace('void loop() {\n', `void loop() {
  if (!holding) {
    int d = readCm(FRONT_TRIG, FRONT_ECHO);
    if (d > 0 && d <= GRAB_CM) {
      drive(0, 0);
      delay(150);
      grip.write(10);       // close the jaws
      delay(400);
      holding = true;
      grabbedAt = millis();
    }
  } else if (millis() - grabbedAt > 3000) {
    // The finish zone has no tape in the middle: when the line ends, let go
    bool anyLine = false;
    for (int i = 0; i < SENSOR_COUNT; i++) {
      if (digitalRead(SENSOR_PINS[i]) == HIGH) anyLine = true;
    }
    if (!anyLine) {
      drive(0, 0);
      grip.write(90);
      delay(500);
      drive(-150, -150);
      delay(400);
      drive(0, 0);
      while (true) { delay(1000); }
    }
  }

`);
  return code;
}

// Line follower that steers by the Pixy2's line vector instead of IR sensors
export function cameraFollower(robot, opts = {}) {
  if (!robot.sensors.some(s => sensorDefs[s.type].kind === 'camera')) return null;
  const drv = driverBlock(robot);
  const base = cruise(robot, opts.speed || 320);
  const kp = (base / 30).toFixed(1);
  const kd = (base / 14).toFixed(1);
  return `// Line follower with a Pixy2 camera.
// The camera finds the line itself and reports it as a vector: the tail
// (m_x0, m_y0) is near the robot and the head (m_x1, m_y1) is further ahead.
// The picture is 79 pixels wide, so x = 39 means straight ahead.

#include <Pixy2.h>

${drv.decl}

const int CENTER_X = 39;
const int BASE_SPEED = ${base};
const float KP = ${kp};    // steering per pixel of error
const float KD = ${kd};    // damps the wobble

Pixy2 pixy;
int lastError = 0;

${drv.fn}

void setup() {
${drv.setup}
  pixy.init();
  pixy.changeProg("line");
}

void loop() {
  int8_t res = pixy.line.getMainFeatures();

  if (res <= 0 || !(res & LINE_VECTOR)) {
    // No line in view: turn towards the side we last saw it on
    if (lastError < 0) drive(-BASE_SPEED / 2, BASE_SPEED);
    else drive(BASE_SPEED, -BASE_SPEED / 2);
    return;
  }

  // Aim at the far end of the line so the robot starts turning early
  int error = pixy.line.vectors->m_x1 - CENTER_X;   // negative: line is to the left
  float turn = KP * error + KD * (error - lastError);
  lastError = error;

  drive(BASE_SPEED + turn, BASE_SPEED - turn);
}
`;
}

// Obstacle avoider for one front HC-SR04. The sonar beam is about 30° wide,
// so a box corner that would clip the side of the robot only shows up in it
// from about 35 cm away. Turn on the spot until the way ahead is clear.
export function avoider(robot) {
  const son = sonarsByFacing(robot);
  if (!son.front) return null;
  const drv = driverBlock(robot);
  const base = cruise(robot, 260);
  return `// Obstacle avoider: drive forward, and when something is close,
// turn on the spot until the way ahead is clear again.

${drv.decl}
const int FRONT_TRIG = ${son.front.trig};
const int FRONT_ECHO = ${son.front.echo};

const int BASE_SPEED = ${base};
const int TURN_SPEED = ${cruise(robot, 200)};
const int STOP_CM = 36;    // the beam only covers the robot's full width from about here
const int CLEAR_CM = 45;   // keep turning until there's this much room ahead

const int EXTRA_TURN_MS = 200;

bool turning = false;
int turnDir = 1;           // 1 turns right, -1 turns left
unsigned long clearSince = 0;

${drv.fn}

${READ_CM}

void setup() {
${drv.setup}
  pinMode(FRONT_TRIG, OUTPUT);
  pinMode(FRONT_ECHO, INPUT);
}

void loop() {
  int front = readCm(FRONT_TRIG, FRONT_ECHO);
  if (front == 0) front = 400;   // no echo: nothing in range

  if (!turning && front < STOP_CM) {
    turning = true;
    clearSince = 0;
    turnDir = random(2) == 0 ? 1 : -1;   // pick a side so it doesn't get stuck in a pattern
  }

  if (turning) {
    drive(TURN_SPEED * turnDir, -TURN_SPEED * turnDir);
    // The beam clears before the sides of the robot do, so keep turning a little longer
    if (front <= CLEAR_CM) clearSince = 0;
    else if (clearSince == 0) clearSince = millis();
    else if (millis() - clearSince > EXTRA_TURN_MS) turning = false;
  } else {
    drive(BASE_SPEED, BASE_SPEED);
  }
}
`;
}

// Sumo: two downward IR sensors at the front corners and a front sonar
export function sumoBot(robot) {
  const board = boards[robot.board];
  const son = sonarsByFacing(robot);
  const chans = irChannels(robot);
  if (!son.front || chans.length < 2) return null;
  const left = chans[0], right = chans[chans.length - 1];
  const analog = left.signal === 'analog' && isAnalogPin(board, left.pin);
  const white = name => (analog ? `analogRead(${name}) < ${Math.round(board.adcMax * 0.5)}` : `digitalRead(${name}) == LOW`);
  const drv = driverBlock(robot);
  return `// Sumo: stay inside the white line, find the other robot with the
// ultrasonic sensor and push it out of the ring.
// The ring is black, so the IR sensors only go LOW on the white edge.

${drv.decl}
const int LEFT_EDGE = ${pinName(board, left.pin)};
const int RIGHT_EDGE = ${pinName(board, right.pin)};
const int FRONT_TRIG = ${son.front.trig};
const int FRONT_ECHO = ${son.front.echo};

const int ATTACK = 255;       // push with everything
const int SEARCH = ${cruise(robot, 160)};
const int SEE_CM = 70;        // the ring is 154 cm across

${drv.fn}

${READ_CM}

void setup() {
${drv.setup}
  pinMode(LEFT_EDGE, INPUT);
  pinMode(RIGHT_EDGE, INPUT);
  pinMode(FRONT_TRIG, OUTPUT);
  pinMode(FRONT_ECHO, INPUT);
}

void loop() {
  bool leftEdge = ${white('LEFT_EDGE')};
  bool rightEdge = ${white('RIGHT_EDGE')};

  if (leftEdge || rightEdge) {
    // On the line: back off, then turn away from the side that saw it
    drive(-ATTACK, -ATTACK);
    delay(250);
    if (leftEdge) drive(SEARCH, -SEARCH);
    else drive(-SEARCH, SEARCH);
    delay(300);
    return;
  }

  int cm = readCm(FRONT_TRIG, FRONT_ECHO);
  if (cm > 0 && cm < SEE_CM) {
    drive(ATTACK, ATTACK);       // it's right in front: charge
  } else {
    drive(SEARCH, -SEARCH);      // turn on the spot until it shows up
  }
}
`;
}

export function exampleFor(robot, kind) {
  if (kind === 'maze') return mazeSolver(robot);
  if (kind === 'grab') return grabber(robot);
  if (kind === 'avoid') return avoider(robot);
  if (kind === 'sumo') return sumoBot(robot);
  if (irChannels(robot).length < 2) return cameraFollower(robot);
  return lineFollower(robot);
}

// Starter code with the robot's pins filled in and the logic left to write.
export function starterFor(robot, kind) {
  const drv = driverBlock(robot);
  const board = boards[robot.board];
  const lines = [];
  const used = new Set();
  const prefix = { encoder: 'ENC_', color: 'COLOR_' };
  for (const s of robot.sensors) {
    const def = sensorDefs[s.type];
    if (def.bus === 'i2c') { lines.push(`// ${def.name}: SDA on ${pinLabel(board, s.pins.SDA)}, SCL on ${pinLabel(board, s.pins.SCL)}. Use Wire, not pin numbers.`); continue; }
    for (const role of def.roles) {
      const pin = s.pins[role];
      if (pin === undefined) continue;
      let name = def.kind === 'sonar' ? `${(s.facing || 'front').toUpperCase()}_${role}` : def.kind === 'gripper' ? 'GRIP_PIN' : `${prefix[def.kind] || 'IR_'}${role}`;
      // Two sensors of the same type would otherwise both be IR_OUT
      for (let n = 2; used.has(name); n++) name = name.replace(/\d*$/, n);
      used.add(name);
      lines.push(`const int ${name} = ${pinName(board, pin)};   // ${def.name} ${role}`);
    }
  }
  const goals = {
    maze: 'find the way out of the maze',
    grab: 'pick up the can and drop it in the green zone',
    avoid: 'keep driving without touching any wall or box',
    sumo: 'push the other robot out of the ring without leaving it yourself',
  };
  const goal = goals[kind] || 'follow the black line to the finish';
  const hasCam = robot.sensors.some(s => sensorDefs[s.type].kind === 'camera');
  return `// ${robot.name}
// Goal: ${goal}.
${hasCam ? '\n#include <Pixy2.h>\n' : ''}
${drv.decl}
${lines.join('\n')}
${hasCam ? '\nPixy2 pixy;   // on the ICSP header\n' : ''}
${drv.fn}

void setup() {
${drv.setup}
${hasCam ? '  pixy.init();\n  pixy.changeProg("line");\n' : ''}  // set your sensor pins up here
}

void loop() {
  // read your sensors, decide, then call drive(left, right)
  drive(150, 150);
}
`;
}
