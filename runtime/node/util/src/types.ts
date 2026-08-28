// `util.types`, node `lib/internal/util/types.js`.
//
// Node answers these from V8's own object model through
// `internalBinding('types')`, which can tell a `Date` from an object that has
// been given a `Date` prototype. Here each is a brand check: call the method
// the type owns and see whether it throws. That is what every runtime without
// engine introspection does, and it is exactly as accurate for real values --
// it differs only for a deliberately forged one.

function brand(value: unknown, probe: (v: never) => unknown): boolean {
  if (value === null || typeof value !== "object") {
    return false;
  }
  try {
    probe(value as never);
    return true;
  } catch {
    return false;
  }
}

const dateGetTime = Date.prototype.getTime;
const mapSize = Object.getOwnPropertyDescriptor(Map.prototype, "size")!.get!;
const setSize = Object.getOwnPropertyDescriptor(Set.prototype, "size")!.get!;
const regexpSource = Object.getOwnPropertyDescriptor(RegExp.prototype, "source")!.get!;
const weakMapHas = WeakMap.prototype.has;
const weakSetHas = WeakSet.prototype.has;
const promiseThen = Promise.prototype.then;

export function isDate(value: unknown): value is Date {
  return brand(value, (v) => dateGetTime.call(v));
}

export function isMap(value: unknown): value is Map<unknown, unknown> {
  return brand(value, (v) => mapSize.call(v));
}

export function isSet(value: unknown): value is Set<unknown> {
  return brand(value, (v) => setSize.call(v));
}

export function isWeakMap(value: unknown): value is WeakMap<object, unknown> {
  return brand(value, (v) => weakMapHas.call(v, weakMapHas));
}

export function isWeakSet(value: unknown): value is WeakSet<object> {
  return brand(value, (v) => weakSetHas.call(v, weakSetHas));
}

export function isRegExp(value: unknown): value is RegExp {
  return brand(value, (v) => regexpSource.call(v));
}

export function isPromise(value: unknown): value is Promise<unknown> {
  // `then` on a non-promise throws; on a promise it returns one, which is
  // discarded. Attaching handlers that do nothing avoids turning a rejection
  // into an unhandled one just by asking what type this is.
  return brand(value, (v) => {
    promiseThen.call(v, () => {}, () => {});
  });
}

export function isNativeError(value: unknown): value is Error {
  return value instanceof Error;
}

export function isArrayBuffer(value: unknown): value is ArrayBuffer {
  return value instanceof ArrayBuffer;
}

export function isSharedArrayBuffer(value: unknown): boolean {
  return typeof SharedArrayBuffer === "function" && value instanceof SharedArrayBuffer;
}

export function isAnyArrayBuffer(value: unknown): boolean {
  return isArrayBuffer(value) || isSharedArrayBuffer(value);
}

export function isArrayBufferView(value: unknown): value is ArrayBufferView {
  return ArrayBuffer.isView(value);
}

export function isDataView(value: unknown): value is DataView {
  return value instanceof DataView;
}

export function isTypedArray(value: unknown): boolean {
  return ArrayBuffer.isView(value) && !(value instanceof DataView);
}

/** One predicate per typed-array kind, from its constructor name. */
function isKind(name: string) {
  return (value: unknown): boolean =>
    isTypedArray(value) && (value as object).constructor?.name === name;
}

export const isUint8Array = isKind("Uint8Array");
export const isUint8ClampedArray = isKind("Uint8ClampedArray");
export const isUint16Array = isKind("Uint16Array");
export const isUint32Array = isKind("Uint32Array");
export const isInt8Array = isKind("Int8Array");
export const isInt16Array = isKind("Int16Array");
export const isInt32Array = isKind("Int32Array");
export const isFloat32Array = isKind("Float32Array");
export const isFloat64Array = isKind("Float64Array");
export const isBigInt64Array = isKind("BigInt64Array");
export const isBigUint64Array = isKind("BigUint64Array");

/** A primitive in an object wrapper: `new String('x')`, not `'x'`. */
function isBoxed(value: unknown, probe: (v: never) => unknown): boolean {
  return brand(value, probe);
}

export function isStringObject(value: unknown): boolean {
  return isBoxed(value, (v) => String.prototype.valueOf.call(v));
}

export function isNumberObject(value: unknown): boolean {
  return isBoxed(value, (v) => Number.prototype.valueOf.call(v));
}

export function isBooleanObject(value: unknown): boolean {
  return isBoxed(value, (v) => Boolean.prototype.valueOf.call(v));
}

export function isSymbolObject(value: unknown): boolean {
  return isBoxed(value, (v) => Symbol.prototype.valueOf.call(v));
}

export function isBigIntObject(value: unknown): boolean {
  return isBoxed(value, (v) => BigInt.prototype.valueOf.call(v));
}

export function isBoxedPrimitive(value: unknown): boolean {
  return (
    isStringObject(value) || isNumberObject(value) || isBooleanObject(value) ||
    isSymbolObject(value) || isBigIntObject(value)
  );
}

export function isGeneratorFunction(value: unknown): boolean {
  return typeof value === "function" && value.constructor?.name === "GeneratorFunction";
}

export function isAsyncFunction(value: unknown): boolean {
  return typeof value === "function" && value.constructor?.name === "AsyncFunction";
}

export function isGeneratorObject(value: unknown): boolean {
  return (
    value !== null && typeof value === "object" &&
    typeof (value as { next?: unknown }).next === "function" &&
    typeof (value as { throw?: unknown }).throw === "function"
  );
}

export function isArgumentsObject(value: unknown): boolean {
  return Object.prototype.toString.call(value) === "[object Arguments]";
}

export function isMapIterator(value: unknown): boolean {
  return Object.prototype.toString.call(value) === "[object Map Iterator]";
}

export function isSetIterator(value: unknown): boolean {
  return Object.prototype.toString.call(value) === "[object Set Iterator]";
}

export function isModuleNamespaceObject(value: unknown): boolean {
  return Object.prototype.toString.call(value) === "[object Module]";
}

// These need V8's own view of the heap and have no observable brand: a `Proxy`
// is by design indistinguishable from its target, and an external pointer is
// not reachable from JavaScript at all. Answering `false` is the honest
// approximation -- claiming to detect them would be worse.
export function isProxy(_value: unknown): boolean {
  return false;
}

export function isExternal(_value: unknown): boolean {
  return false;
}

export function isCryptoKey(_value: unknown): boolean {
  return false;
}

export function isKeyObject(_value: unknown): boolean {
  return false;
}
