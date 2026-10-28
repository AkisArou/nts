// Exact module body from JetStream 3.0 ./node_modules/object.assign/implementation.js.
// Dependencies are loaded at the original call sites; the cached export object is retained.
import {webpack, isRecord, record, runtimeProperty} from "../../webpack.ts";
import {load as load0} from "../object-keys/index.ts";
import {load as load1} from "../has-symbols/shams.ts";
import {load as load2} from "../call-bound/index.ts";
import {load as load3} from "../es-object-atoms/index.ts";

import type {ShimAssign} from "../../shim-types.ts";
import {callableValue, present, stringValue, numberValue} from "../lodash/runtime.ts";
let cache: {exports: unknown} | undefined;
export function load(): ReturnType<typeof initialize> {
 if (cache !== undefined) {
  const value = cache.exports;
  if (!isExport(value)) throw new TypeError("Unexpected cached export for object.assign/implementation.js");
  return value;
 }
 return initialize();
}
function isExport(value: unknown): value is ReturnType<typeof initialize> {
 return typeof value === "function";
}
function initialize(): ShimAssign {
let module: { exports: unknown; paths?: string[]; children?: unknown[] } = {exports: {}};
const exports = module.exports;
cache = module;


"use strict";


// modified from https://github.com/es-shims/es6-shim
var objectKeys = load0();
var hasSymbols = load1()();
var callBound = load2();
var $Object = load3();
var $push = callableValue(callBound('Array.prototype.push'));
var $propIsEnumerable = callableValue(callBound('Object.prototype.propertyIsEnumerable'));
var originalGetSymbols = hasSymbols ? $Object.getOwnPropertySymbols : null;

// eslint-disable-next-line no-unused-vars
module.exports = function assign(target: unknown, source1: unknown) {
	if (target == null) { throw new TypeError('target must be an object'); }
	var to = record($Object(target)); // step 1
	if (arguments.length === 1) {
		return to; // step 2
	}
	for (var s = 1; s < arguments.length; ++s) {
		var from = record($Object(arguments[s])); // step 3.a.i

		// step 3.a.ii:
		var keys: PropertyKey[] = objectKeys(from);
		var getSymbols = hasSymbols && ($Object.getOwnPropertySymbols || originalGetSymbols);
		if (getSymbols) {
			var syms = getSymbols(from);
			for (var j = 0; j < syms.length; ++j) {
				var key = syms[j];
				if ($propIsEnumerable(from, key)) {
					$push(keys, key);
				}
			}
		}

		// step 3.a.iii:
		for (var i = 0; i < keys.length; ++i) {
			var nextKey = keys[i];
			if ($propIsEnumerable(from, nextKey)) { // step 3.a.iii.2
				var propValue = from[nextKey]; // step 3.a.iii.2.a
				to[nextKey] = propValue; // step 3.a.iii.2.b
			}
		}
	}

	return to; // step 4
};


/***/ 
const completed = module.exports;
if (!isExport(completed)) throw new TypeError("Unexpected completed compatibility-module export");
return completed;
}
