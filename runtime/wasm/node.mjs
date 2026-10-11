// The scalar JS host. Manifest and imports are a compiler ABI, checked before
// module initialization. Public calls preserve the logical types wasm erases.
export class WasmInputDecline extends TypeError {
  constructor(name, why, context = 'input to') { super(`NTS5001: wasm ${context} ${name}: ${why}`); this.code = 'NTS5001'; }
}

const services = Object.freeze({ remainder: (left, right) => left % right });

function input(type, value, name) {
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
  if (manifest.abi !== 1 || manifest.host !== 'js') throw new TypeError('unsupported nts wasm host ABI');
  const module = await WebAssembly.compile(bytes, { builtins: ['js-string'] });
  const imports = WebAssembly.Module.imports(module);
  if (imports.length !== manifest.imports.length || imports.some((i, at) => i.module !== 'nts' || i.kind !== 'function' || i.name !== manifest.imports[at] || !Object.hasOwn(services, i.name))) {
    throw new WebAssembly.LinkError('nts wasm module/import manifest mismatch');
  }
  const declared = [...manifest.exports.map(e => [e.name, 'function']), ...manifest.globals.map(g => [g.symbol, 'global'])];
  if (manifest.init !== null) declared.push([manifest.init, 'function']);
  const actual = WebAssembly.Module.exports(module);
  if (new Set(declared.map(([name]) => name)).size !== declared.length || actual.length !== declared.length || declared.some(([name, kind]) => !actual.some(e => e.name === name && e.kind === kind))) {
    throw new WebAssembly.LinkError('nts wasm module/export manifest mismatch');
  }
  const instance = await WebAssembly.instantiate(module, { nts: services });
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
