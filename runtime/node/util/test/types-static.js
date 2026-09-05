'use strict';

// Supported same-realm brands retained from pinned Node v24.20.0
// parallel/test-util-types.js. That file also requires V8 external/Proxy and
// iterator/function brands, realms, forged prototypes, legacy arguments, and
// ToObject-boxed Symbol/BigInt values.
const assert = require('assert');
const { types } = require('util');

assert.strictEqual(types.isDate(new Date()), true);
assert.strictEqual(types.isRegExp(/value/), true);
assert.strictEqual(types.isNativeError(new TypeError('value')), true);
assert.strictEqual(types.isPromise(Promise.resolve(1)), true);
assert.strictEqual(types.isMap(new Map()), true);
assert.strictEqual(types.isSet(new Set()), true);
assert.strictEqual(types.isWeakMap(new WeakMap()), true);
assert.strictEqual(types.isWeakSet(new WeakSet()), true);

const arrayBuffer = new ArrayBuffer(16);
assert.strictEqual(types.isArrayBuffer(arrayBuffer), true);
assert.strictEqual(types.isAnyArrayBuffer(arrayBuffer), true);
assert.strictEqual(types.isDataView(new DataView(arrayBuffer)), true);
assert.strictEqual(types.isArrayBufferView(new DataView(arrayBuffer)), true);

for (const value of [
  new Uint8Array(),
  new Uint8ClampedArray(),
  new Uint16Array(),
  new Uint32Array(),
  new Int8Array(),
  new Int16Array(),
  new Int32Array(),
  new Float32Array(),
  new Float64Array(),
  new BigInt64Array(),
  new BigUint64Array(),
]) {
  assert.strictEqual(types.isTypedArray(value), true);
  assert.strictEqual(types.isArrayBufferView(value), true);
}

assert.strictEqual(types.isUint8Array(new Uint8Array()), true);
assert.strictEqual(types.isUint8ClampedArray(new Uint8ClampedArray()), true);
assert.strictEqual(types.isUint16Array(new Uint16Array()), true);
assert.strictEqual(types.isUint32Array(new Uint32Array()), true);
assert.strictEqual(types.isInt8Array(new Int8Array()), true);
assert.strictEqual(types.isInt16Array(new Int16Array()), true);
assert.strictEqual(types.isInt32Array(new Int32Array()), true);
assert.strictEqual(types.isFloat32Array(new Float32Array()), true);
assert.strictEqual(types.isFloat64Array(new Float64Array()), true);
assert.strictEqual(types.isBigInt64Array(new BigInt64Array()), true);
assert.strictEqual(types.isBigUint64Array(new BigUint64Array()), true);

assert.strictEqual(types.isStringObject(new String('value')), true);
assert.strictEqual(types.isNumberObject(new Number(1)), true);
assert.strictEqual(types.isBooleanObject(new Boolean(true)), true);
assert.strictEqual(types.isBoxedPrimitive(new String('value')), true);
assert.strictEqual(types.isBoxedPrimitive(new Number(1)), true);
assert.strictEqual(types.isBoxedPrimitive(new Boolean(true)), true);

assert.strictEqual(types.isDate({}), false);
assert.strictEqual(types.isMap(new Set()), false);
assert.strictEqual(types.isTypedArray(new DataView(arrayBuffer)), false);
assert.strictEqual(types.isGeneratorObject({ next() {}, throw() {} }), false);
assert.strictEqual(types.isProxy({}), false);
