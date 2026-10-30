// The Arduino API as the sketch sees it. Time is virtual and measured in
// microseconds; each call costs roughly what it costs on an ATmega328.

import { boards, motors, sensors as sensorDefs, irChannels, pinLabel, isAnalogPin } from './parts.js';

const HIGH = 1, LOW = 0;

// Sketch Strings are plain JS strings; these are the Arduino String methods
// JS doesn't already have.
const stringMethods = {
  toInt() { return parseInt(this, 10) || 0; },
  toFloat() { return parseFloat(this) || 0; },
  equals(other) { return String(this) === String(other); },
};
for (const [name, value] of Object.entries(stringMethods)) {
  if (!(name in String.prototype)) Object.defineProperty(String.prototype, name, { value, configurable: true, writable: true });
}

function rng(seed) {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}

export function createHardware(robot, world) {
  const board = boards[robot.board];
  const rand = rng(12345);
  const hw = {
    board,
    clock: 0,
    // how long the board had been on before the run, as millis()/micros() see it
    clockOffset: 0,
    pins: new Map(),
    serial: [],
    serialBaud: 0,
    warnings: new Map(),
    reads: new Map(),
    writes: new Map(),
    servos: new Map(),
    sonarState: new Map(),
    sonarReads: new Map(),
    loops: 0,
    loopTime: { total: 0, max: 0 },
    maxDelay: 0,
    lastDelayAt: 0,
  };

  // What each pin is connected to
  const byPin = new Map();
  for (const ch of irChannels(robot)) byPin.set(ch.pin, { kind: 'ir', ch });
  for (const s of robot.sensors) {
    const def = sensorDefs[s.type];
    if (def.kind === 'sonar') {
      byPin.set(s.pins.TRIG, { kind: 'trig', sensor: s });
      byPin.set(s.pins.ECHO, { kind: 'echo', sensor: s });
      hw.sonarState.set(s.id, { high: false, armed: false });
    } else if (def.kind === 'gripper') {
      byPin.set(s.pins.SIG, { kind: 'servo', sensor: s });
    } else if (def.kind === 'encoder') {
      byPin.set(s.pins.L, { kind: 'encoder', side: 'L' });
      byPin.set(s.pins.R, { kind: 'encoder', side: 'R' });
    } else if (def.kind === 'color') {
      for (const role of ['S0', 'S1', 'S2', 'S3']) byPin.set(s.pins[role], { kind: 'color-ctl', sensor: s });
      byPin.set(s.pins.OUT, { kind: 'color-out', sensor: s });
    } else if (def.kind === 'imu') {
      byPin.set(s.pins.SDA, { kind: 'i2c' });
      byPin.set(s.pins.SCL, { kind: 'i2c' });
    }
  }
  for (const [role, pin] of Object.entries(robot.driverPins)) byPin.set(pin, { kind: 'driver', role });
  hw.byPin = byPin;

  const warn = (key, msg, extra = {}) => {
    const w = hw.warnings.get(key);
    if (w) w.count++;
    else hw.warnings.set(key, { key, msg, count: 1, t: hw.clock / 1e6, ...extra });
  };
  const count = (map, pin) => map.set(pin, (map.get(pin) || 0) + 1);
  const pinState = pin => {
    if (!hw.pins.has(pin)) hw.pins.set(pin, { mode: 'INPUT', level: 0, pwm: null });
    return hw.pins.get(pin);
  };
  const label = pin => pinLabel(board, pin);
  const checkPin = (pin, fn) => {
    if (typeof pin !== 'number' || Number.isNaN(pin)) {
      warn(`nan-pin-${fn}`, `${fn}() got "${pin}" instead of a pin number.`, { fn });
      return false;
    }
    if (!board.pins.includes(pin)) {
      warn(`bad-pin-${pin}`, `${board.name} has no pin ${pin < 0 ? 'A' + (-1 - pin) : pin}.`, { pin, fn });
      return false;
    }
    return true;
  };

  function pinMode(pin, mode) {
    hw.clock += 4;
    if (!checkPin(pin, 'pinMode')) return;
    const name = mode === 1 ? 'OUTPUT' : mode === 2 ? 'INPUT_PULLUP' : 'INPUT';
    if (name === 'OUTPUT' && (board.inputOnly.includes(pin) || board.analogOnly.includes(pin))) {
      warn(`input-only-${pin}`, `${label(pin)} can only be an input.`, { pin });
      return;
    }
    pinState(pin).mode = name;
  }

  function digitalWrite(pin, value) {
    hw.clock += 5;
    if (!checkPin(pin, 'digitalWrite')) return;
    const p = pinState(pin);
    count(hw.writes, pin);
    if (p.mode !== 'OUTPUT') warn(`write-not-output-${pin}`, `digitalWrite(${label(pin)}) but ${label(pin)} was never set to OUTPUT with pinMode.`, { pin });
    const level = value ? HIGH : LOW;
    p.level = level;
    p.pwm = null;
    const conn = byPin.get(pin);
    if (conn && conn.kind === 'trig' && p.mode === 'OUTPUT') {
      const s = hw.sonarState.get(conn.sensor.id);
      if (level) s.high = true;
      else if (s.high) { s.high = false; s.armed = true; }
    }
  }

  function analogWrite(pin, value) {
    hw.clock += 8;
    if (!checkPin(pin, 'analogWrite')) return;
    const p = pinState(pin);
    count(hw.writes, pin);
    p.mode = 'OUTPUT';
    value = Math.round(+value || 0);
    if (value < 0 || value > 255) warn(`pwm-range-${pin}`, `analogWrite(${label(pin)}, ${value}) is outside 0-255.`, { pin, value });
    value = Math.max(0, Math.min(255, value));
    if (!board.pwm.includes(pin)) {
      warn(`no-pwm-${pin}`, `${label(pin)} has no PWM, so analogWrite only switches it fully on or off.`, { pin });
      p.level = value >= 128 ? HIGH : LOW;
      p.pwm = null;
      return;
    }
    p.pwm = value;
  }

  function floating(pin, fn) {
    warn(`floating-${pin}`, `${fn}(${label(pin)}) reads a pin with nothing connected, so the value is random.`, { pin });
    return rand();
  }

  function digitalRead(pin) {
    hw.clock += 5;
    if (!checkPin(pin, 'digitalRead')) return LOW;
    count(hw.reads, pin);
    const p = pinState(pin);
    const conn = byPin.get(pin);
    if (p.mode === 'OUTPUT') return p.pwm !== null ? (p.pwm > 0 ? HIGH : LOW) : p.level;
    if (!conn) return p.mode === 'INPUT_PULLUP' ? HIGH : floating(pin, 'digitalRead') > 0.5 ? HIGH : LOW;
    if (conn.kind === 'ir') return world.irCoverage(conn.ch) > 0.5 ? HIGH : LOW;
    if (conn.kind === 'encoder') return encoderEdges[conn.side] & 1;
    if (conn.kind === 'color-out') return rand() > 0.5 ? HIGH : LOW;
    return LOW;
  }

  function analogRead(pin) {
    hw.clock += 112;
    if (typeof pin === 'number' && board.id !== 'esp32' && pin >= 0 && pin < Object.keys(board.analog).length && !isAnalogPin(board, pin)) {
      pin = board.analog['A' + pin];
    }
    if (!checkPin(pin, 'analogRead')) return 0;
    count(hw.reads, pin);
    if (!isAnalogPin(board, pin)) {
      warn(`not-analog-${pin}`, `analogRead(${label(pin)}) but ${label(pin)} isn't an analog input.`, { pin });
      return 0;
    }
    const conn = byPin.get(pin);
    const max = board.adcMax;
    if (!conn) return Math.round(floating(pin, 'analogRead') * max);
    if (conn.kind === 'ir') {
      const cov = world.irCoverage(conn.ch);
      if (conn.ch.signal === 'digital') return cov > 0.5 ? Math.round(max * 0.98) : Math.round(max * 0.01);
      const noise = (rand() - 0.5) * 0.03;
      return Math.max(0, Math.min(max, Math.round((0.07 + 0.83 * cov + noise) * max)));
    }
    return 0;
  }

  function echoMicros(sensor) {
    const d = world.sonarDistance(sensor);
    hw.sonarReads.set(sensor.id, { t: hw.clock / 1e6, mm: d });
    if (!Number.isFinite(d) || d > sensorDefs.hcsr04.range) return 38000;
    return Math.max(120, d * 5.83);
  }

  function pulseIn(pin, state = HIGH, timeout = 1000000) {
    if (!checkPin(pin, 'pulseIn')) return 0;
    count(hw.reads, pin);
    const conn = byPin.get(pin);
    if (conn && conn.kind === 'color-out') return colorPulse(conn.sensor, timeout);
    if (!conn || conn.kind !== 'echo') {
      warn(`pulse-wrong-pin-${pin}`, `pulseIn(${label(pin)}) waits on a pin that isn't an ultrasonic ECHO.`, { pin });
      hw.clock += timeout;
      return 0;
    }
    const s = hw.sonarState.get(conn.sensor.id);
    if (!s.armed) {
      warn(`pulse-no-trigger-${conn.sensor.id}`, `pulseIn() on ECHO ${label(pin)} without a TRIG pulse first, so it waited for the full timeout.`, { pin });
      hw.clock += timeout;
      return 0;
    }
    s.armed = false;
    if (!state) { hw.clock += 500; return 500; }
    const dur = echoMicros(conn.sensor);
    hw.clock += 450;
    if (dur > timeout) { hw.clock += timeout; return 0; }
    hw.clock += dur;
    return Math.round(dur);
  }

  function* delay(ms) {
    ms = Math.max(0, +ms || 0);
    if (ms > hw.maxDelay) hw.maxDelay = ms;
    hw.clock += ms * 1000;
    yield ms;
  }

  function* delayMicroseconds(us) {
    hw.clock += Math.max(0, +us || 0);
    yield 0;
  }

  function serialText(v, fmt) {
    if (typeof v === 'number') {
      if (fmt === 16) return Math.trunc(v).toString(16).toUpperCase();
      if (fmt === 2) return Math.trunc(v).toString(2);
      if (!Number.isInteger(v)) return v.toFixed(typeof fmt === 'number' && fmt < 10 ? fmt : 2);
      return String(v);
    }
    if (typeof v === 'boolean') return v ? '1' : '0';
    return String(v);
  }

  let pending = '';
  function emit(text, newline) {
    if (!hw.serialBaud) {
      warn('serial-not-begun', 'Serial.print() before Serial.begin(), so nothing was sent.');
      return;
    }
    hw.clock += ((text.length + (newline ? 2 : 0)) * 10 / hw.serialBaud) * 1e6;
    pending += text;
    if (newline) {
      hw.serial.push({ t: hw.clock / 1e6, text: pending });
      if (hw.serial.length > 400) hw.serial.shift();
      pending = '';
    }
  }

  const Serial = {
    begin(baud = 9600) { hw.serialBaud = +baud || 9600; },
    print(v = '', fmt) { emit(serialText(v, fmt), false); },
    println(v = '', fmt) { emit(serialText(v, fmt), true); },
    available() { return 0; },
    read() { return -1; },
    flush() {},
  };

  class Servo {
    constructor() { this.pin = null; this.angle = 90; }
    attach(pin) {
      this.pin = pin;
      const conn = byPin.get(pin);
      if (!conn || conn.kind !== 'servo') warn(`servo-pin-${pin}`, `Servo attached to ${label(pin)}, but the gripper servo is wired somewhere else.`, { pin });
      else hw.servos.set(conn.sensor.id, this.angle);
      return 1;
    }
    write(angle) {
      this.angle = Math.max(0, Math.min(180, +angle || 0));
      if (this.pin === null) { warn('servo-not-attached', 'Servo.write() before Servo.attach(), so the servo ignored it.'); return; }
      const conn = byPin.get(this.pin);
      if (conn && conn.kind === 'servo') hw.servos.set(conn.sensor.id, this.angle);
    }
    writeMicroseconds(us) { this.write(((us - 544) / (2400 - 544)) * 180); }
    read() { return Math.round(this.angle); }
    attached() { return this.pin !== null; }
    detach() { this.pin = null; }
  }

  class NewPing {
    constructor(trig, echo, maxCm = 500) { this.trig = trig; this.echo = echo; this.max = maxCm; }
    ping() {
      const conn = byPin.get(this.echo);
      const trig = byPin.get(this.trig);
      if (!conn || conn.kind !== 'echo' || !trig || trig.sensor !== conn.sensor) {
        warn(`newping-pins-${this.trig}-${this.echo}`, `NewPing(${this.trig}, ${this.echo}) doesn't match how the ultrasonic sensor is wired.`);
        hw.clock += 30000;
        return 0;
      }
      const us = echoMicros(conn.sensor);
      hw.clock += Math.min(us, this.max * 58) + 500;
      return us / 58 > this.max ? 0 : Math.round(us);
    }
    ping_cm() { return Math.round(this.ping() / 58); }
    ping_in() { return Math.round(this.ping() / 148); }
    convert_cm(us) { return Math.round(us / 58); }
  }

  // Interrupts. On AVR boards interrupt numbers are not pin numbers, which is
  // what digitalPinToInterrupt() is for; on the ESP32 they are the same.
  const CHANGE = 1, FALLING = 2, RISING = 3;
  const isrs = new Map();
  const intPin = n => (board.id === 'esp32' ? n : board.interruptPins[n]);

  function digitalPinToInterrupt(pin) {
    return board.id === 'esp32' ? pin : board.interruptPins.indexOf(pin);
  }
  function attachInterrupt(n, fn, mode = CHANGE) {
    const pin = intPin(n);
    if (pin === undefined || n < 0) {
      warn(`bad-interrupt-${n}`, `attachInterrupt(${n}, ...) isn't an interrupt on the ${board.name}. Use attachInterrupt(digitalPinToInterrupt(pin), ...) with ${board.interruptPins.slice(0, 6).map(label).join(' or ')}.`);
      return;
    }
    if (typeof fn !== 'function') { warn('isr-not-function', 'The second argument to attachInterrupt() has to be the name of a function.'); return; }
    const conn = byPin.get(pin);
    if (!conn || conn.kind !== 'encoder') warn(`isr-no-encoder-${pin}`, `attachInterrupt() listens on ${label(pin)}, but no encoder is wired there, so it never fires.`, { pin });
    isrs.set(pin, { fn, mode });
  }
  function detachInterrupt(n) { isrs.delete(intPin(n)); }

  function fireIsr(pin, level) {
    const isr = isrs.get(pin);
    if (!isr || (isr.mode === RISING && !level) || (isr.mode === FALLING && level)) return;
    hw.clock += 4;
    try {
      const g = isr.fn();
      if (g && g.next) for (let i = 0; i < 1000 && !g.next().done; i++);
    } catch (err) {
      warn('isr-crash', `The interrupt function crashed: ${err.message}`);
    }
  }

  // Wheel encoders: every slot in the disc gives one rising and one falling
  // edge, so wheel travel in half-slots is the number of edges so far.
  const enc = robot.sensors.find(s => sensorDefs[s.type].kind === 'encoder');
  const halfSlot = (Math.PI * motors[robot.motor].wheel) / sensorDefs.encoder.slots / 2;
  const encoderEdges = { L: 0, R: 0 };
  hw.updateEncoders = (travelL, travelR) => {
    if (!enc) return;
    for (const [side, travel] of [['L', travelL], ['R', travelR]]) {
      const target = Math.floor(travel / halfSlot);
      while (encoderEdges[side] !== target) {
        encoderEdges[side] += target > encoderEdges[side] ? 1 : -1;
        fireIsr(enc.pins[side], encoderEdges[side] & 1);
      }
    }
  };

  // TCS3200: S0/S1 pick the output scale, S2/S3 the filter. OUT is a square
  // wave whose frequency follows how much light gets through that filter.
  hw.colorReads = 0;
  function colorPulse(sensor, timeout) {
    const lv = role => {
      const p = hw.pins.get(sensor.pins[role]);
      return p && p.mode === 'OUTPUT' ? p.level : 0;
    };
    hw.colorReads++;
    const scale = [0, 0.02, 0.2, 1][lv('S0') * 2 + lv('S1')];
    if (!scale) {
      warn('tcs-off', 'The TCS3200 is powered down because S0 and S1 are both LOW. Set S0 HIGH and S1 LOW for 20% output scaling.');
      hw.clock += timeout;
      return 0;
    }
    const [r, g, b] = world.floorColor(sensor);
    const light = [r, b, (r + g + b) / 3, g][lv('S2') * 2 + lv('S3')];   // LL red, LH blue, HL clear, HH green
    const hz = scale * 100000 * (0.04 + 0.96 * light) * (1 + (rand() - 0.5) * 0.04);
    const us = 1e6 / (2 * hz);
    if (us > timeout) { hw.clock += timeout; return 0; }
    hw.clock += us * 3;   // wait for the next edge, then time the pulse
    return Math.round(us);
  }

  // MPU6050 at 0x68. Readings are big-endian 16-bit registers from 0x3B:
  // accel x, y, z, temperature, gyro x, y, z.
  const imu = robot.sensors.find(s => sensorDefs[s.type].kind === 'imu');
  const imuWired = !!imu && imu.pins.SDA === board.i2cPins[0] && imu.pins.SCL === board.i2cPins[1];
  const mpu = { awake: false, reg: 0, gyroFs: 0, accelFs: 0 };
  hw.imuReads = 0;
  hw.wireBegun = false;

  function answers(addr, fn) {
    if (!imu) { warn('imu-missing', `${fn}: nothing answered on I2C. This robot has no MPU6050; add one on the Robot tab.`); return false; }
    if (!imuWired) { warn('imu-wiring', `${fn}: the MPU6050 didn't answer. SDA and SCL have to go to ${label(board.i2cPins[0])} and ${label(board.i2cPins[1])}.`); return false; }
    if (addr !== 0x68) { warn('imu-address', `${fn}: nothing answered at 0x${(+addr).toString(16)}. With AD0 low the MPU6050 is at 0x68.`); return false; }
    return true;
  }
  function imuState() {
    hw.imuReads++;
    const m = world.imu();
    const n = k => (rand() - 0.5) * k;
    if (!mpu.awake) {
      warn('imu-asleep', 'The MPU6050 is still asleep, so every reading is 0. Write 0 to register 0x6B (PWR_MGMT_1) to wake it up.');
      return { ax: 0, ay: 0, az: 0, gx: 0, gy: 0, gz: 0, temp: 36.53 };
    }
    // A real gyro never reads exactly 0 at rest; this one drifts 0.2 deg/s
    return { ax: m.ax + n(0.08), ay: m.ay + n(0.08), az: m.az + n(0.08), gx: m.gx + n(0.01), gy: m.gy + n(0.01), gz: m.gz + n(0.01) + 0.0035, temp: 24 + n(0.2) };
  }
  function imuRaw() {
    const s = imuState();
    const lsbG = (16384 >> mpu.accelFs) / 9.81, lsbRad = (131 / (1 << mpu.gyroFs)) * (180 / Math.PI);
    const clip = v => Math.max(-32768, Math.min(32767, Math.round(v)));
    return [s.ax * lsbG, s.ay * lsbG, s.az * lsbG, (s.temp - 36.53) * 340, s.gx * lsbRad, s.gy * lsbRad, s.gz * lsbRad].map(clip);
  }
  // ponytail: high bytes come back signed so `Wire.read() << 8 | Wire.read()` gives a negative
  // reading without 16-bit int wrap-around. Breaks only code that expects the raw 0-255 high byte.
  function imuRegs(reg, n) {
    const bytes = new Array(0x80).fill(0);
    if (reg <= 0x48 && reg + n > 0x3b) imuRaw().forEach((v, i) => { bytes[0x3b + i * 2] = v >> 8; bytes[0x3c + i * 2] = v & 255; });
    bytes[0x1b] = mpu.gyroFs << 3;
    bytes[0x1c] = mpu.accelFs << 3;
    bytes[0x6b] = mpu.awake ? 0 : 0x40;
    bytes[0x75] = 0x68;
    return Array.from({ length: n }, (_, i) => bytes[(reg + i) & 0x7f]);
  }
  function imuWrite(reg, v) {
    if (reg === 0x6b) mpu.awake = !(v & 0x40);
    else if (reg === 0x1b) mpu.gyroFs = (v >> 3) & 3;
    else if (reg === 0x1c) mpu.accelFs = (v >> 3) & 3;
  }

  let tx = null, rx = [];
  const Wire = {
    begin() { hw.wireBegun = true; },
    setClock() {},
    beginTransmission(addr) { tx = { addr, bytes: [] }; },
    write(v) { if (tx) tx.bytes.push(v & 255); return 1; },
    endTransmission() {
      if (!tx) return 4;
      const t = tx;
      tx = null;
      hw.clock += 100 + t.bytes.length * 90;
      if (!hw.wireBegun) { warn('wire-not-begun', 'Wire.begin() was never called, so nothing went out on I2C.'); return 4; }
      if (!answers(t.addr, 'Wire.endTransmission()')) return 2;
      const [reg, ...data] = t.bytes;
      if (reg === undefined) return 0;
      mpu.reg = reg;
      data.forEach((v, i) => imuWrite(reg + i, v));
      return 0;
    },
    requestFrom(addr, n = 1) {
      hw.clock += 100 + n * 90;
      rx = [];
      if (!hw.wireBegun) { warn('wire-not-begun', 'Wire.begin() was never called, so nothing went out on I2C.'); return 0; }
      if (!answers(addr, 'Wire.requestFrom()')) return 0;
      rx = imuRegs(mpu.reg, n);
      mpu.reg += n;
      return n;
    },
    available() { return rx.length; },
    read() { return rx.length ? rx.shift() : -1; },
  };

  // One class for both the MPU6050 (i2cdevlib) and Adafruit_MPU6050 libraries
  class MPU6050 {
    begin(addr = 0x68) {
      hw.clock += 3000;
      if (!answers(addr, 'mpu.begin()')) return false;
      mpu.awake = true;
      return true;
    }
    initialize() { this.begin(); }
    testConnection() { return imuWired; }
    setSleepEnabled(on) { mpu.awake = !on; }
    setAccelerometerRange(r) { mpu.accelFs = r & 3; }
    setGyroRange(r) { mpu.gyroFs = r & 3; }
    setFullScaleAccelRange(r) { mpu.accelFs = r & 3; }
    setFullScaleGyroRange(r) { mpu.gyroFs = r & 3; }
    getAccelerometerRange() { return mpu.accelFs; }
    getGyroRange() { return mpu.gyroFs; }
    setFilterBandwidth() {}
    getEvent(a, g, temp) {
      hw.clock += 1100;
      if (!answers(0x68, 'mpu.getEvent()')) return false;
      const s = imuState();
      if (a) a.acceleration = { x: s.ax, y: s.ay, z: s.az };
      if (g) g.gyro = { x: s.gx, y: s.gy, z: s.gz };
      if (temp) temp.temperature = s.temp;
      return true;
    }
    raw(i) {
      hw.clock += 600;
      return answers(0x68, 'mpu.getRotation()') ? imuRaw()[i] : 0;
    }
    getAccelerationX() { return this.raw(0); }
    getAccelerationY() { return this.raw(1); }
    getAccelerationZ() { return this.raw(2); }
    getTemperature() { return this.raw(3); }
    getRotationX() { return this.raw(4); }
    getRotationY() { return this.raw(5); }
    getRotationZ() { return this.raw(6); }
  }
  class sensors_event_t {
    constructor() {
      this.acceleration = { x: 0, y: 0, z: 0 };
      this.gyro = { x: 0, y: 0, z: 0 };
      this.temperature = 0;
    }
  }

  // Pixy2 camera: line tracking and colour signatures
  const cam = robot.sensors.find(s => sensorDefs[s.type].kind === 'camera');
  hw.cameraReads = 0;
  hw.cameraFrame = null;
  const noVector = { m_x0: 0, m_y0: 0, m_x1: 0, m_y1: 0, m_index: 0, m_flags: 0 };

  class Pixy2 {
    constructor() {
      this.ready = false;
      const self = this;
      this.line = {
        numVectors: 0, numIntersections: 0, numBarcodes: 0,
        vectors: Object.assign([], noVector), intersections: [], barcodes: [],
        getMainFeatures() { return self.features(); },
        getAllFeatures() { return self.features(); },
        setMode() { return 0; },
        setNextTurn() { return 0; },
        setDefaultTurn() { return 0; },
        setVector() { return 0; },
        reverseVector() { return 0; },
      };
      this.ccc = {
        numBlocks: 0, blocks: [],
        getBlocks(wait = true, sigmap = 255, maxBlocks = 255) { return self.blocks(sigmap, maxBlocks); },
      };
    }
    init() {
      hw.clock += 2000;
      if (!cam) {
        warn('pixy-no-camera', 'pixy.init() failed: this robot has no Pixy2 camera. Add one on the Robot tab.');
        return -1;
      }
      this.ready = true;
      return 0;
    }
    changeProg() { return this.ready ? 0 : -1; }
    setLamp() { return 0; }
    setLED() { return 0; }
    setServos() { return 0; }
    getVersion() { return this.ready ? 0 : -1; }
    features() {
      hw.clock += 1500;
      if (!cam) { warn('pixy-no-camera', 'The code reads a Pixy2, but this robot has no camera. Add one on the Robot tab.'); return -1; }
      if (!this.ready) { warn('pixy-no-init', 'getMainFeatures() was called before pixy.init(), so the camera answered with an error.'); return -1; }
      hw.cameraReads++;
      const f = world.cameraFrame(cam);
      hw.cameraFrame = f;
      const vecs = f.vector ? [{ ...f.vector }] : [];
      // So both vectors[0].m_x1 and vectors->m_x1 work
      this.line.vectors = Object.assign(vecs, vecs[0] || noVector);
      this.line.numVectors = vecs.length;
      this.line.numIntersections = f.intersection ? 1 : 0;
      return (f.vector ? 1 : 0) | (f.intersection ? 2 : 0);
    }
    blocks(sigmap, maxBlocks) {
      hw.clock += 1500;
      if (!cam) { warn('pixy-no-camera', 'The code reads a Pixy2, but this robot has no camera. Add one on the Robot tab.'); return -1; }
      if (!this.ready) { warn('pixy-no-init', 'getBlocks() was called before pixy.init(), so the camera answered with an error.'); return -1; }
      hw.cameraReads++;
      const list = world.pixyBlocks(cam)
        .filter(b => sigmap & (1 << (b.m_signature - 1)))
        .slice(0, maxBlocks)
        .map(b => ({ ...b, print() {} }));
      this.ccc.blocks = list;
      this.ccc.numBlocks = list.length;
      return list.length;
    }
  }

  const api = {
    HIGH, LOW, INPUT: 0, OUTPUT: 1, INPUT_PULLUP: 2,
    LED_BUILTIN: board.id === 'esp32' ? 2 : 13,
    ...board.analog,
    DEC: 10, HEX: 16, BIN: 2,
    PI: Math.PI, HALF_PI: Math.PI / 2, TWO_PI: Math.PI * 2, NULL: null,
    pinMode, digitalWrite, digitalRead, analogWrite, analogRead, pulseIn,
    // Both are 32-bit on the board, so they wrap (millis after ~49 days)
    millis: () => Math.floor((hw.clock + hw.clockOffset) / 1000) >>> 0,
    micros: () => Math.floor(hw.clock + hw.clockOffset) >>> 0,
    delay, delayMicroseconds,
    map: (x, a, b, c, d) => Math.trunc(((x - a) * (d - c)) / (b - a) + c),
    constrain: (x, a, b) => (x < a ? a : x > b ? b : x),
    random: (a, b) => (b === undefined ? Math.floor(rand() * a) : Math.floor(a + rand() * (b - a))),
    randomSeed() {},
    abs: Math.abs, min: Math.min, max: Math.max, pow: Math.pow, sqrt: Math.sqrt, sq: x => x * x,
    sin: Math.sin, cos: Math.cos, tan: Math.tan, atan2: Math.atan2, floor: Math.floor, ceil: Math.ceil, round: Math.round,
    bitRead: (v, b) => (v >> b) & 1,
    bitWrite: (v, b, x) => (x ? v | (1 << b) : v & ~(1 << b)),
    lowByte: v => v & 255, highByte: v => (v >> 8) & 255,
    tone() {}, noTone() {},
    Serial, Servo, NewPing,
    Pixy2, Pixy2I2C: Pixy2, Pixy2SPI_SS: Pixy2, Pixy2UART: Pixy2,
    LINE_VECTOR: 1, LINE_INTERSECTION: 2, LINE_BARCODE: 4, LINE_ALL_FEATURES: 7,
    PIXY_RESULT_OK: 0, PIXY_RESULT_ERROR: -1,
    CCC_SIG1: 1, CCC_SIG2: 2, CCC_SIG3: 4, CCC_SIG4: 8, CCC_SIG_ALL: 255,
    attachInterrupt, detachInterrupt, digitalPinToInterrupt, interrupts() {}, noInterrupts() {},
    CHANGE, FALLING, RISING, NOT_AN_INTERRUPT: -1,
    Wire, MPU6050, Adafruit_MPU6050: MPU6050, sensors_event_t,
    MPU6050_RANGE_2_G: 0, MPU6050_RANGE_4_G: 1, MPU6050_RANGE_8_G: 2, MPU6050_RANGE_16_G: 3,
    MPU6050_RANGE_250_DEG: 0, MPU6050_RANGE_500_DEG: 1, MPU6050_RANGE_1000_DEG: 2, MPU6050_RANGE_2000_DEG: 3,
    MPU6050_BAND_260_HZ: 0, MPU6050_BAND_184_HZ: 1, MPU6050_BAND_94_HZ: 2, MPU6050_BAND_44_HZ: 3,
    MPU6050_BAND_21_HZ: 4, MPU6050_BAND_10_HZ: 5, MPU6050_BAND_5_HZ: 6,
    F: s => s,
    String: (v = '', fmt) => serialText(v, fmt),
    __int: x => Math.trunc(+x) || 0,
    __sizeof: x => (Array.isArray(x) ? x.length * 2 : typeof x === 'string' ? x.length + 1 : 2),
  };
  // Analog constants for every board name so a sketch written for a bigger
  // board still compiles; the pin check reports it instead.
  for (let i = 0; i < 20; i++) if (!(('A' + i) in api)) api['A' + i] = -1 - i;

  // Driver input as the motor driver sees it: duty 0-1, or null if the pin
  // is not being driven at all.
  hw.level = pin => {
    const p = hw.pins.get(pin);
    if (!p || p.mode !== 'OUTPUT') return null;
    return p.pwm !== null ? p.pwm / 255 : p.level;
  };

  hw.api = api;
  return hw;
}
