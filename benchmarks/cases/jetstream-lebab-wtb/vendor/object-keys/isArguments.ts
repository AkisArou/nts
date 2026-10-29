// Exact module body from JetStream 3.0 ./node_modules/object-keys/isArguments.js.
// Dependencies are loaded at the original call sites; the cached export object is retained.
import {webpack, isRecord, record, runtimeProperty, runtimeConstructor} from "../../webpack.ts";


import {callableValue, present, stringValue, numberValue, stringArray, numericRelationalValue, concatenatedString} from "../lodash/runtime.ts";
import type {LodashCallable} from "../lodash/runtime.ts";
let cache: {exports: unknown} | undefined;
export function load(): ReturnType<typeof initialize> {
 if (cache !== undefined) {
  const value = cache.exports;
  if (!isExport(value)) throw new TypeError("Unexpected cached export for object-keys/isArguments.js");
  return value;
 }
 return initialize();
}
function isExport(value: unknown): value is ReturnType<typeof initialize> {
 return typeof value === "function";
}
function initialize(): (value: unknown) => boolean {
let module: { exports: unknown; paths?: string[]; children?: unknown[] } = {exports: {}};
const exports = module.exports;
cache = module;


"use strict";


var toStr = Object.prototype.toString;

module.exports = function isArguments(value: unknown) {
	var str = toStr.call(value);
	var isArgs = str === '[object Arguments]';
	if (!isArgs) {
		isArgs = str !== '[object Array]' &&
			value !== null &&
			typeof value === 'object' &&
			typeof runtimeProperty(value, "length") === 'number' &&
			numericRelationalValue(runtimeProperty(value, "length")) >= 0 &&
			toStr.call(runtimeProperty(value, "callee")) === '[object Function]';
	}
	return isArgs;
};


/***/ 
const completed = module.exports;
if (!isExport(completed)) throw new TypeError("Unexpected completed shim export");
return completed;
}
