// Parts catalog. Numbers are close to datasheet values, rounded where it
// doesn't change behaviour.

const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);

function avrBoard(id, name, digitalCount, analogCount, pwm, extra = {}) {
  const analog = {};
  for (let i = 0; i < analogCount; i++) analog['A' + i] = digitalCount + i;
  return {
    id, name, pwm, analog,
    pins: range(0, digitalCount + analogCount - 1),
    analogOnly: [], inputOnly: [],
    adcMax: 1023, logic: 5,
    serialPins: [0, 1],
    spiPins: [11, 12, 13],
    // In interrupt-number order, so digitalPinToInterrupt(2) is 0
    interruptPins: [2, 3],
    i2cPins: [digitalCount + 4, digitalCount + 5],   // SDA = A4, SCL = A5
    ...extra,
  };
}

export const boards = {
  uno: avrBoard('uno', 'Arduino Uno', 14, 6, [3, 5, 6, 9, 10, 11], {
    blurb: '14 digital pins, 6 PWM, 6 analog inputs. The classroom default.',
  }),
  nano: avrBoard('nano', 'Arduino Nano', 14, 8, [3, 5, 6, 9, 10, 11], {
    analogOnly: [20, 21],
    blurb: 'Same chip as the Uno on a breadboard-friendly board. A6 and A7 are analog only.',
  }),
  mega: avrBoard('mega', 'Arduino Mega 2560', 54, 16, [...range(2, 13), 44, 45, 46], {
    spiPins: [50, 51, 52],
    interruptPins: [2, 3, 21, 20, 19, 18],
    i2cPins: [20, 21],
    blurb: '54 digital pins and 15 PWM. Room for big sensor arrays.',
  }),
  esp32: {
    id: 'esp32', name: 'ESP32 DevKit',
    pins: [0, 2, 4, 5, 12, 13, 14, 15, 16, 17, 18, 19, 21, 22, 23, 25, 26, 27, 32, 33, 34, 35, 36, 39],
    pwm: [0, 2, 4, 5, 12, 13, 14, 15, 16, 17, 18, 19, 21, 22, 23, 25, 26, 27, 32, 33],
    analog: { A0: 36, A3: 39, A4: 32, A5: 33, A6: 34, A7: 35, A10: 4, A11: 0, A12: 2, A13: 15, A14: 13, A15: 12, A16: 14, A17: 27, A18: 25, A19: 26 },
    analogOnly: [], inputOnly: [34, 35, 36, 39],
    adcMax: 4095, logic: 3.3,
    serialPins: [1, 3],
    spiPins: [18, 19, 23],
    interruptPins: [0, 2, 4, 5, 12, 13, 14, 15, 16, 17, 18, 19, 21, 22, 23, 25, 26, 27, 32, 33, 34, 35, 36, 39],
    i2cPins: [21, 22],
    blurb: 'Wi-Fi board with PWM on most pins. 12-bit ADC, so analogRead goes up to 4095. GPIO 34-39 are input only.',
  },
};

export function pinLabel(board, pin) {
  if (board.id === 'esp32') return 'GPIO' + pin;
  for (const [name, n] of Object.entries(board.analog)) if (n === pin) return name;
  return 'D' + pin;
}

export function isAnalogPin(board, pin) {
  return Object.values(board.analog).includes(pin);
}

// rpm and wheel diameter at 6 V. Speed scales with voltage at the motor.
export const motors = {
  tt: { id: 'tt', name: 'TT gear motor 1:48', rpm: 200, wheel: 65, tau: 0.09, blurb: 'Yellow plastic gearbox. Cheap, a bit slow, very forgiving.' },
  n20: { id: 'n20', name: 'N20 micro gear motor 300 rpm', rpm: 300, wheel: 34, tau: 0.05, blurb: 'Tiny metal gearbox. Light and quick to respond.' },
  ga25: { id: 'ga25', name: '25GA-370 metal gear motor', rpm: 280, wheel: 65, tau: 0.14, blurb: 'Heavy and strong. Fast on straights, needs braking room.' },
};

// Motor A drives the left wheel, motor B the right wheel.
export const drivers = {
  l298n: {
    id: 'l298n', name: 'L298N dual H-bridge', drop: 2.0,
    roles: ['ENA', 'IN1', 'IN2', 'IN3', 'IN4', 'ENB'],
    pwmRoles: ['ENA', 'ENB'],
    blurb: 'The red board everyone starts with. Loses about 2 V inside, so motors run slower than the battery suggests.',
  },
  l293d: {
    id: 'l293d', name: 'L293D chip', drop: 1.4,
    roles: ['ENA', 'IN1', 'IN2', 'IN3', 'IN4', 'ENB'],
    pwmRoles: ['ENA', 'ENB'],
    blurb: 'Breadboard H-bridge chip. Same wiring as the L298N, a little less voltage loss.',
  },
  tb6612: {
    id: 'tb6612', name: 'TB6612FNG', drop: 0.3,
    roles: ['PWMA', 'AIN1', 'AIN2', 'BIN1', 'BIN2', 'PWMB', 'STBY'],
    pwmRoles: ['PWMA', 'PWMB'],
    blurb: 'Efficient MOSFET driver. Stays asleep until STBY is HIGH.',
  },
};

export const batteries = {
  aa4: { id: 'aa4', name: '4 × AA', volts: 6.0, blurb: '6 V fresh. Fine for TT motors with a TB6612.' },
  li2: { id: 'li2', name: '2 × 18650 Li-ion', volts: 7.4, blurb: '7.4 V and holds it under load. Good with an L298N.' },
  v9: { id: 'v9', name: '9 V battery', volts: 5.2, blurb: 'Says 9 V, sags to about 5 V as soon as motors pull current.' },
};

export const chassis = {
  round: { id: 'round', name: 'Round 2WD acrylic', shape: 'round', length: 160, width: 160, track: 132, radius: 80 },
  rect: { id: 'rect', name: 'Rectangular 2WD', shape: 'rect', length: 190, width: 140, track: 148, radius: 92 },
  mini: { id: 'mini', name: 'Mini 10 cm', shape: 'rect', length: 100, width: 100, track: 92, radius: 62 },
};

// Sensors. IR modules output HIGH over the black line (LED on = line seen).
export const sensors = {
  'ir-single': {
    id: 'ir-single', name: 'TCRT5000 IR module', kind: 'ir', channels: 1, signal: 'digital',
    roles: ['OUT'],
    blurb: 'One reflectance sensor. OUT is HIGH over black, LOW over white.',
  },
  'ir-3': {
    id: 'ir-3', name: '3-channel IR array', kind: 'ir', channels: 3, signal: 'digital', spacing: 18,
    roles: ['L', 'C', 'R'],
    blurb: 'Left, center, right. Each output is HIGH over black.',
  },
  'ir-5': {
    id: 'ir-5', name: '5-channel IR array', kind: 'ir', channels: 5, signal: 'digital', spacing: 15,
    roles: ['S1', 'S2', 'S3', 'S4', 'S5'],
    blurb: 'S1 is the leftmost. HIGH over black. Enough resolution for proportional steering.',
  },
  'ir-5a': {
    id: 'ir-5a', name: '5-channel analog IR array', kind: 'ir', channels: 5, signal: 'analog', spacing: 15,
    roles: ['S1', 'S2', 'S3', 'S4', 'S5'],
    blurb: 'Analog outputs: high reading over black, low over white. Needs analog pins.',
  },
  hcsr04: {
    id: 'hcsr04', name: 'HC-SR04 ultrasonic', kind: 'sonar', roles: ['TRIG', 'ECHO'], range: 4000, cone: 0.26,
    blurb: 'Pulse TRIG for 10 µs, then pulseIn(ECHO, HIGH). Distance in cm = microseconds / 58.',
  },
  gripper: {
    id: 'gripper', name: 'SG90 servo gripper', kind: 'gripper', roles: ['SIG'],
    blurb: 'Servo jaws on the front. write(90) opens, write(10) closes.',
  },
  camera: {
    id: 'camera', name: 'Pixy2 camera', kind: 'camera', roles: [], bus: 'spi',
    blurb: 'Smart camera on the ICSP header (SPI). Line mode: pixy.line.getMainFeatures(). Colour mode: pixy.ccc.getBlocks() finds red, green, blue and yellow cans and patches (signatures 1 to 4).',
  },
  encoder: {
    id: 'encoder', name: 'Wheel encoders (pair)', kind: 'encoder', roles: ['L', 'R'], slots: 20, interrupt: true,
    blurb: 'Slotted discs on both wheels, 20 pulses per turn. Count them with attachInterrupt(digitalPinToInterrupt(pin), isr, RISING). On an Uno only D2 and D3 can do that.',
  },
  mpu6050: {
    id: 'mpu6050', name: 'MPU6050 gyro + accelerometer', kind: 'imu', roles: ['SDA', 'SCL'], bus: 'i2c',
    blurb: 'I2C at address 0x68, on A4 (SDA) and A5 (SCL) on an Uno. Gyro Z is the turn rate. Use Wire with the MPU6050 or Adafruit_MPU6050 library.',
  },
  tcs3200: {
    id: 'tcs3200', name: 'TCS3200 colour sensor', kind: 'color', roles: ['S0', 'S1', 'S2', 'S3', 'OUT'], outputs: ['S0', 'S1', 'S2', 'S3'],
    blurb: 'Looks at the floor. S0/S1 set the output scale, S2/S3 pick the red, green, blue or clear filter, and pulseIn(OUT, LOW) gets shorter the more of that colour it sees.',
  },
};

// Starting robots for each kind of bot.
export function defaultRobot(kind = 'line') {
  const base = {
    name: 'My robot',
    board: 'uno', motor: 'tt', driver: 'l298n', battery: 'li2', chassis: 'round',
    flipA: false, flipB: false,
    driverPins: { ENA: 5, IN1: 7, IN2: 8, IN3: 9, IN4: 10, ENB: 6 },
    sensors: [],
  };
  if (kind === 'line') {
    base.sensors = [{ id: 's1', type: 'ir-3', forward: 70, side: 0, pins: { L: 2, C: 3, R: 4 } }];
  } else if (kind === 'maze') {
    base.chassis = 'mini';
    base.motor = 'n20';
    base.driver = 'tb6612';
    base.driverPins = { PWMA: 5, AIN1: 7, AIN2: 8, BIN1: 9, BIN2: 10, PWMB: 6, STBY: 4 };
    base.sensors = [
      { id: 's1', type: 'hcsr04', forward: 40, side: 0, facing: 'front', pins: { TRIG: 11, ECHO: 12 } },
      { id: 's2', type: 'hcsr04', forward: 15, side: -40, facing: 'left', pins: { TRIG: 2, ECHO: 3 } },
      { id: 's3', type: 'hcsr04', forward: 15, side: 40, facing: 'right', pins: { TRIG: 13, ECHO: 14 } },
    ];
  } else if (kind === 'grab') {
    base.chassis = 'rect';
    base.sensors = [
      { id: 's1', type: 'ir-3', forward: 85, side: 0, pins: { L: 2, C: 3, R: 4 } },
      { id: 's2', type: 'hcsr04', forward: 80, side: 0, facing: 'front', pins: { TRIG: 11, ECHO: 12 } },
      { id: 's3', type: 'gripper', forward: 95, side: 0, pins: { SIG: 13 } },
    ];
  } else if (kind === 'avoid') {
    base.sensors = [{ id: 's1', type: 'hcsr04', forward: 60, side: 0, facing: 'front', pins: { TRIG: 11, ECHO: 12 } }];
  } else if (kind === 'sumo') {
    // Two IR sensors at the front corners watch for the white edge
    base.sensors = [
      { id: 's1', type: 'ir-single', forward: 62, side: -45, pins: { OUT: 2 } },
      { id: 's2', type: 'ir-single', forward: 62, side: 45, pins: { OUT: 3 } },
      { id: 's3', type: 'hcsr04', forward: 60, side: 0, facing: 'front', pins: { TRIG: 11, ECHO: 12 } },
    ];
  }
  return base;
}

export const facingAngle = { front: 0, left: -Math.PI / 2, right: Math.PI / 2, back: Math.PI };

// Every IR channel on the robot, sorted left to right, with its pin.
export function irChannels(robot) {
  const out = [];
  for (const s of robot.sensors) {
    const def = sensors[s.type];
    if (!def || def.kind !== 'ir') continue;
    const n = def.channels;
    const spacing = def.spacing || 0;
    def.roles.forEach((role, i) => {
      out.push({
        sensor: s, role, pin: s.pins[role], signal: def.signal,
        forward: s.forward, side: s.side + (i - (n - 1) / 2) * spacing,
      });
    });
  }
  return out.sort((a, b) => a.side - b.side);
}

// Pin -> what it is connected to. Used for conflict checks and the runtime.
export function pinMap(robot) {
  const map = new Map();
  const add = (pin, what) => {
    if (pin === undefined || pin === null || pin === '') return;
    if (!map.has(pin)) map.set(pin, []);
    map.get(pin).push(what);
  };
  for (const [role, pin] of Object.entries(robot.driverPins)) add(pin, { part: 'driver', role });
  for (const s of robot.sensors) {
    for (const [role, pin] of Object.entries(s.pins || {})) add(pin, { part: 'sensor', sensor: s, role });
  }
  return map;
}

// Wiring problems that would stop a real robot before any code runs.
export function wiringIssues(robot) {
  const board = boards[robot.board];
  const driver = drivers[robot.driver];
  const issues = [];
  const map = pinMap(robot);
  for (const [pin, users] of map) {
    const names = users.map(u => u.part === 'driver' ? `${driver.name} ${u.role}` : `${sensors[u.sensor.type].name} ${u.role}`);
    if (!board.pins.includes(pin)) issues.push({ pin, msg: `${board.name} has no pin ${pin} (used by ${names.join(', ')}).` });
    if (users.length > 1) issues.push({ pin, msg: `${pinLabel(board, pin)} is wired to ${names.join(' and ')}.` });
    if (board.serialPins.includes(pin)) issues.push({ pin, soft: true, msg: `${pinLabel(board, pin)} is a serial pin. Serial.print and uploads will interfere with ${names[0]}.` });
  }
  for (const role of driver.roles) {
    if (robot.driverPins[role] === undefined) issues.push({ msg: `${driver.name} ${role} is not connected.` });
  }
  for (const role of driver.pwmRoles) {
    const pin = robot.driverPins[role];
    if (pin !== undefined && !board.pwm.includes(pin)) {
      issues.push({ pin, soft: true, msg: `${role} is on ${pinLabel(board, pin)}, which has no PWM. Speed control will only be on or off.` });
    }
  }
  for (const s of robot.sensors) {
    const def = sensors[s.type];
    for (const role of def.roles) {
      const pin = s.pins[role];
      if (pin === undefined) { issues.push({ msg: `${def.name} ${role} is not connected.` }); continue; }
      if (def.signal === 'analog' && !isAnalogPin(board, pin)) {
        issues.push({ pin, msg: `${def.name} ${role} is analog but ${pinLabel(board, pin)} can't read analog voltages.` });
      }
      const outputRole = role === 'TRIG' || role === 'SIG' || (def.outputs || []).includes(role);
      if (outputRole && (board.inputOnly.includes(pin) || board.analogOnly.includes(pin))) {
        issues.push({ pin, msg: `${pinLabel(board, pin)} can only be an input, but ${def.name} ${role} needs an output.` });
      }
      if (def.interrupt && !board.interruptPins.includes(pin)) {
        issues.push({ pin, msg: `${def.name} ${role} is on ${pinLabel(board, pin)}, which can't trigger an interrupt. On the ${board.name} use ${board.interruptPins.slice(0, 6).map(p => pinLabel(board, p)).join(', ')}.` });
      }
    }
    if (def.bus === 'i2c') {
      const [sda, scl] = board.i2cPins;
      if (s.pins.SDA === scl && s.pins.SCL === sda) issues.push({ pin: sda, msg: `${def.name} SDA and SCL are swapped. SDA goes to ${pinLabel(board, sda)}, SCL to ${pinLabel(board, scl)}.` });
      else {
        if (s.pins.SDA !== undefined && s.pins.SDA !== sda) issues.push({ pin: s.pins.SDA, msg: `${def.name} SDA has to go to ${pinLabel(board, sda)}, the board's I2C data pin.` });
        if (s.pins.SCL !== undefined && s.pins.SCL !== scl) issues.push({ pin: s.pins.SCL, msg: `${def.name} SCL has to go to ${pinLabel(board, scl)}, the board's I2C clock pin.` });
      }
    }
  }
  if (robot.sensors.filter(s => s.type === 'mpu6050').length > 1) issues.push({ msg: 'Two MPU6050s at the same address. Only one can answer on 0x68.' });
  if (robot.sensors.filter(s => s.type === 'encoder').length > 1) issues.push({ msg: 'One encoder pair is enough: it already covers both wheels.' });
  // Pixy2 talks SPI over the ICSP header, which shares pins with the board's SPI bus
  if (robot.sensors.some(s => s.type === 'camera')) {
    if (robot.sensors.filter(s => s.type === 'camera').length > 1) issues.push({ msg: 'Only one Pixy2 can use the ICSP header.' });
    for (const pin of board.spiPins) {
      const users = map.get(pin);
      if (users) {
        const u = users[0];
        const name = u.part === 'driver' ? `${driver.name} ${u.role}` : `${sensors[u.sensor.type].name} ${u.role}`;
        issues.push({ pin, msg: `The Pixy2 uses ${board.spiPins.map(p => pinLabel(board, p)).join(', ')} through the ICSP header. Move ${name} off ${pinLabel(board, pin)}.` });
      }
    }
  }
  if (board.logic === 3.3 && robot.sensors.some(s => s.type === 'hcsr04')) {
    issues.push({ soft: true, msg: 'HC-SR04 ECHO is a 5 V signal. On a real ESP32 put a voltage divider on it.' });
  }
  return issues;
}

export function motorTopSpeed(robot) {
  const m = motors[robot.motor];
  const volts = Math.max(0, batteries[robot.battery].volts - drivers[robot.driver].drop);
  return (m.rpm / 60) * Math.PI * m.wheel * Math.min(volts / 6, 1.5);
}
