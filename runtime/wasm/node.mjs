// The JS host checks typed imports before module initialization. Public calls
// preserve logical scalar types and primitive strings at the boundary.
export class WasmInputDecline extends TypeError {
  constructor(name, why, context = 'input to') { super(`NTS5001: wasm ${context} ${name}: ${why}`); this.code = 'NTS5001'; }
}

const f64 = Object.freeze({ kind: 'f64' });
const primitiveServices = { remainder: Object.freeze({
  params: [f64, f64], result: f64, call: (left, right) => left % right,
}) };
const extern = Object.freeze({ kind: 'externref', nullable: true });
const string = Object.freeze({ kind: 'externref', nullable: false });
const i32 = Object.freeze({ kind: 'i32' });
// Capture primitive functions when the host loads, before compiled user code
// can modify globals. None of these entries accepts an arbitrary object.
const apply = Reflect.apply, number = Number;
for (const name of ['acos', 'asin', 'atan', 'cbrt', 'cos', 'cosh', 'exp', 'expm1', 'fround', 'log', 'log10', 'log1p', 'log2', 'sign', 'sin', 'sinh', 'tan', 'tanh']) {
  primitiveServices[`nts_math_${name}`] = Object.freeze({ params: [f64], result: f64, call: Math[name] });
}
for (const name of ['atan2', 'hypot', 'imul', 'pow']) {
  primitiveServices[`nts_math_${name}`] = Object.freeze({ params: [f64, f64], result: f64, call: Math[name] });
}
const numberString = Number.prototype.toString;
primitiveServices.nts_number_to_string = Object.freeze({ params: [f64], result: extern, call: value => apply(numberString, value, []) });
primitiveServices.nts_parse_float = Object.freeze({ params: [extern], result: f64, call: number.parseFloat });
primitiveServices.nts_parse_int = Object.freeze({ params: [extern, f64], result: f64, call: number.parseInt });
// This reports the supported-input contract. Source throws use the instance's
// raising state, and internal emitter failures never enter this channel.
primitiveServices.inputDecline = Object.freeze({ params: [extern], result: null,
  call: name => { throw new WasmInputDecline(name, 'internal typed value contract', 'operation in'); },
});
const services = Object.freeze(primitiveServices);
const builtins = Object.freeze({
  length: { params: [extern], result: i32 },
  charCodeAt: { params: [extern, i32], result: i32 },
  equals: { params: [extern, extern], result: i32 },
  compare: { params: [extern, extern], result: i32 },
  concat: { params: [extern, extern], result: string },
  substring: { params: [extern, i32, i32], result: string },
  fromCharCode: { params: [i32], result: string },
  fromCodePoint: { params: [i32], result: string },
});
function sameType(actual, expected) {
  return actual !== null && typeof actual === 'object'
    && Object.keys(actual).length === Object.keys(expected).length
    && Object.keys(expected).every(key => actual[key] === expected[key]);
}
function functionType(record, expected) {
  return record.kind === 'function' && Array.isArray(record.params)
    && record.params.length === expected.params.length
    && record.params.every((ty, at) => sameType(ty, expected.params[at]))
    && (expected.result === null ? record.result === null : sameType(record.result, expected.result));
}
// These known modules prove capabilities independently of the application.
// Extra compile options may be ignored; a successful compile alone is insufficient.
const gcProbe = Uint8Array.from([0,97,115,109,1,0,0,0,1,7,2,95,0,96,0,1,127,3,2,1,1,7,9,1,5,112,114,111,98,101,0,0,10,8,1,6,0,251,1,0,209,11]);
const stringProbe = Uint8Array.from([0,97,115,109,1,0,0,0,1,6,1,96,1,111,1,127,2,25,1,14,119,97,115,109,58,106,115,45,115,116,114,105,110,103,6,108,101,110,103,116,104,0,0,7,9,1,5,112,114,111,98,101,0,0]);
const capabilities = new Map();
async function capability(name) {
  if (!capabilities.has(name)) capabilities.set(name, (async () => {
    try {
      const module = await WebAssembly.compile(name === 'gc' ? gcProbe : stringProbe,
        { builtins: name === 'gc' ? [] : ['js-string'] });
      if (WebAssembly.Module.imports(module).length !== 0) throw new Error('builtin option ignored');
      const instance = new WebAssembly.Instance(module);
      if (name === 'gc' ? instance.exports.probe() !== 0 : instance.exports.probe('\ud800x') !== 2) throw new Error('probe answer');
    } catch { throw new WasmInputDecline(name, 'host capability execution probe failed', 'requires'); }
  })());
  await capabilities.get(name);
}

function input(type, value, name) {
  if (type.kind === 'string') {
    if (typeof value !== 'string') throw new WasmInputDecline(name, 'expected primitive string');
    return value;
  }
  if (type.kind === 'bool') {
    if (typeof value !== 'boolean') throw new WasmInputDecline(name, 'expected boolean');
    return Number(value);
  }
  if (typeof value !== 'number') throw new WasmInputDecline(name, 'expected number');
  if (type.kind === 'float') {
    if (type.bits === 32 && !Object.is(Math.fround(value), value)) throw new WasmInputDecline(name, 'number does not fit f32 exactly');
    return value;
  }
  if (type.kind !== 'int') throw new TypeError(`invalid scalar manifest type ${type.kind}`);
  const limit = 2 ** (type.bits - Number(type.signed));
  if (!Number.isInteger(value) || Object.is(value, -0) || value < (type.signed ? -limit : 0) || value >= limit) {
    throw new WasmInputDecline(name, `number does not fit ${type.signed ? 'i' : 'u'}${type.bits}`);
  }
  if (type.bits === 64) {
    if (!Number.isSafeInteger(value)) throw new WasmInputDecline(name, '64-bit input exceeds the safe-number boundary');
    return BigInt(value);
  }
  return value;
}

function argument(parameter, value, name) {
  const result = input(parameter.ty, value, name);
  const g = parameter.guard;
  if (g !== null && ((Number.isNaN(value) && !g.maybe_nan)
    || (Object.is(value, -0) && !g.maybe_negative_zero)
    || (g.whole && Number.isFinite(value) && !Number.isInteger(value))
    || value < bound(g.minimum)
    || value > bound(g.maximum))) {
    throw new WasmInputDecline(name, 'number violates the parameter facts used for specialization');
  }
  return result;
}

function bound(value) {
  if (typeof value === 'number') return value;
  if (value === 'Infinity') return Infinity;
  if (value === '-Infinity') return -Infinity;
  throw new TypeError('invalid numeric bound in nts wasm manifest');
}

function output(type, value, name) {
  if (type.kind === 'void') return undefined;
  if (type.kind === 'string') {
    if (typeof value !== 'string') throw new WasmInputDecline(name, 'result is outside primitive-string boundary', 'result from');
    return value;
  }
  if (type.kind === 'bool') {
    if (value !== 0 && value !== 1) throw new TypeError(`wasm ${name} returned a noncanonical boolean`);
    return value === 1;
  }
  if (type.kind === 'int' && type.bits === 64) {
    const number = Number(type.signed ? value : BigInt.asUintN(64, value));
    if (!Number.isSafeInteger(number)) throw new WasmInputDecline(name, '64-bit result exceeds the safe-number boundary', 'result from');
    return number;
  }
  if (type.kind === 'int' && !type.signed) return value >>> 0;
  return value;
}

export async function instantiate(bytes, manifest) {
  if (manifest.abi !== 2 || manifest.host !== 'js') throw new TypeError('unsupported nts wasm host ABI');
  if (![manifest.imports, manifest.builtins, manifest.constants, manifest.features].every(Array.isArray)) throw new TypeError('invalid nts wasm manifest');
  const ordinary = Object.create(null), host = Object.create(null), constants = Object.create(null);
  ordinary['nts:host/v1'] = host; ordinary['nts:constants'] = constants;
  for (const value of manifest.constants) {
    if (typeof value.symbol !== 'string' || typeof value.value !== 'string' || Object.hasOwn(constants, value.symbol)) throw new TypeError('invalid string constants');
    constants[value.symbol] = value.value;
  }
  const names = new Set();
  for (const record of manifest.imports) {
    const key = `${record.module}/${record.name}`;
    if (names.has(key)) throw new WebAssembly.LinkError('duplicate nts wasm import');
    names.add(key);
    if (record.module === 'nts:host/v1' && Object.hasOwn(services, record.name) && functionType(record, services[record.name])) host[record.name] = services[record.name].call;
    else if (!(record.module === 'nts:constants' && record.kind === 'global' && record.mutable === false && sameType(record.ty, extern) && Object.hasOwn(constants, record.name))) throw new WebAssembly.LinkError('nts wasm host import type mismatch');
  }
  if (manifest.constants.length !== manifest.imports.filter(i => i.module === 'nts:constants').length) throw new WebAssembly.LinkError('unused nts wasm string constant');
  for (const record of manifest.builtins) {
    const key = `${record.module}/${record.name}`;
    if (names.has(key) || record.module !== 'wasm:js-string' || !Object.hasOwn(builtins, record.name) || !functionType(record, builtins[record.name])) throw new WebAssembly.LinkError('nts wasm builtin type mismatch');
    names.add(key);
  }
  for (const feature of manifest.features) {
    if (feature !== 'gc') throw new WasmInputDecline(feature, 'unsupported required capability', 'requires');
    await capability(feature);
  }
  if (manifest.builtins.length) await capability('js-string');
  const module = await WebAssembly.compile(bytes, { builtins: manifest.builtins.length ? ['js-string'] : [] });
  const imports = WebAssembly.Module.imports(module);
  if (imports.length !== manifest.imports.length || imports.some((i, at) => {
    const record = manifest.imports[at]; return i.module !== record.module || i.name !== record.name || i.kind !== record.kind;
  })) throw new WebAssembly.LinkError('nts wasm module/import manifest mismatch');
  const declared = [...manifest.exports.map(e => [e.name, 'function']), ...manifest.globals.map(g => [g.symbol, 'global'])];
  if (manifest.init !== null) declared.push([manifest.init, 'function']);
  const actual = WebAssembly.Module.exports(module);
  if (new Set(declared.map(([name]) => name)).size !== declared.length || actual.length !== declared.length || declared.some(([name, kind]) => !actual.some(e => e.name === name && e.kind === kind))) {
    throw new WebAssembly.LinkError('nts wasm module/export manifest mismatch');
  }
  const instance = await WebAssembly.instantiate(module, ordinary);
  const namespace = Object.create(null);
  for (const e of manifest.exports) {
    const fn = instance.exports[e.name];
    Object.defineProperty(namespace, e.name, { enumerable: true, value: (...args) => {
      if (args.length !== e.params.length) throw new WasmInputDecline(e.name, `expected ${e.params.length} arguments`);
      return output(e.result, fn(...args.map((v, i) => argument(e.params[i], v, e.name))), e.name);
    } });
  }
  for (const g of manifest.globals) {
    Object.defineProperty(namespace, g.name, { enumerable: true, get: () => output(g.ty, instance.exports[g.symbol].value, g.name) });
  }
  if (manifest.init !== null) instance.exports[manifest.init]();
  return Object.freeze(namespace);
}

export async function load(moduleUrl, manifestUrl = new URL('program.json', moduleUrl)) {
  const { readFile } = await import('node:fs/promises');
  const [bytes, text] = await Promise.all([readFile(moduleUrl), readFile(manifestUrl, 'utf8')]);
  return instantiate(bytes, JSON.parse(text));
}
