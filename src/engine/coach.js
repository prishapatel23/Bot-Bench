// The coach reads the sketch and the run log and explains what went wrong,
// in the order a mentor would: things that stop it compiling, wiring and
// pin mistakes, then behaviour.

import { boards, drivers, chassis as chassisDefs, sensors as sensorDefs, irChannels, pinLabel, pinMap } from './parts.js';
import { API_NAMES } from './transpile.js';
import { exampleFor } from './examples.js';

// --- helpers ----------------------------------------------------------------

function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
    .replace(/\/\/[^\n]*/g, '')
    .replace(/"(?:[^"\\\n]|\\.)*"/g, m => '"' + ' '.repeat(Math.max(0, m.length - 2)) + '"')
    .replace(/'(?:[^'\\\n]|\\.)*'/g, m => "'" + ' '.repeat(Math.max(0, m.length - 2)) + "'");
}

function lev(a, b) {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  return dp[a.length][b.length];
}

function declaredNames(src) {
  const names = new Set();
  for (const m of src.matchAll(/\b(?:int|long|float|double|bool|boolean|byte|char|String|unsigned\s+long|unsigned\s+int|void|Servo)\s+([A-Za-z_]\w*)/g)) names.add(m[1]);
  for (const m of src.matchAll(/#define\s+([A-Za-z_]\w*)/g)) names.add(m[1]);
  return names;
}

// Names in the sketch that stand for a pin number: constants, #defines and
// variables that hold a reading of that pin.
function namesForPin(src, board, pin) {
  const names = new Set([String(pin), pinLabel(board, pin)]);
  const label = pinLabel(board, pin);
  const valueRe = `(?:${pin}|${label})`;
  for (const m of src.matchAll(new RegExp(String.raw`([A-Za-z_]\w*)\s*=\s*${valueRe}\s*;`, 'g'))) names.add(m[1]);
  for (const m of src.matchAll(new RegExp(String.raw`#define\s+([A-Za-z_]\w*)\s+${valueRe}\b`, 'g'))) names.add(m[1]);
  return names;
}

function readersOf(src, pinNames) {
  const vars = new Set();
  const alt = [...pinNames].map(n => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  for (const m of src.matchAll(new RegExp(String.raw`([A-Za-z_]\w*)\s*=\s*(?:digitalRead|analogRead)\s*\(\s*(?:${alt})\s*\)`, 'g'))) vars.add(m[1]);
  return vars;
}

function findLine(src, re) {
  const lines = src.split('\n');
  for (let i = 0; i < lines.length; i++) if (re.test(lines[i])) return i + 1;
  return null;
}

function callLine(src, fn, names) {
  const alt = [...names].map(n => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  return findLine(stripComments(src), new RegExp(String.raw`\b${fn}\s*\(\s*(?:${alt})\b`));
}

// --- static checks ----------------------------------------------------------

const TYPE_START = /^(?:static\s+|const\s+|unsigned\s+|signed\s+)*(?:void|int|long|float|double|bool|boolean|byte|char|word|String|short|size_t|u?int\d+_t)\s+[A-Za-z_]\w*\s*\(.*\)$/;

export function lint(source) {
  const out = [];
  const clean = stripComments(source);
  const lines = clean.split('\n');
  const stack = [];

  const nextLine = i => {
    for (let j = i + 1; j < lines.length; j++) if (lines[j].trim()) return lines[j].trim();
    return '';
  };

  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    const inInit = stack.length && stack[stack.length - 1] === 'init';
    for (let k = 0; k < t.length; k++) {
      if (t[k] === '{') stack.push(/=\s*$/.test(t.slice(0, k)) || (k === 0 && /=\s*$/.test(lines[i - 1] || '')) || (stack[stack.length - 1] === 'init') ? 'init' : 'block');
      else if (t[k] === '}') {
        if (!stack.length) out.push({ line: i + 1, severity: 'error', title: 'Extra closing brace', detail: 'This } has no matching {. Check the block above it.' });
        else stack.pop();
      }
    }
    if (!t || t.startsWith('#') || inInit) continue;

    const next = nextLine(i);
    const endsOk = /[{};,([:\\&|+\-*/=<>?!]$/.test(t) || /^(else|do)$/.test(t);
    const control = /^(?:}\s*)?(?:if|for|while|switch|else\s+if)\b.*\)$/.test(t) && !/^}\s*while/.test(t);
    const header = (TYPE_START.test(t) && (next.startsWith('{') || t.endsWith('{')))
      || (next.startsWith('{') && (/\)\s*(const)?$/.test(t) || /^(typedef\s+)?(struct|class|enum|union)\b/.test(t)));
    const continued = /^[.?:)\]&|+\-*/<>=]/.test(next) || /^(case|default)\b/.test(t);
    if (!endsOk && !control && !header && !continued) {
      out.push({
        line: i + 1, severity: 'error', title: 'Missing semicolon',
        detail: 'Every statement in Arduino C++ ends with ;. The compiler will complain about the next line, but the fix is at the end of this one.',
        fix: { line: i + 1, text: lines[i].replace(/\s*$/, ';') },
      });
    }

    const head = t.match(/^(?:}\s*)?(?:else\s+)?(?:if|for)\s*\(/);
    let close = -1;
    if (head) {
      for (let k = head[0].length - 1, depth = 0; k < t.length; k++) {
        if (t[k] === '(') depth++;
        else if (t[k] === ')' && --depth === 0) { close = k; break; }
      }
    }
    if (close > 0 && /^\s*;\s*$/.test(t.slice(close + 1))) {
      out.push({
        line: i + 1, severity: 'error', title: 'Semicolon right after the condition',
        detail: 'The ; ends the if/for straight away, so the block underneath always runs. Remove the ;.',
        fix: { line: i + 1, text: lines[i].replace(/\)\s*;\s*$/, ')') },
      });
    }

    const cond = t.match(/^(?:}\s*)?(?:else\s+)?(?:if|while)\s*\((.*)\)/);
    if (cond && /(^|[^=!<>+\-*/%&|])=(?!=)/.test(cond[1])) {
      out.push({
        line: i + 1, severity: 'warn', title: 'Assignment inside a condition',
        detail: 'A single = stores a value. To compare, use ==. As written, the condition is true whenever the value is not zero.',
        fix: { line: i + 1, text: lines[i].replace(/([^=!<>+\-*/%&|])=(?!=)/, '$1==') },
      });
    }
    if (/=<|=>/.test(t) && !/=>\s*\{/.test(t)) {
      out.push({ line: i + 1, severity: 'error', title: 'Comparison written backwards', detail: 'Write <= and >= with the = second.', fix: { line: i + 1, text: lines[i].replace(/=</g, '<=').replace(/=>/g, '>=') } });
    }
  }
  if (stack.length) {
    out.push({ line: lines.length, severity: 'error', title: 'Missing closing brace', detail: `There ${stack.length === 1 ? 'is one { that is' : `are ${stack.length} { that are`} never closed. Count the braces in your last function.` });
  }

  // Arduino names are case-sensitive
  const api = new Map(API_NAMES.filter(n => /^[a-z]/.test(n) && n.length > 3).map(n => [n.toLowerCase(), n]));
  const known = new Set(API_NAMES);
  lines.forEach((l, i) => {
    for (const m of l.matchAll(/\b([A-Za-z_]\w*)\s*\(/g)) {
      const want = api.get(m[1].toLowerCase());
      if (want && want !== m[1] && !known.has(m[1])) {
        out.push({ line: i + 1, severity: 'error', title: `${m[1]} should be ${want}`, detail: 'Arduino function names are case-sensitive.', fix: { line: i + 1, text: source.split('\n')[i].replace(m[1], want) } });
      }
    }
  });

  if (!/\bvoid\s+setup\s*\(/.test(clean)) {
    const wrong = clean.match(/\bvoid\s+(Setup|SETUP)\s*\(/);
    out.push({ line: wrong ? findLine(clean, /void\s+(Setup|SETUP)/) : 1, severity: 'error', title: 'No setup() function', detail: wrong ? 'Arduino looks for setup in lower case.' : 'Every sketch needs void setup() { } which runs once at power-on.' });
  }
  if (!/\bvoid\s+loop\s*\(/.test(clean)) {
    out.push({ line: 1, severity: 'error', title: 'No loop() function', detail: 'Every sketch needs void loop() { } which runs over and over.' });
  }
  return out.sort((a, b) => a.line - b.line);
}

// --- reading the run --------------------------------------------------------

function sideOf(chans, bits) {
  let left = false, right = false;
  bits.forEach((b, i) => {
    if (!b) return;
    if (chans[i].side < -4) left = true;
    else if (chans[i].side > 4) right = true;
  });
  return left && !right ? 'left' : right && !left ? 'right' : null;
}

export function diagnose({ robot, arena, source, sim, kind }) {
  const board = boards[robot.board];
  const driver = drivers[robot.driver];
  const st = sim.state;
  const r = st.result || { status: 'running' };
  const hw = st.hw;
  const findings = [];
  const add = f => findings.push({ severity: 'warn', ...f });
  const label = pin => pinLabel(board, pin);
  // How the pin is written in code: 2, not D2
  const codePin = pin => (board.id === 'esp32' || /^D\d/.test(label(pin)) ? String(pin) : label(pin));
  const pins = pinMap(robot);
  const what = pin => {
    const u = (pins.get(pin) || [])[0];
    if (!u) return null;
    return u.part === 'driver' ? `${driver.name} ${u.role}` : `${sensorDefs[u.sensor.type].name} ${u.role}`;
  };

  // 1. Code that never ran properly
  if (r.reason === 'compile' || r.reason === 'missing-entry') {
    add({ severity: 'error', line: r.line, title: 'The sketch did not compile', detail: r.message });
  }
  if (r.reason === 'runtime' || r.reason === 'frozen') {
    let detail = r.message;
    const m = r.message.match(/^"(\w+)" is used but never declared/);
    if (m) {
      const pool = [...declaredNames(source), ...API_NAMES];
      const best = pool.map(n => [n, lev(n.toLowerCase(), m[1].toLowerCase())]).sort((a, b) => a[1] - b[1])[0];
      if (best && best[1] <= 2) detail += ` Did you mean ${best[0]}?`;
      else detail += ' Declare it at the top of the sketch, for example: int ' + m[1] + ' = 0;';
    }
    const line = r.line || (m ? findLine(stripComments(source), new RegExp(String.raw`\b${m[1]}\b`)) : null);
    add({ severity: 'error', line, title: 'The sketch crashed while running', detail });
  }

  // 2. Pin and API mistakes the runtime saw
  for (const w of hw.warnings.values()) {
    const pin = w.pin;
    const names = pin !== undefined ? namesForPin(source, board, pin) : new Set();
    const k = w.key;
    if (k.startsWith('write-not-output')) {
      add({
        severity: what(pin) && what(pin).startsWith(driver.name) ? 'error' : 'warn',
        line: callLine(source, 'digitalWrite', names),
        title: `${label(pin)} was never set as an output`,
        detail: `digitalWrite() on a pin left as INPUT only switches its weak internal pull-up, which can't drive ${what(pin) || 'anything'}. Add pinMode(${[...names].find(n => /[A-Za-z]/.test(n) && !/^[AD]\d+$/.test(n)) || pin}, OUTPUT); inside setup().`,
        fix: { snippet: `pinMode(${[...names].find(n => /[A-Za-z]/.test(n) && !/^[AD]\d+$/.test(n)) || pin}, OUTPUT);`, where: 'setup' },
      });
    } else if (k.startsWith('no-pwm')) {
      const free = board.pwm.filter(p => !pins.has(p)).map(label);
      add({
        line: callLine(source, 'analogWrite', names),
        title: `${label(pin)} can't do PWM`,
        detail: `On the ${board.name}, analogWrite() only varies the speed on ${board.pwm.map(label).join(', ')}. On ${label(pin)} it is either fully on (value 128 and up) or off, so the motor jerks between stop and full speed.${free.length ? ` Free PWM pins: ${free.join(', ')}.` : ''}`,
      });
    } else if (k.startsWith('pwm-range')) {
      add({ line: callLine(source, 'analogWrite', names), title: 'PWM value out of range', detail: `analogWrite() takes 0 to 255. ${w.value} gets clipped. Use constrain(speed, 0, 255) before writing.` });
    } else if (k.startsWith('floating')) {
      const unread = irChannels(robot).filter(c => !hw.reads.has(c.pin)).map(c => `${c.role} on ${label(c.pin)}`);
      add({
        severity: 'error',
        line: callLine(source, 'digitalRead', names) || callLine(source, 'analogRead', names),
        title: `Reading ${label(pin)}, which has nothing connected`,
        detail: `An unconnected input picks up electrical noise, so it reads HIGH and LOW at random.${unread.length ? ` Your sensors are on ${unread.join(', ')}.` : ''}`,
      });
    } else if (k.startsWith('not-analog')) {
      add({ severity: 'error', line: callLine(source, 'analogRead', names), title: `${label(pin)} isn't an analog pin`, detail: `analogRead() only works on ${Object.keys(board.analog).slice(0, 8).join(', ')}. Use digitalRead() here or move the wire.` });
    } else if (k.startsWith('pulse-no-trigger')) {
      add({
        severity: 'error', line: callLine(source, 'pulseIn', names),
        title: 'pulseIn() without a trigger pulse',
        detail: 'The HC-SR04 only sends a ping after TRIG goes HIGH for 10 µs. Without it, pulseIn() sits there for its whole timeout (1 second by default) and returns 0.',
        fix: { snippet: 'digitalWrite(TRIG, LOW);\ndelayMicroseconds(2);\ndigitalWrite(TRIG, HIGH);\ndelayMicroseconds(10);\ndigitalWrite(TRIG, LOW);\nlong us = pulseIn(ECHO, HIGH, 25000);' },
      });
    } else if (k.startsWith('pulse-wrong-pin')) {
      add({ severity: 'error', line: callLine(source, 'pulseIn', names), title: `pulseIn() on ${label(pin)}`, detail: `That pin isn't an ECHO pin${what(pin) ? ` (it's ${what(pin)})` : ''}. Every call waited for the full timeout.` });
    } else if (k === 'serial-not-begun') {
      add({ line: findLine(source, /Serial\.print/), title: 'Serial.begin() is missing', detail: 'Nothing is sent until you call Serial.begin(9600); in setup().', fix: { snippet: 'Serial.begin(9600);', where: 'setup' } });
    } else if (k.startsWith('servo-pin')) {
      const g = robot.sensors.find(s => s.type === 'gripper');
      add({ severity: 'error', line: findLine(source, /\.attach\s*\(/), title: 'Servo attached to the wrong pin', detail: `The gripper servo is wired to ${g ? label(g.pins.SIG) : 'another pin'}, not ${label(pin)}.` });
    } else if (k === 'servo-not-attached') {
      add({ severity: 'error', line: findLine(source, /\.write\s*\(/), title: 'Servo used before attach()', detail: 'Call grip.attach(pin) in setup() before grip.write().' });
    } else if (k === 'pixy-no-init') {
      const ccc = /getBlocks/.test(stripComments(source));
      add({
        severity: 'error', line: findLine(stripComments(source), /getMainFeatures|getAllFeatures|getBlocks/),
        title: 'The camera was never started',
        detail: ccc
          ? 'A Pixy2 answers with an error until pixy.init() has run. Call it once in setup(), before the first pixy.ccc.getBlocks().'
          : 'A Pixy2 answers with an error until pixy.init() has run. Call it once in setup(), then pixy.changeProg("line") to switch it to line tracking.',
        fix: { snippet: ccc ? 'pixy.init();' : 'pixy.init();\npixy.changeProg("line");', where: 'setup' },
      });
    } else if (k === 'pixy-no-camera') {
      add({ severity: 'error', line: findLine(stripComments(source), /Pixy2|pixy\./), title: 'No camera on this robot', detail: w.msg });
    } else if (k === 'imu-asleep') {
      add({
        severity: 'error', line: findLine(stripComments(source), /Wire\.requestFrom|getRotation|getAcceleration|getEvent/),
        title: 'The MPU6050 is still asleep',
        detail: 'It powers up in sleep mode and reads 0 on every axis until something clears the sleep bit in register 0x6B. mpu.begin() does that for you; with plain Wire, write 0 to 0x6B once in setup().',
        fix: { snippet: 'Wire.beginTransmission(0x68);\nWire.write(0x6B);   // PWR_MGMT_1\nWire.write(0);      // wake up\nWire.endTransmission(true);', where: 'setup' },
      });
    } else if (k.startsWith('imu-')) {
      add({ severity: 'error', line: findLine(stripComments(source), /Wire\.|mpu\./), title: 'The MPU6050 did not answer', detail: w.msg });
    } else if (k === 'wire-not-begun') {
      add({ severity: 'error', line: findLine(stripComments(source), /Wire\./), title: 'Wire.begin() is missing', detail: 'I2C does nothing until Wire.begin(); has run once in setup().', fix: { snippet: 'Wire.begin();', where: 'setup' } });
    } else if (k === 'tcs-off') {
      add({
        severity: 'error', line: findLine(stripComments(source), /pulseIn\s*\(/),
        title: 'The colour sensor is switched off',
        detail: 'With S0 and S1 both LOW the TCS3200 powers down and OUT never pulses, so pulseIn() waits for its whole timeout. S0 HIGH and S1 LOW gives 20% scaling, the usual choice on an Arduino.',
        fix: { snippet: 'pinMode(S0, OUTPUT);\npinMode(S1, OUTPUT);\ndigitalWrite(S0, HIGH);\ndigitalWrite(S1, LOW);', where: 'setup' },
      });
    } else if (k.startsWith('bad-interrupt') || k.startsWith('isr-')) {
      add({ severity: 'error', line: findLine(stripComments(source), /attachInterrupt/), title: 'Interrupt problem', detail: w.msg });
    } else if (k.startsWith('bad-pin') || k.startsWith('input-only') || k.startsWith('nan-pin') || k.startsWith('newping')) {
      add({ severity: 'error', title: 'Pin problem', detail: w.msg });
    }
  }

  // 3. Motor driver never got a complete signal
  const neverSet = [...st.undriven].filter(role => robot.driverPins[role] !== 'jumper' && !hw.writes.has(robot.driverPins[role]));
  if (neverSet.length && !st.everMoved) {
    add({
      severity: 'error',
      title: `The code never sets ${neverSet.join(', ')}`,
      detail: `${driver.name} needs ${driver.roles.filter(r => r !== 'STBY').join(', ')} set before a motor turns. ${neverSet.map(r => `${r} is on ${label(robot.driverPins[r])}`).join(', ')}.`,
    });
  }
  if (st.stbyLow) {
    add({
      severity: 'error', title: 'TB6612 is asleep',
      detail: `STBY (${label(robot.driverPins.STBY)}) is LOW, so the driver ignores every other pin. Set it HIGH once in setup().`,
      fix: { snippet: `pinMode(${robot.driverPins.STBY}, OUTPUT);\ndigitalWrite(${robot.driverPins.STBY}, HIGH);`, where: 'setup' },
    });
  }
  if (st.weak > 200) {
    add({ title: 'Motor speed too low to move', detail: 'Below about 15% PWM (analogWrite under 40) a motor hums but the gearbox friction wins. Use at least 60 for slow moves.' });
  }

  // 4. Behaviour
  const chans = irChannels(robot);
  const samples = st.samples;
  const camera = robot.sensors.find(s => sensorDefs[s.type].kind === 'camera');
  const useCam = !!camera && chans.length < 2;
  const lineMap = arena.lines.length > 0 && (chans.length > 0 || !!camera);
  // Which side of the robot the line is on in a sample, from IR or the camera
  const lineSide = s => (useCam
    ? (s.cam === null || s.cam === undefined ? null : s.cam < -6 ? 'left' : s.cam > 6 ? 'right' : null)
    : sideOf(chans, s.ir));
  const blindIn = s => (useCam ? s.cam === null || s.cam === undefined : s.ir.every(b => !b));

  if (lineMap) {
    const unread = chans.filter(c => !hw.reads.has(c.pin));
    if (useCam) {
      if (!hw.cameraReads && r.reason !== 'compile' && !hw.warnings.has('pixy-no-init')) {
        add({
          severity: 'error', title: 'The camera is never read',
          detail: 'Ask the Pixy2 for the line every time round loop(): int8_t res = pixy.line.getMainFeatures(); then use pixy.line.vectors->m_x1, which goes from 0 (far left) to 78 (far right).',
          fix: { snippet: '#include <Pixy2.h>\nPixy2 pixy;\n\n// in setup()\npixy.init();\npixy.changeProg("line");\n\n// in loop()\nint8_t res = pixy.line.getMainFeatures();\nif (res & LINE_VECTOR) {\n  int error = pixy.line.vectors->m_x1 - 39;\n}' },
        });
      }
    } else if (unread.length && unread.length < chans.length) {
      add({ severity: 'warn', title: `Sensor ${unread.map(c => c.role).join(', ')} is never read`, detail: `The code never reads ${unread.map(c => label(c.pin)).join(', ')}, so the robot is blind on that side.` });
    } else if (unread.length === chans.length && r.reason !== 'compile') {
      add({ severity: 'error', title: 'The line sensors are never read', detail: `Read them with digitalRead(${chans.map(c => codePin(c.pin)).join("), digitalRead(")}). They are HIGH over the black line.` });
    }

    // Does the robot turn towards the line?
    const votes = { left: { good: 0, bad: 0 }, right: { good: 0, bad: 0 } };
    for (const s of samples) {
      const side = lineSide(s);
      if (!side) continue;
      const turn = s.dl - s.dr;           // > 0 turns right
      if (Math.abs(turn) < 0.08) continue;
      const good = side === 'right' ? turn > 0 : turn < 0;
      votes[side][good ? 'good' : 'bad']++;
    }
    const reversed = ['left', 'right'].filter(side => votes[side].bad >= 5 && votes[side].bad > votes[side].good * 1.5);
    if (reversed.length === 2 || (reversed.length === 1 && useCam)) {
      add({
        severity: 'error',
        line: findLine(stripComments(source), /\b(?:drive|analogWrite)\s*\(.*[+-]/),
        title: 'Steering is reversed',
        detail: 'Whenever the line drifts to one side, the robot turns the other way and pushes itself off. To turn towards the line on the right, the left wheel must go faster than the right. Swap the left and right speeds where you steer.',
      });
    } else if (reversed.length === 1) {
      const side = reversed[0];
      const ch = chans.find(c => (side === 'left' ? c.side < -4 : c.side > 4));
      const names = namesForPin(source, board, ch.pin);
      const readers = readersOf(source, names);
      const all = [...names, ...readers].filter(n => /[A-Za-z]/.test(n));
      const line = all.length ? findLine(stripComments(source), new RegExp(String.raw`\bif\b.*\b(?:${all.join('|')})\b`)) : null;
      add({
        severity: 'error', line,
        title: `Steering is reversed when the line is on the ${side}`,
        detail: `When the ${side} sensor sees the tape, the line is to the ${side} of the robot, so it should turn ${side}: ${side === 'left' ? 'slow or reverse the left wheel and speed up the right' : 'speed up the left wheel and slow or reverse the right'}. Your code does the opposite, which pushes the robot off the line. Swap the two wheel speeds in that branch.`,
      });
    }

    if (r.reason === 'lost-line') {
      const around = samples.filter(s => s.t > r.lostT - 0.6 && s.t <= r.lostT + 0.4);
      const speed = around.length ? around.reduce((a, s) => a + Math.abs(s.dl) + Math.abs(s.dr), 0) / (2 * around.length) : 0;
      const blind = samples.filter(s => s.t > r.lostT && s.t < r.lostT + 1 && blindIn(s));
      const straight = blind.filter(s => Math.abs(s.dl - s.dr) < 0.08 && s.dl > 0.1).length;
      const avgLoop = hw.loops ? hw.loopTime.total / hw.loops / 1000 : 0;
      const mmPerLoop = (speed * st.top * avgLoop) / 1000;
      const reasons = [];
      if (!findings.some(f => f.title.startsWith('Steering is reversed'))) {
        if (avgLoop > 25) reasons.push(`Each pass through loop() takes about ${Math.round(avgLoop)} ms, so the robot moves ${Math.round(mmPerLoop)} mm between sensor readings. The tape is only 20 mm wide. Cut long delay() calls and Serial prints.`);
        if (speed > 0.7) reasons.push(`It was going at ${Math.round(speed * 100)}% power into the curve. Lower your base speed, or steer harder the further the line is from the centre.`);
        if (blind.length > 5 && straight > blind.length * 0.6) reasons.push('Once no sensor could see the tape, the code kept driving straight. Remember which side you last saw the line on and turn that way until a sensor finds it again.');
      }
      add({
        severity: 'error',
        title: `Left the line at ${r.lostT.toFixed(1)} s`,
        detail: reasons.length ? reasons.join(' ')
          : reversed.length ? 'The red marker shows where. This is the steering problem above playing out: fix that first.'
          : 'The red marker shows where. Watch the sensor lights on the robot just before it: the line slipped past the sensors before the code turned.',
        at: { x: r.markerX, y: r.markerY },
      });
    }
  }

  if (r.reason === 'spin' || r.reason === 'stuck' || r.reason === 'idle' || r.reason === 'timeout' || r.status === 'pass') {
    const moving = samples.filter(s => Math.abs(s.dl) > 0.15 && Math.abs(s.dr) > 0.15);
    const opposite = moving.filter(s => Math.sign(s.dl) !== Math.sign(s.dr)).length;
    if (r.reason === 'spin' && moving.length && opposite > moving.length * 0.7) {
      const flipped = [robot.flipA && 'A (left)', robot.flipB && 'B (right)'].filter(Boolean);
      add({
        severity: 'error', title: 'One wheel turns backwards',
        detail: flipped.length
          ? `Motor ${flipped.join(' and ')} is wired the other way round on this robot, so "forward" in code turns it backwards. Swap its two IN pins in your drive code, or swap the motor wires.`
          : 'Your code sends one wheel forward and the other backward almost all the time, so the robot turns on the spot. Check the IN1/IN2 (or IN3/IN4) levels for each motor.',
      });
    }
  }

  const sonars = robot.sensors.filter(s => sensorDefs[s.type].kind === 'sonar');
  const walls = st.events.filter(e => e.kind === 'wall');
  const usesCm = /58|0\.034|0\.017|29\.1|\/\s*29\b|ping_cm|ping_in/.test(stripComments(source));
  if (sonars.length && /pulseIn\s*\(/.test(source) && !usesCm && r.status !== 'pass') {
    add({
      severity: 'error', line: findLine(stripComments(source), /pulseIn\s*\(/),
      title: 'pulseIn() gives microseconds, not centimetres',
      detail: 'The HC-SR04 echo lasts about 58 µs for every centimetre. A wall 10 cm away reads around 580, so a check like "distance < 15" is never true. Divide by 58 to get centimetres before comparing with your threshold.',
      fix: { snippet: 'long us = pulseIn(ECHO, HIGH, 25000);\nint cm = us / 58;' },
    });
  }
  if (sonars.length && walls.length) {
    const front = sonars.find(s => (s.facing || 'front') === 'front');
    const frontRead = front && hw.sonarReads.has(front.id);
    if (front && !frontRead) {
      add({ severity: 'error', title: 'The front distance sensor is never read', detail: `The robot hit a wall ${walls.length} time${walls.length > 1 ? 's' : ''} without measuring what is ahead.` });
    } else if (front && r.reason === 'hit-obstacle') {
      const hit = walls[0];
      const f = hit.sonar && hit.sonar.front;
      const cm = f && Number.isFinite(f.mm) ? Math.round(f.mm / 10) : null;
      add({
        severity: 'error',
        title: `Hit an obstacle at ${hit.t.toFixed(1)} s`,
        detail: cm !== null && cm < 25
          ? `The sensor saw it at ${cm} cm but the robot still ran into it. Start turning further away, around 35 cm, or slow down when the reading drops.`
          : `Just before the bump the sensor read ${cm === null ? 'nothing in range' : `${cm} cm`}: the obstacle was off to the side. The beam is only about 30° wide, so a corner that clips the edge of the robot never shows up in it. Start turning at about 35 cm, and after the way ahead looks clear keep turning a moment longer so the sides of the robot clear too.`,
        at: { x: hit.x, y: hit.y },
      });
    } else if (front) {
      const hit = walls[0];
      const f = hit.sonar && hit.sonar.front;
      const cm = f ? Math.round(f.mm / 10) : null;
      add({
        severity: r.status === 'pass' ? 'tip' : 'warn',
        title: `Hit a wall at ${hit.t.toFixed(1)} s${walls.length > 1 ? ` (${walls.length} bumps)` : ''}`,
        detail: (cm !== null && cm < 60 ? `The last front reading before the bump was ${cm} cm${f.age > 0.15 ? `, taken ${Math.round(f.age * 1000)} ms earlier` : ''}. ` : '') +
          (usesCm ? "Start turning a little further from the wall, and slow down as you get close." : ""),
        at: { x: hit.x, y: hit.y },
      });
    }
  }

  if (r.reason === 'idle' && !findings.some(f => f.severity === 'error')) {
    add({ severity: 'error', title: 'The motors never got a signal', detail: `Nothing your code wrote reached the ${driver.name}. Make sure each motor has its enable pin (${driver.pwmRoles.join(', ')}) above 40 and its two direction pins set to different levels.` });
  }
  if (r.reason === 'stuck' && !walls.length) {
    add({ severity: 'error', title: 'Stuck', detail: 'The motors are on but the robot is pinned against something. Back up and turn when the distance ahead stops changing.' });
  }
  if (r.reason === 'stuck' && walls.length) {
    add({ severity: 'error', title: 'Pushing against a wall', detail: 'The wheels kept driving into the wall. Read the distance more often and turn before it drops below about 10 cm.' });
  }
  if (r.reason === 'timeout') {
    add({ severity: 'warn', title: 'Did not finish in time', detail: kind === 'maze' ? 'The robot kept moving but never reached the exit. Keep one hand on a wall: follow the right-hand wall at a steady distance and it will lead you out.' : 'The robot was still going when the clock ran out. Check the trail to see where it wandered.' });
  }
  if (r.reason === 'out') add({ severity: 'error', title: 'Drove off the arena', detail: 'The robot left the table. That usually means the sensors stopped seeing anything and the code kept driving.' });
  if (r.reason === 'hit-obstacle' && !sonars.length) {
    add({ severity: 'error', title: `Hit an obstacle at ${r.t.toFixed(1)} s`, detail: 'This robot has no distance sensor, so it can only find obstacles by hitting them. Add an HC-SR04 facing forward.', at: { x: r.x, y: r.y } });
  }
  if (r.reason === 'parked') {
    add({ severity: 'error', title: 'Stopped moving', detail: 'For 4 seconds the robot sat still or only turned on the spot. An avoider has to keep going: when the way ahead is blocked, turn until it is clear and then drive on. If it turns back and forth, lower the distance it needs to see before it sets off again.' });
  }
  if (r.reason === 'ring-out') {
    const opp = st.objects.find(o => o.opponent);
    const ch = chassisDefs[robot.chassis];
    const pushed = opp && Math.hypot(opp.x - st.pose.x, opp.y - st.pose.y) < ch.radius + opp.r + 15;
    const edge = chans.filter(c => hw.reads.has(c.pin));
    add({
      severity: 'error', title: `Left the ring at ${r.t.toFixed(1)} s`,
      detail: pushed
        ? 'The opponent pushed your robot out. The one pushing harder along the line between the two robots wins, so face it and charge with full power (255) as soon as the sonar sees it, instead of turning or backing off while it is pressing on you.'
        : !chans.length ? 'This robot has no IR sensors pointing at the floor, so it can\'t see the white edge. Add two at the front corners.'
        : !edge.length ? `The edge sensors are never read. The ring is black and the edge is white, so digitalRead(${chans.map(c => codePin(c.pin)).join(') or digitalRead(')}) goes LOW when a sensor reaches the line.`
        : 'It drove over the white line by itself. The IR sensors are HIGH over the black ring and go LOW on the white edge. As soon as either one goes LOW, reverse first, then turn away from that side. Going slower while searching gives the robot room to stop.',
      at: { x: r.x, y: r.y },
    });
  }

  // Slow loops matter even when the run passes
  const avgLoopMs = hw.loops ? hw.loopTime.total / hw.loops / 1000 : 0;
  if (hw.serialBaud && hw.serialBaud <= 9600 && hw.serial.length > 50 && avgLoopMs > 10) {
    add({ severity: 'tip', title: 'Serial printing is slowing the loop', detail: `At ${hw.serialBaud} baud each character takes about 1 ms to send. Use Serial.begin(115200) or print less often.` });
  }
  if (driver.id === 'l298n' && robot.battery === 'aa4') {
    add({ severity: 'tip', title: 'L298N on 4 × AA', detail: 'The L298N loses about 2 V, leaving the motors 4 V. A 2-cell Li-ion pack or a TB6612 driver makes a big difference.' });
  }
  if (board.adcMax === 4095 && /\b(1023|512)\b/.test(source) && /analogRead/.test(source)) {
    add({ severity: 'tip', title: 'ESP32 readings go to 4095', detail: 'The ESP32 ADC is 12-bit. Thresholds written for an Uno (512, 1023) need multiplying by 4.' });
  }

  const order = { error: 0, warn: 1, tip: 2 };
  findings.sort((a, b) => order[a.severity] - order[b.severity]);
  const example = exampleFor(robot, kind);
  const headline = r.status === 'pass'
    ? `Finished in ${r.t.toFixed(1)} s.`
    : r.status === 'stopped' ? 'Stopped.' : r.message || '';
  return { status: r.status, headline, findings, example };
}

// Line diff for the "working version" view.
export function lineDiff(a, b) {
  const A = a.split('\n'), B = b.split('\n');
  const n = A.length, m = B.length;
  const dp = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = A[i].trim() === B[j].trim() ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const out = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (A[i].trim() === B[j].trim()) { out.push({ type: 'same', text: B[j] }); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) out.push({ type: 'del', text: A[i++] });
    else out.push({ type: 'add', text: B[j++] });
  }
  while (i < n) out.push({ type: 'del', text: A[i++] });
  while (j < m) out.push({ type: 'add', text: B[j++] });
  return out;
}
