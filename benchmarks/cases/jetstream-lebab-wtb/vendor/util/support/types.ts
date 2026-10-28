// Exact module body from JetStream 3.0 ./node_modules/util/support/types.js.
// Dependencies are loaded at the original call sites; the cached export object is retained.
import {webpack, isRecord, record, runtimeConstructor} from "../../../webpack.ts";
import {load as load0} from "../../is-arguments/index.ts";
import {load as load1} from "../../is-generator-function/index.ts";
import {load as load2} from "../../which-typed-array/index.ts";
import {load as load3} from "../../is-typed-array/index.ts";

import type {ShimUtilSupportTypes} from "../../../shim-types.ts";
import {callableValue, present} from "../../lodash/runtime.ts";
import type {LodashCallable} from "../../lodash/runtime.ts";

let cache: {exports: unknown} | undefined;
export function load(): ReturnType<typeof initialize> {
 if (cache !== undefined) {
  const value = cache.exports;
  if (!isExport(value)) throw new TypeError("Unexpected cached export for util/support/types.js");
  return value;
 }
 return initialize();
}
function isExport(value: unknown): value is ReturnType<typeof initialize> {
 return isRecord(value) && ["isArgumentsObject","isGeneratorFunction","isTypedArray","isPromise","isArrayBufferView","isUint8Array","isUint8ClampedArray","isUint16Array","isUint32Array","isInt8Array","isInt16Array","isInt32Array","isFloat32Array","isFloat64Array","isBigInt64Array","isBigUint64Array","isMap","isSet","isWeakMap","isWeakSet","isArrayBuffer","isDataView","isSharedArrayBuffer","isAsyncFunction","isMapIterator","isSetIterator","isGeneratorObject","isWebAssemblyCompiledModule","isNumberObject","isStringObject","isBooleanObject","isBigIntObject","isSymbolObject","isBoxedPrimitive","isAnyArrayBuffer","isProxy","isExternal","isModuleNamespaceObject"].every(key => typeof value[key] === "function");
}
function initialize(): ShimUtilSupportTypes {
const exports: Partial<ShimUtilSupportTypes> = {};
let module = {exports};
cache = module;


"use strict";
// Currently in sync with Node.js lib/internal/util/types.js
// https://github.com/nodejs/node/commit/112cc7c27551254aa2b17098fb774867f05ed0d9



var isArgumentsObject = load0();
var isGeneratorFunction = load1();
var whichTypedArray = load2();
var isTypedArray = load3();

function uncurryThis(f: unknown): LodashCallable {
  return callableValue(callableValue(f).call.bind(f));
}

var BigIntSupported = typeof BigInt !== 'undefined';
var SymbolSupported = typeof Symbol !== 'undefined';

var ObjectToString = uncurryThis(Object.prototype.toString);

var numberValue = uncurryThis(Number.prototype.valueOf);
var stringValue = uncurryThis(String.prototype.valueOf);
var booleanValue = uncurryThis(Boolean.prototype.valueOf);

if (BigIntSupported) {
  var bigIntValue = uncurryThis(BigInt.prototype.valueOf);
}

if (SymbolSupported) {
  var symbolValue = uncurryThis(Symbol.prototype.valueOf);
}

function checkBoxedPrimitive(value: unknown, prototypeValueOf: LodashCallable | undefined) {
  if (typeof value !== 'object') {
    return false;
  }
  try {
    callableValue(prototypeValueOf)(value);
    return true;
  } catch(e) {
    return false;
  }
}

exports.isArgumentsObject = isArgumentsObject;
exports.isGeneratorFunction = isGeneratorFunction;
exports.isTypedArray = isTypedArray;

// Taken from here and modified for better browser support
// https://github.com/sindresorhus/p-is-promise/blob/cda35a513bda03f977ad5cde3a079d237e82d7ef/index.js
function isPromise(input: unknown): input is Promise<unknown> {
	return (
		(
			typeof Promise !== 'undefined' &&
			input instanceof Promise
		) ||
		(
			input !== null &&
			typeof input === 'object' &&
			typeof record(input).then === 'function' &&
			typeof record(input).catch === 'function'
		)
	);
}
exports.isPromise = isPromise;

function isArrayBufferView(value: unknown): value is ArrayBufferView<ArrayBufferLike> {
  if (typeof ArrayBuffer !== 'undefined' && ArrayBuffer.isView) {
    return ArrayBuffer.isView(value);
  }

  return (
    isTypedArray(value) ||
    isDataView(value)
  );
}
exports.isArrayBufferView = isArrayBufferView;


function isUint8Array(value: unknown): value is Uint8Array<ArrayBufferLike> {
  return whichTypedArray(value) === 'Uint8Array';
}
exports.isUint8Array = isUint8Array;

function isUint8ClampedArray(value: unknown): value is Uint8ClampedArray<ArrayBufferLike> {
  return whichTypedArray(value) === 'Uint8ClampedArray';
}
exports.isUint8ClampedArray = isUint8ClampedArray;

function isUint16Array(value: unknown): value is Uint16Array<ArrayBufferLike> {
  return whichTypedArray(value) === 'Uint16Array';
}
exports.isUint16Array = isUint16Array;

function isUint32Array(value: unknown): value is Uint32Array<ArrayBufferLike> {
  return whichTypedArray(value) === 'Uint32Array';
}
exports.isUint32Array = isUint32Array;

function isInt8Array(value: unknown): value is Int8Array<ArrayBufferLike> {
  return whichTypedArray(value) === 'Int8Array';
}
exports.isInt8Array = isInt8Array;

function isInt16Array(value: unknown): value is Int16Array<ArrayBufferLike> {
  return whichTypedArray(value) === 'Int16Array';
}
exports.isInt16Array = isInt16Array;

function isInt32Array(value: unknown): value is Int32Array<ArrayBufferLike> {
  return whichTypedArray(value) === 'Int32Array';
}
exports.isInt32Array = isInt32Array;

function isFloat32Array(value: unknown): value is Float32Array<ArrayBufferLike> {
  return whichTypedArray(value) === 'Float32Array';
}
exports.isFloat32Array = isFloat32Array;

function isFloat64Array(value: unknown): value is Float64Array<ArrayBufferLike> {
  return whichTypedArray(value) === 'Float64Array';
}
exports.isFloat64Array = isFloat64Array;

function isBigInt64Array(value: unknown): value is BigInt64Array<ArrayBufferLike> {
  return whichTypedArray(value) === 'BigInt64Array';
}
exports.isBigInt64Array = isBigInt64Array;

function isBigUint64Array(value: unknown): value is BigUint64Array<ArrayBufferLike> {
  return whichTypedArray(value) === 'BigUint64Array';
}
exports.isBigUint64Array = isBigUint64Array;

function isMapToString(value: unknown) {
  return ObjectToString(value) === '[object Map]';
}
isMapToString.working = (
  typeof Map !== 'undefined' &&
  isMapToString(new Map<unknown, unknown>())
);

function isMap(value: unknown): value is Map<unknown, unknown> {
  if (typeof Map === 'undefined') {
    return false;
  }

  return isMapToString.working
    ? isMapToString(value)
    : value instanceof Map;
}
exports.isMap = isMap;

function isSetToString(value: unknown) {
  return ObjectToString(value) === '[object Set]';
}
isSetToString.working = (
  typeof Set !== 'undefined' &&
  isSetToString(new Set<unknown>())
);
function isSet(value: unknown): value is Set<unknown> {
  if (typeof Set === 'undefined') {
    return false;
  }

  return isSetToString.working
    ? isSetToString(value)
    : value instanceof Set;
}
exports.isSet = isSet;

function isWeakMapToString(value: unknown) {
  return ObjectToString(value) === '[object WeakMap]';
}
isWeakMapToString.working = (
  typeof WeakMap !== 'undefined' &&
  isWeakMapToString(new WeakMap<WeakKey, unknown>())
);
function isWeakMap(value: unknown): value is WeakMap<WeakKey, unknown> {
  if (typeof WeakMap === 'undefined') {
    return false;
  }

  return isWeakMapToString.working
    ? isWeakMapToString(value)
    : value instanceof WeakMap;
}
exports.isWeakMap = isWeakMap;

function isWeakSetToString(value: unknown) {
  return ObjectToString(value) === '[object WeakSet]';
}
isWeakSetToString.working = (
  typeof WeakSet !== 'undefined' &&
  isWeakSetToString(new WeakSet<WeakKey>())
);
function isWeakSet(value: unknown): value is WeakSet<WeakKey> {
  return isWeakSetToString(value);
}
exports.isWeakSet = isWeakSet;

function isArrayBufferToString(value: unknown) {
  return ObjectToString(value) === '[object ArrayBuffer]';
}
isArrayBufferToString.working = (
  typeof ArrayBuffer !== 'undefined' &&
  isArrayBufferToString(new (runtimeConstructor(ArrayBuffer))())
);
function isArrayBuffer(value: unknown): value is ArrayBuffer {
  if (typeof ArrayBuffer === 'undefined') {
    return false;
  }

  return isArrayBufferToString.working
    ? isArrayBufferToString(value)
    : value instanceof ArrayBuffer;
}
exports.isArrayBuffer = isArrayBuffer;

function isDataViewToString(value: unknown) {
  return ObjectToString(value) === '[object DataView]';
}
isDataViewToString.working = (
  typeof ArrayBuffer !== 'undefined' &&
  typeof DataView !== 'undefined' &&
  isDataViewToString(new DataView(new ArrayBuffer(1), 0, 1))
);
function isDataView(value: unknown): value is DataView<ArrayBufferLike> {
  if (typeof DataView === 'undefined') {
    return false;
  }

  return isDataViewToString.working
    ? isDataViewToString(value)
    : value instanceof DataView;
}
exports.isDataView = isDataView;

// Store a copy of SharedArrayBuffer in case it's deleted elsewhere
var SharedArrayBufferCopy = typeof SharedArrayBuffer !== 'undefined' ? SharedArrayBuffer : undefined;
function isSharedArrayBufferToString(value: unknown) {
  return ObjectToString(value) === '[object SharedArrayBuffer]';
}
function isSharedArrayBuffer(value: unknown): value is SharedArrayBuffer {
  if (typeof SharedArrayBufferCopy === 'undefined') {
    return false;
  }

  if (typeof record(isSharedArrayBufferToString).working === 'undefined') {
    record(isSharedArrayBufferToString).working = isSharedArrayBufferToString(new (runtimeConstructor(SharedArrayBufferCopy))());
  }

  return record(isSharedArrayBufferToString).working
    ? isSharedArrayBufferToString(value)
    : value instanceof SharedArrayBufferCopy;
}
exports.isSharedArrayBuffer = isSharedArrayBuffer;

function isAsyncFunction(value: unknown) {
  return ObjectToString(value) === '[object AsyncFunction]';
}
exports.isAsyncFunction = isAsyncFunction;

function isMapIterator(value: unknown) {
  return ObjectToString(value) === '[object Map Iterator]';
}
exports.isMapIterator = isMapIterator;

function isSetIterator(value: unknown) {
  return ObjectToString(value) === '[object Set Iterator]';
}
exports.isSetIterator = isSetIterator;

function isGeneratorObject(value: unknown) {
  return ObjectToString(value) === '[object Generator]';
}
exports.isGeneratorObject = isGeneratorObject;

function isWebAssemblyCompiledModule(value: unknown) {
  return ObjectToString(value) === '[object WebAssembly.Module]';
}
exports.isWebAssemblyCompiledModule = isWebAssemblyCompiledModule;

function isNumberObject(value: unknown): value is Number {
  return checkBoxedPrimitive(value, numberValue);
}
exports.isNumberObject = isNumberObject;

function isStringObject(value: unknown): value is String {
  return checkBoxedPrimitive(value, stringValue);
}
exports.isStringObject = isStringObject;

function isBooleanObject(value: unknown): value is Boolean {
  return checkBoxedPrimitive(value, booleanValue);
}
exports.isBooleanObject = isBooleanObject;

function isBigIntObject(value: unknown): value is BigInt {
  return BigIntSupported && checkBoxedPrimitive(value, bigIntValue);
}
exports.isBigIntObject = isBigIntObject;

function isSymbolObject(value: unknown): value is Symbol {
  return SymbolSupported && checkBoxedPrimitive(value, symbolValue);
}
exports.isSymbolObject = isSymbolObject;

function isBoxedPrimitive(value: unknown): value is Number | String | Boolean | BigInt | Symbol {
  return (
    isNumberObject(value) ||
    isStringObject(value) ||
    isBooleanObject(value) ||
    isBigIntObject(value) ||
    isSymbolObject(value)
  );
}
exports.isBoxedPrimitive = isBoxedPrimitive;

function isAnyArrayBuffer(value: unknown): value is ArrayBufferLike {
  return typeof Uint8Array !== 'undefined' && (
    isArrayBuffer(value) ||
    isSharedArrayBuffer(value)
  );
}
exports.isAnyArrayBuffer = isAnyArrayBuffer;

['isProxy', 'isExternal', 'isModuleNamespaceObject'].forEach(function(method) {
  Object.defineProperty(exports, method, {
    enumerable: false,
    value: function() {
      throw new Error(method + ' is not supported in userland');
    }
  });
});


/***/ 
if (!isExport(exports)) throw new TypeError("Unexpected completed util type exports");
return exports;
}
