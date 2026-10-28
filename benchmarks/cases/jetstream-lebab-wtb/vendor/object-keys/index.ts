// Exact module body from JetStream 3.0 ./node_modules/object-keys/index.js.
// Dependencies are loaded at the original call sites; the cached export object is retained.
import {webpack, isRecord, record, runtimeProperty, runtimeConstructor} from "../../webpack.ts";
import {load as load0} from "./isArguments.ts";
import {load as load1} from "./implementation.ts";

import type {ShimObjectKeys} from "../../shim-types.ts";
import {callableValue, present, stringValue, numberValue, stringArray, numericRelationalValue, concatenatedString} from "../lodash/runtime.ts";
import type {LodashCallable} from "../lodash/runtime.ts";
function isKeysRoutine(value: unknown): value is (value: unknown) => string[] { return typeof value === "function"; }
function keysRoutine(value: unknown): (value: unknown) => string[] {
 if (!isKeysRoutine(value)) throw new TypeError("Expected the original Object.keys callable");
 return value;
}
let cache: {exports: unknown} | undefined;
export function load(): ReturnType<typeof initialize> {
 if (cache !== undefined) {
  const value = cache.exports;
  if (!isExport(value)) throw new TypeError("Unexpected cached export for object-keys/index.js");
  return value;
 }
 return initialize();
}
function isExport(value: unknown): value is ReturnType<typeof initialize> {
 return typeof value === "function" && typeof record(value).shim === "function";
}
function initialize(): ShimObjectKeys {
let module: { exports: unknown; paths?: string[]; children?: unknown[] } = {exports: {}};
const exports = module.exports;
cache = module;


"use strict";


var slice = Array.prototype.slice;
var isArgs = load0();

var origKeys = Object.keys;
var keysShim: ((value: unknown) => string[]) & {shim?: () => (value: unknown) => string[]} = origKeys ? function keys(o: unknown) { return stringArray(callableValue(origKeys)(o)); } : present(load1());

var originalKeys = Object.keys;

keysShim.shim = function shimObjectKeys() {
	if (Object.keys) {
		var keysWorksWithArguments = (callableValue(function () {
			// Safari 5.0 bug
			var args = Object.keys(arguments);
			return args && args.length === arguments.length;
		})(1, 2));
		if (!keysWorksWithArguments) {
			Object.keys = function keys(object: unknown) { // eslint-disable-line func-name-matching
				if (isArgs(object)) {
					return originalKeys(slice.call(object));
				}
				return stringArray(callableValue(originalKeys)(object));
			};
		}
	} else {
		Object.keys = keysShim;
	}
	return keysRoutine(Object.keys || keysShim);
};

module.exports = keysShim;


/***/ 
const completed = module.exports;
if (!isExport(completed)) throw new TypeError("Unexpected completed shim export");
return completed;
}
