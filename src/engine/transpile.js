// Turns an Arduino sketch into JavaScript that the runtime can step through.
//
// The output keeps line numbers: every transform here either works within a
// line or re-emits the newlines it consumed. User functions become generator
// functions so delay() can pause them, and every loop body yields so an
// endless while(1) can't freeze the page.

const TYPE = String.raw`(?:unsigned\s+long\s+long|unsigned\s+long|unsigned\s+int|unsigned\s+char|unsigned\s+short|long\s+long|signed\s+char|unsigned|signed|long|int|short|float|double|bool|boolean|byte|char|word|String|auto|size_t|u?int(?:8|16|32|64)_t)`;
const INT_TYPES = /^(?:unsigned|signed|long|int|short|byte|char|word|size_t|u?int\d+_t)/;

// How an assignment to each integer type is kept in range. int and
// unsigned int are 16 bits on an Uno and 32 on an ESP32, so they only
// truncate. unsigned long only truncates too: subtraction is wrapped where
// it happens (see wrapUnsignedSubtraction), which is what millis() needs.
function intWrap(type) {
  const t = type.replace(/\s+/g, ' ');
  if (/^(?:byte|uint8_t|unsigned char)$/.test(t)) return e => `(${e}) & 255`;
  if (/^(?:int8_t|signed char)$/.test(t)) return e => `(${e}) << 24 >> 24`;
  if (/^(?:int16_t|short)$/.test(t)) return e => `(${e}) << 16 >> 16`;
  if (/^(?:uint16_t|word|unsigned short)$/.test(t)) return e => `(${e}) & 65535`;
  if (/^(?:long|int32_t)$/.test(t)) return e => `(${e}) | 0`;
  // a plain char holds a one-letter string, so 'a' and s.charAt(0) compare
  if (t !== 'char' && INT_TYPES.test(t)) return e => `__int(${e})`;
  return null;
}

export const BUILTIN_GENERATORS = ['delay', 'delayMicroseconds'];

export const API_NAMES = [
  'HIGH', 'LOW', 'INPUT', 'OUTPUT', 'INPUT_PULLUP', 'LED_BUILTIN', 'true', 'false',
  'pinMode', 'digitalWrite', 'digitalRead', 'analogWrite', 'analogRead', 'pulseIn',
  'millis', 'micros', 'delay', 'delayMicroseconds', 'map', 'constrain', 'random', 'randomSeed',
  'abs', 'min', 'max', 'pow', 'sqrt', 'sq', 'sin', 'cos', 'tan', 'atan2', 'floor', 'ceil', 'round',
  'PI', 'HALF_PI', 'TWO_PI', 'DEC', 'HEX', 'BIN', 'Serial', 'Servo', 'NewPing', 'F', 'NULL',
  'bitRead', 'bitWrite', 'lowByte', 'highByte', 'tone', 'noTone', 'String', '__int', '__sizeof',
  ...Array.from({ length: 20 }, (_, i) => 'A' + i),
  'Pixy2', 'Pixy2I2C', 'Pixy2SPI_SS', 'Pixy2UART',
  'LINE_VECTOR', 'LINE_INTERSECTION', 'LINE_BARCODE', 'LINE_ALL_FEATURES', 'PIXY_RESULT_OK', 'PIXY_RESULT_ERROR',
  'CCC_SIG1', 'CCC_SIG2', 'CCC_SIG3', 'CCC_SIG4', 'CCC_SIG_ALL',
  'attachInterrupt', 'detachInterrupt', 'digitalPinToInterrupt', 'interrupts', 'noInterrupts',
  'CHANGE', 'FALLING', 'RISING', 'NOT_AN_INTERRUPT',
  'Wire', 'MPU6050', 'Adafruit_MPU6050', 'sensors_event_t',
  ...['2_G', '4_G', '8_G', '16_G', '250_DEG', '500_DEG', '1000_DEG', '2000_DEG'].map(r => 'MPU6050_RANGE_' + r),
  ...[260, 184, 94, 44, 21, 10, 5].map(hz => `MPU6050_BAND_${hz}_HZ`),
];

class TranspileError extends Error {
  constructor(message, line) { super(message); this.line = line; }
}

function lineOf(src, index) {
  let n = 1;
  for (let i = 0; i < index; i++) if (src.charCodeAt(i) === 10) n++;
  return n;
}

// Replace comments with spaces (keeping newlines) and pull string/char
// literals out into a table so later regexes can't match inside them.
function mask(src) {
  const strings = [];
  let out = '';
  let i = 0;
  while (i < src.length) {
    const c = src[i], n = src[i + 1];
    if (c === '/' && n === '/') {
      while (i < src.length && src[i] !== '\n') { out += ' '; i++; }
    } else if (c === '/' && n === '*') {
      const start = i;
      i += 2;
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i++;
      i += 2;
      out += src.slice(start, i).replace(/[^\n]/g, ' ');
    } else if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < src.length && src[j] !== c && src[j] !== '\n') j += src[j] === '\\' ? 2 : 1;
      if (src[j] !== c) throw new TranspileError(`A ${c === '"' ? 'string' : 'character'} is never closed.`, lineOf(src, i));
      strings.push(src.slice(i, j + 1));
      out += `__S${strings.length - 1}__`;
      i = j + 1;
    } else {
      out += c; i++;
    }
  }
  return { code: out, strings };
}

function matchParen(code, open) {
  let depth = 0;
  for (let i = open; i < code.length; i++) {
    if (code[i] === '(') depth++;
    else if (code[i] === ')' && --depth === 0) return i;
  }
  return -1;
}

function splitTopLevel(text) {
  const parts = [];
  let depth = 0, start = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') depth--;
    else if (c === ',' && depth === 0) { parts.push(text.slice(start, i)); start = i + 1; }
  }
  parts.push(text.slice(start));
  return parts;
}

function paramNames(params) {
  const p = params.trim();
  if (!p || p === 'void') return '';
  return splitTopLevel(p).map(part => {
    const m = part.replace(/\[[^\]]*\]/g, '').replace(/=.*$/s, '').match(/([A-Za-z_]\w*)\s*$/);
    return m ? m[1] : '_';
  }).join(', ');
}

export function transpile(source) {
  const { code: masked, strings } = mask(source);
  let code = masked;
  const libs = [];
  const userFns = new Set();
  const intVars = new Map();
  const ulongVars = new Set();

  // Preprocessor
  code = code.replace(/^[ \t]*#[ \t]*include[ \t]*[<"]?([^>"\n]*)[>"]?[^\n]*/gm, (_, lib) => { libs.push(lib.trim()); return ''; });
  code = code.replace(/^[ \t]*#[ \t]*define[ \t]+([A-Za-z_]\w*)[ \t]+([^\n]+)/gm, (_, name, value) => `const ${name} = ${value.trim().replace(/;\s*$/, '')};`);
  code = code.replace(/^[ \t]*#[ \t]*define[ \t]+([A-Za-z_]\w*)[ \t]*$/gm, (_, name) => `const ${name} = 1;`);
  code = code.replace(/^[ \t]*#[^\n]*/gm, '');

  // Literal suffixes and Arduino binary constants
  code = code.replace(/\b(\d+)(?:UL|ul|LL|ll|L|l|U|u)\b/g, '$1');
  code = code.replace(/\b(\d+\.\d*|\.\d+)[fF]\b/g, '$1');
  code = code.replace(/\bB([01]{1,8})\b/g, '0b$1');

  const unsupported = re => {
    const m = code.match(re);
    if (m) throw new TranspileError(`"${m[1]}" isn't supported in the simulator yet. Use plain variables and functions.`, lineOf(code, m.index));
  };
  unsupported(/\b(class|template|enum)\b/);

  // A C string is just a String here
  code = code.replace(/\b(?:const\s+)?char\s*\*\s*(?=[A-Za-z_])/g, 'String ');

  const structs = new Map();
  code = code.replace(/\b(typedef\s+)?struct\s+([A-Za-z_]\w*)?\s*\{([^{}]*)\}\s*([^;{}]*);/g, (whole, td, tag, body, after) => {
    const name = td ? after.trim() : tag;
    if (!/^[A-Za-z_]\w*$/.test(name || '')) return whole;
    const out = structClass(name, body, structs);
    if (!out) return whole;
    structs.set(name, out.members);
    const vars = !td && after.trim() ? ` ${name} ${after.trim()};` : '';
    return out.js + vars + whole.replace(/[^\n]/g, '');
  });
  if (structs.size) code = code.replace(new RegExp(String.raw`\bstruct\s+(?=(?:${[...structs.keys()].join('|')})\b)`, 'g'), '');
  unsupported(/\b(struct)\b/);
  const types = structs.size ? String.raw`(?:${[...structs.keys()].join('|')}|${TYPE})` : TYPE;

  const ptr = code.match(/\b(?:int|float|long|char|byte|void|double)\s*\*\s*[A-Za-z_]/);
  if (ptr) throw new TranspileError("Pointers aren't supported in the simulator. Use arrays or global variables instead.", lineOf(code, ptr.index));

  // sizeof(arr) / sizeof(arr[0]) is the usual way to count elements
  code = code.replace(/sizeof\s*\(\s*(\w+)\s*\)\s*\/\s*sizeof\s*\(\s*\1\s*\[\s*0\s*\]\s*\)/g, '$1.length');
  code = code.replace(/\bsizeof\s*\(/g, '__sizeof(');

  // Casts. ~~ binds as tightly as a C cast does.
  code = code.replace(new RegExp(String.raw`\(\s*(?:unsigned\s+)?(?:int|long|byte|short|char|word|uint8_t|int16_t|uint16_t|int32_t|uint32_t)\s*\)\s*`, 'g'), '~~');
  code = code.replace(/\(\s*(?:float|double)\s*\)\s*/g, '+');

  // Library objects
  code = code.replace(/^([ \t]*)(Servo|Pixy2|Pixy2I2C|Pixy2SPI_SS|Pixy2UART|MPU6050|Adafruit_MPU6050|sensors_event_t)[ \t]+([^;\n]+);/gm, (_, ind, cls, names) =>
    `${ind}let ${names.split(',').map(n => `${n.trim()} = new ${cls}()`).join(', ')};`);
  // mpu.getEvent(&a, &g, &temp): an & straight after ( or , can only be address-of
  code = code.replace(/([(,]\s*)&(?=\s*[A-Za-z_])/g, '$1');
  // Pixy2 hands back pointers (pixy.line.vectors->m_x1); property access does the same job here
  code = code.replace(/->/g, '.');
  code = code.replace(/^([ \t]*)NewPing[ \t]+(\w+)[ \t]*\(([^)]*)\)[ \t]*;/gm, (_, ind, name, args) => `${ind}let ${name} = new NewPing(${args});`);

  // Function definitions -> generators
  const fnDef = new RegExp(String.raw`(^|[;}\n])([ \t]*)(?:static\s+|inline\s+)*(?:void|${types})[ \t]*[*&]?[ \t]+([A-Za-z_]\w*)[ \t]*\(([^()]*)\)(\s*)(?=\{)`, 'g');
  code = code.replace(fnDef, (_, pre, ind, name, params, ws) => {
    userFns.add(name);
    return `${pre}${ind}function* ${name}(${paramNames(params)})${ws}`;
  });
  // Prototypes like "void turn(int speed);" are not needed in JS
  code = code.replace(new RegExp(String.raw`(^|\n)[ \t]*(?:void|${types})[ \t]*[*&]?[ \t]+[A-Za-z_]\w*[ \t]*\([^()]*\)[ \t]*;`, 'g'), '$1');

  // Variable declarations
  const decl = new RegExp(String.raw`(^|[;{}(\n])([ \t]*)((?:const\s+|static\s+|volatile\s+)*)(${types})(?=\s)\s+([^;]*);`, 'g');
  code = code.replace(decl, (whole, pre, ind, quals, type, body) => {
    if (/^\s*\(/.test(body)) return whole;
    const wrap = intWrap(type);
    const keyword = (/static/.test(quals) ? 'static ' : '') + (/const/.test(quals) ? 'const' : 'let');
    const items = splitTopLevel(body).map(item => {
      const m = item.match(/^(\s*)[&*]?\s*([A-Za-z_]\w*)\s*((?:\[[^\]]*\]\s*)*)(?:=([\s\S]*))?$/);
      if (!m) return item;
      const [, lead, name, dims, init] = m;
      const dimList = [...dims.matchAll(/\[([^\]]*)\]/g)].map(d => d[1].trim());
      if (wrap) intVars.set(name, wrap);
      if (/^(?:unsigned\s+long|uint32_t)$/.test(type)) ulongVars.add(name);
      if (structs.has(type)) return `${lead}${name} = ${structValue(type, dimList, init)}`;
      if (dimList.length) {
        if (init !== undefined) {
          const arr = init.replace(/\{/g, '[').replace(/\}/g, ']');
          return `${lead}${name} = ${arr.trim()}`;
        }
        return `${lead}${name} = ${zeros(dimList)}`;
      }
      if (init === undefined) return `${lead}${name} = ${defaultValue(type)}`;
      if (type === 'String') return `${lead}${name} = String(${init.trim()})`;
      return wrap ? `${lead}${name} = ${wrap(init.trim())}` : `${lead}${name} =${init}`;
    });
    return `${pre}${ind}${keyword} ${items.join(',')};`;
  });

  // Assignments to int variables (and int array elements) truncate, like they do in C
  if (intVars.size) {
    const names = [...intVars.keys()].join('|');
    const assign = new RegExp(String.raw`(?<![.\w])(${names})((?:\[[^\]]*\])*)\s*([+\-*/%]?)=(?!=)\s*([^;]*?)\s*(?=;|\)\s*\{|\)\s*$)`, 'gm');
    code = code.replace(assign, (whole, name, idx, op, expr, offset, all) => {
      if (/\b(?:let|const)\s*$/.test(all.slice(Math.max(0, offset - 8), offset))) return whole;
      if (!expr || /__int\(/.test(expr.slice(0, 6))) return whole;
      if (!balanced(expr)) return whole;
      const target = name + idx, wrap = intVars.get(name);
      return `${target} = ${wrap(op ? `${target} ${op} (${expr})` : expr)}`;
    });
  }
  code = wrapUnsignedSubtraction(code, ulongVars);
  code = hoistStatics(code);

  // Arduino String: length() is a property in JS, and trim() and friends
  // change the String in place instead of returning a new one
  code = code.replace(/\.length\s*\(\s*\)/g, '.length');
  code = code.replace(/(^|[;{})\n])(\s*)([A-Za-z_][\w.]*(?:\[[^\]]*\])?)\.(trim|toUpperCase|toLowerCase)\(\)\s*;/g, '$1$2$3 = $3.$4();');

  // Every loop body yields once per pass
  code = insertLoopYields(code);

  // Calls that may pause become yield* calls
  const pausing = new Set([...userFns, ...BUILTIN_GENERATORS]);
  code = wrapCalls(code, pausing);

  code = code.replace(/\bNULL\b/g, 'null');

  // Put strings back
  code = code.replace(/__S(\d+)__/g, (_, i) => strings[+i]);

  const header = `const {${API_NAMES.filter(n => n !== 'true' && n !== 'false').join(', ')}} = __api;`;
  const body = `${header}\n${code}\n;return { setup: typeof setup === 'function' ? setup : null, loop: typeof loop === 'function' ? loop : null };`;
  return { js: body, headerLines: 1, libs, userFns: [...userFns], intVars: [...intVars] };
}

function balanced(s) {
  let d = 0;
  for (const c of s) {
    if (c === '(') d++;
    else if (c === ')' && --d < 0) return false;
  }
  return d === 0;
}

function defaultValue(type) {
  return type === 'String' ? '""' : type === 'bool' || type === 'boolean' ? 'false' : '0';
}

function zeros(dims) {
  const size = dims[0] || '0';
  if (dims.length > 1) return `Array.from({length: ${size}}, () => new Array(${dims[1]}).fill(0))`;
  return `new Array(${size}).fill(0)`;
}

const bracesToArrays = s => s.replace(/\{/g, '[').replace(/\}/g, ']');

// struct Pid { float kp; int last; } becomes a class whose constructor takes
// the members in order, so Pid p = {1.0, 0} is new Pid(1.0, 0). int members
// go through a setter so they truncate like int variables.
function structClass(name, body, structs) {
  const known = structs.size ? String.raw`(?:${[...structs.keys()].join('|')}|${TYPE})` : TYPE;
  const member = new RegExp(String.raw`^\s*(?:const\s+|volatile\s+)*(${known})\s+([\s\S]+)$`);
  const members = [], args = [], sets = [], accessors = [];
  for (const stmt of body.split(';')) {
    if (!stmt.trim()) continue;
    const m = stmt.match(member);
    if (!m) return null;
    const type = m[1];
    for (const item of splitTopLevel(m[2])) {
      const v = item.match(/^\s*([A-Za-z_]\w*)\s*((?:\[[^\]]*\]\s*)*)(?:=([\s\S]*))?$/);
      if (!v) return null;
      const [, field, dims, init] = v;
      const dimList = [...dims.matchAll(/\[([^\]]*)\]/g)].map(d => d[1].trim());
      const arg = '$' + members.length;
      const fallback = init !== undefined ? bracesToArrays(init.trim())
        : dimList.length ? zeros(dimList) : structs.has(type) ? `new ${type}()` : defaultValue(type);
      members.push(field);
      args.push(`${arg} = ${fallback}`);
      // a nested struct can be filled from a nested brace list
      sets.push(structs.has(type) && !dimList.length ? `this.${field} = Array.isArray(${arg}) ? new ${type}(...${arg}) : ${arg};` : `this.${field} = ${arg};`);
      const wrap = !dimList.length && intWrap(type);
      if (wrap) accessors.push(`get ${field}() { return this.__${field}; } set ${field}(v) { this.__${field} = ${wrap('v')}; }`);
    }
  }
  const js = `class ${name} { constructor(${args.join(', ')}) { ${sets.join(' ')} } ${accessors.join(' ')} }`;
  return { members, js: js.replace(/\s+/g, ' ') };
}

// The value of a struct variable: Pid p; Pid p = {..}; Pid ps[3]; Pid ps[] = {{..}, {..}};
// Assigning one struct to another copies it, as in C.
function structValue(type, dims, init) {
  const one = v => v.replace(/\S[\s\S]*\S|\S/, core => core.startsWith('{')
    ? `new ${type}(${bracesToArrays(core.slice(1, -1))})`
    : `Object.assign(new ${type}(), ${core})`);
  if (!dims.length) return init === undefined ? `new ${type}()` : one(init);
  if (init === undefined) return `Array.from({length: ${dims[0] || 0}}, () => new ${type}())`;
  return init.replace(/\S[\s\S]*\S/, list => `[${splitTopLevel(list.slice(1, -1)).filter(s => s.trim()).map(one).join(',')}]`);
}

// millis() and unsigned long are 32-bit unsigned, so now - start stays right
// when millis() wraps back to 0. JS numbers don't wrap, so the difference is
// folded back into 0..2^32-1 here.
function wrapUnsignedSubtraction(code, names) {
  const operand = String.raw`(?:millis\(\)|micros\(\)|[A-Za-z_]\w*(?:\.\w+|\[[^\]]*\])*|\d+)`;
  const re = new RegExp(String.raw`(?<![\w.])(?<![-~!*/%]\s*)(${operand})\s*-\s*(${operand})(?![\w.(\[]|\s*[*/%])`, 'g');
  const unsigned = s => /^mi(?:llis|cros)\(\)$/.test(s) || names.has(s.replace(/\[.*$/, ''));
  return code.replace(re, (whole, a, b) => (unsigned(a) || unsigned(b) ? `((${a} - ${b}) >>> 0)` : whole));
}

// A static local keeps its value between calls, so the function is wrapped
// in a closure that holds it. A static outside a function is just a global.
function hoistStatics(code) {
  const fns = [...code.matchAll(/function\*\s+(\w+)\s*\([^()]*\)\s*\{/g)].reverse();
  for (const f of fns) {
    const open = f.index + f[0].length - 1;
    const close = matchBrace(code, open);
    if (close < 0) continue;
    const held = [];
    const body = code.slice(open, close + 1).replace(/\bstatic\s+((?:let|const)\s[^;]*;)/g, (_, d) => {
      held.push(d.replace(/\s+/g, ' '));
      return d.replace(/[^\n]/g, '');
    });
    if (!held.length) continue;
    code = `${code.slice(0, f.index)}const ${f[1]} = (() => { ${held.join(' ')} return ${code.slice(f.index, open)}${body}; })();${code.slice(close + 1)}`;
  }
  return code.replace(/\bstatic\s+(?=(?:let|const)\b)/g, '');
}

function matchBrace(code, open) {
  let depth = 0;
  for (let i = open; i < code.length; i++) {
    if (code[i] === '{') depth++;
    else if (code[i] === '}' && --depth === 0) return i;
  }
  return -1;
}

function insertLoopYields(code) {
  // The "while" that closes a do { } while (...) has no body of its own
  const doWhile = new Set();
  for (const d of code.matchAll(/\bdo\s*\{/g)) {
    const close = matchBrace(code, d.index + d[0].length - 1);
    const w = close < 0 ? null : code.slice(close + 1).match(/^\s*while\b/);
    if (w) doWhile.add(close + 1 + w[0].length - 5);
  }
  const re = /\b(while|for)\s*\(/g;
  const edits = [];
  let m;
  while ((m = re.exec(code))) {
    const open = code.indexOf('(', m.index);
    const close = matchParen(code, open);
    if (close < 0 || doWhile.has(m.index)) continue;
    let j = close + 1;
    while (/\s/.test(code[j] || '')) j++;
    if (code[j] === '{') {
      edits.push({ at: j + 1, text: ' yield 0;' });
    } else if (code[j] === ';') {
      edits.push({ at: j, len: 1, text: '{ yield 0; }' });
    } else {
      // single statement body: wrap up to the next top-level semicolon
      let depth = 0, k = j;
      for (; k < code.length; k++) {
        if (code[k] === '(') depth++;
        else if (code[k] === ')') depth--;
        else if (code[k] === ';' && depth === 0) break;
      }
      edits.push({ at: j, text: '{ yield 0; ' }, { at: k + 1, text: ' }' });
    }
  }
  for (const d of code.matchAll(/\bdo\s*\{/g)) edits.push({ at: d.index + d[0].length, text: ' yield 0;' });
  edits.sort((a, b) => b.at - a.at);
  for (const e of edits) code = code.slice(0, e.at) + e.text + code.slice(e.at + (e.len || 0));
  return code;
}

function wrapCalls(code, names) {
  if (!names.size) return code;
  const re = new RegExp(String.raw`(?<![.\w])(${[...names].join('|')})\s*\(`, 'g');
  const hits = [];
  let m;
  while ((m = re.exec(code))) {
    if (/function\*\s*$/.test(code.slice(Math.max(0, m.index - 12), m.index))) continue;
    hits.push(m.index);
  }
  for (let h = hits.length - 1; h >= 0; h--) {
    const start = hits[h];
    const open = code.indexOf('(', start);
    const close = matchParen(code, open);
    if (close < 0) continue;
    code = code.slice(0, start) + '(yield* ' + code.slice(start, close + 1) + ')' + code.slice(close + 1);
  }
  return code;
}

export { TranspileError };

// Compile JS from transpile() into setup/loop generator factories.
export function compile(source, api) {
  const out = transpile(source);
  let factory;
  try {
    factory = new Function('__api', out.js);
  } catch (err) {
    const e = new TranspileError(`The code doesn't compile: ${err.message}`, null);
    e.js = out.js;
    throw e;
  }
  return { ...out, program: factory(api) };
}

// Map a runtime error's stack back to a sketch line, when the engine gives one.
export function errorLine(err, headerLines = 1) {
  const m = String(err && err.stack || '').match(/<anonymous>:(\d+):\d+/);
  if (!m) return null;
  const line = +m[1] - 2 - headerLines;
  return line > 0 ? line : null;
}
