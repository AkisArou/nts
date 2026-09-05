// `util.types`, node `lib/internal/util/types.js`.
//
// Node answers these through V8's internal type tags. NTS has one statically
// known class for each supported kind, so ordinary nominal checks are the
// matching operation. Cross-realm and forged-prototype recognition belongs to
// the engine metaobject model and is intentionally not approximated here.

export function isDate(value: unknown): value is Date {
  return value instanceof Date;
}

export function isMap(value: unknown): value is Map<unknown, unknown> {
  return value instanceof Map;
}

export function isSet(value: unknown): value is Set<unknown> {
  return value instanceof Set;
}

export function isWeakMap(value: unknown): value is WeakMap<object, unknown> {
  return value instanceof WeakMap;
}

export function isWeakSet(value: unknown): value is WeakSet<object> {
  return value instanceof WeakSet;
}

export function isRegExp(value: unknown): value is RegExp {
  return value instanceof RegExp;
}

export function isPromise(value: unknown): value is Promise<unknown> {
  return value instanceof Promise;
}

export function isNativeError(value: unknown): value is Error {
  return value instanceof Error;
}

export function isArrayBuffer(value: unknown): value is ArrayBuffer {
  return value instanceof ArrayBuffer;
}

export function isSharedArrayBuffer(value: unknown): value is SharedArrayBuffer {
  return typeof SharedArrayBuffer === "function" && value instanceof SharedArrayBuffer;
}

export function isAnyArrayBuffer(value: unknown): value is ArrayBuffer | SharedArrayBuffer {
  return isArrayBuffer(value) || isSharedArrayBuffer(value);
}

export function isArrayBufferView(value: unknown): value is ArrayBufferView {
  return ArrayBuffer.isView(value);
}

export function isDataView(value: unknown): value is DataView {
  return value instanceof DataView;
}

export type TypedArray =
  | Uint8Array | Uint8ClampedArray | Uint16Array | Uint32Array
  | Int8Array | Int16Array | Int32Array
  | Float16Array | Float32Array | Float64Array
  | BigInt64Array | BigUint64Array;

export function isTypedArray(value: unknown): value is TypedArray {
  return ArrayBuffer.isView(value) && !(value instanceof DataView);
}

export function isUint8Array(value: unknown): value is Uint8Array { return value instanceof Uint8Array; }
export function isUint8ClampedArray(value: unknown): value is Uint8ClampedArray { return value instanceof Uint8ClampedArray; }
export function isUint16Array(value: unknown): value is Uint16Array { return value instanceof Uint16Array; }
export function isUint32Array(value: unknown): value is Uint32Array { return value instanceof Uint32Array; }
export function isInt8Array(value: unknown): value is Int8Array { return value instanceof Int8Array; }
export function isInt16Array(value: unknown): value is Int16Array { return value instanceof Int16Array; }
export function isInt32Array(value: unknown): value is Int32Array { return value instanceof Int32Array; }
export function isFloat16Array(value: unknown): value is Float16Array { return value instanceof Float16Array; }
export function isFloat32Array(value: unknown): value is Float32Array { return value instanceof Float32Array; }
export function isFloat64Array(value: unknown): value is Float64Array { return value instanceof Float64Array; }
export function isBigInt64Array(value: unknown): value is BigInt64Array { return value instanceof BigInt64Array; }
export function isBigUint64Array(value: unknown): value is BigUint64Array { return value instanceof BigUint64Array; }

/** Primitive wrappers supported by the ordinary same-realm class model. */
export function isStringObject(value: unknown): value is String {
  return value instanceof String;
}

export function isNumberObject(value: unknown): value is Number {
  return value instanceof Number;
}

export function isBooleanObject(value: unknown): value is Boolean {
  return value instanceof Boolean;
}

export function isSymbolObject(_value: unknown): boolean {
  return false;
}

export function isBigIntObject(_value: unknown): boolean {
  return false;
}

export type BoxedPrimitive = String | Number | Boolean;

export function isBoxedPrimitive(value: unknown): value is BoxedPrimitive {
  return (
    isStringObject(value) || isNumberObject(value) || isBooleanObject(value) ||
    isSymbolObject(value) || isBigIntObject(value)
  );
}

export function isGeneratorFunction(_value: unknown): _value is GeneratorFunction {
  // Generators are supported language values. What is missing here is a
  // runtime function-kind tag that survives after a function becomes an
  // erased value; source text or constructor/prototype inspection is not an
  // acceptable substitute.
  return false;
}

export function isAsyncFunction(_value: unknown): boolean {
  // Async functions are supported. This predicate needs the same erased
  // function-kind tag as `isGeneratorFunction`.
  return false;
}

export function isGeneratorObject(_value: unknown): _value is Generator {
  // `next` and `throw` only describe a structural iterator. Node asks V8 for
  // the generator brand, so accepting an arbitrary object with those methods
  // would be a false positive. The compiler needs a typed generator-kind test
  // before this can answer true honestly.
  return false;
}

export function isArgumentsObject(_value: unknown): boolean {
  return false;
}

export function isMapIterator(_value: unknown): boolean {
  // Iteration itself is supported. Recognizing the origin of an erased
  // iterator needs a runtime kind tag; inspecting its shape would accept user
  // iterators incorrectly.
  return false;
}

export function isSetIterator(_value: unknown): boolean {
  // See `isMapIterator`: this is a kind-observation gap, not an iteration
  // non-goal.
  return false;
}

export function isModuleNamespaceObject(_value: unknown): boolean {
  return false;
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
