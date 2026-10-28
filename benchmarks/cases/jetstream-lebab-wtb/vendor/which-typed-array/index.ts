// Exact module body from JetStream 3.0 ./node_modules/which-typed-array/index.js.
// Dependencies are loaded at the original call sites; the moduleCached export object is retained.
import {webpack, isRecord, record, runtimeProperty, runtimeConstructor} from "../../webpack.ts";
import {load as load0} from "../for-each/index.ts";
import {load as load1} from "../available-typed-arrays/index.ts";
import {load as load2} from "../call-bind/index.ts";
import {load as load3} from "../call-bound/index.ts";
import {load as load4} from "../gopd/index.ts";
import {load as load5} from "../get-proto/index.ts";
import {load as load6} from "../has-tostringtag/shams.ts";

import type {ShimWhichTypedArray} from "../../shim-types.ts";
import {callableValue, present, stringValue, numberValue, stringArray, numericRelationalValue, concatenatedString} from "../lodash/runtime.ts";
import type {LodashCallable} from "../lodash/runtime.ts";
let moduleCache: {exports: unknown} | undefined;
export function load(): ReturnType<typeof initialize> {
 if (moduleCache !== undefined) {
  const value = moduleCache.exports;
  if (!isExport(value)) throw new TypeError("Unexpected moduleCached export for which-typed-array/index.js");
  return value;
 }
 return initialize();
}
function isExport(value: unknown): value is ReturnType<typeof initialize> {
 return typeof value === "function";
}
function initialize(): ShimWhichTypedArray {
let module: { exports: unknown; paths?: string[]; children?: unknown[] } = {exports: {}};
const exports = module.exports;
moduleCache = module;


"use strict";


var forEach = load0();
var availableTypedArrays = load1();
var callBind = load2();
var callBound = load3();
var gOPD = load4();
var getProto = load5();

var $toString = callableValue(callBound('Object.prototype.toString'));
var hasToStringTag = load6()();

var g = record(typeof globalThis === 'undefined' ? webpack.g : globalThis);
var typedArrays = availableTypedArrays();

var $slice = callableValue(callBound('String.prototype.slice'));

/** @type {<T = unknown>(array: readonly T[], value: unknown) => number} */
var $indexOf: unknown = callBound('Array.prototype.indexOf', true) || function indexOf(array: readonly unknown[], value: unknown) {
	for (var i = 0; i < array.length; i += 1) {
		if (array[i] === value) {
			return i;
		}
	}
	return -1;
};

/** @typedef {import('./types').Getter} Getter */
/** @type {import('./types').Cache} */
var cache: Record<string, unknown> = { __proto__: null };
if (hasToStringTag && gOPD && getProto) {
	forEach(typedArrays, function (typedArray: string) {
		var arr = new (runtimeConstructor(g[typedArray]))();
		if (Symbol.toStringTag in arr && getProto) {
			var proto = getProto(arr);
			// upstream JS type note: TS won't narrow inside a closure
			var descriptor = present(gOPD)(proto, Symbol.toStringTag);
			if (!descriptor && proto) {
				var superProto = getProto(proto);
				// upstream JS type note: TS won't narrow inside a closure
				descriptor = present(gOPD)(superProto, Symbol.toStringTag);
			}
			// upstream JS type note: TODO: fix
			cache['$' + typedArray] = callBind(present(descriptor).get);
		}
	});
} else {
	forEach(typedArrays, function (typedArray: string) {
		var arr = new (runtimeConstructor(g[typedArray]))();
		var fn = record(arr).slice || record(arr).set;
		if (fn) {
			cache[
				/** @type {`$${import('.').TypedArrayName}`} */ ('$' + typedArray)
			] = /** @type {import('./types').BoundSlice | import('./types').BoundSet} */ (
				// upstream JS type note: TODO FIXME
				callBind(fn)
			);
		}
	});
}

/** @type {(value: object) => false | import('.').TypedArrayName} */
var tryTypedArrays = function tryAllTypedArrays(value: unknown): false | string {
	/** @type {ReturnType<typeof tryAllTypedArrays>} */ var found: false | string = false;
	forEach(
		/** @type {Record<`\$${import('.').TypedArrayName}`, Getter>} */ (cache),
		/** @type {(getter: Getter, name: `\$${import('.').TypedArrayName}`) => void} */
		function (getter: unknown, typedArray: string) {
			if (!found) {
				try {
					// upstream JS type note: a throw is fine here
					if ('$' + concatenatedString(callableValue(getter)(value)) === typedArray) {
						found = /** @type {import('.').TypedArrayName} */ (stringValue($slice(typedArray, 1)));
					}
				} catch (e) { /**/ }
			}
		}
	);
	return found;
};

/** @type {(value: object) => false | import('.').TypedArrayName} */
var trySlices = function tryAllSlices(value: unknown): false | string {
	/** @type {ReturnType<typeof tryAllSlices>} */ var found: false | string = false;
	forEach(
		/** @type {Record<`\$${import('.').TypedArrayName}`, Getter>} */(cache),
		/** @type {(getter: Getter, name: `\$${import('.').TypedArrayName}`) => void} */ function (getter: unknown, name: string) {
			if (!found) {
				try {
					// upstream JS type note: a throw is fine here
					callableValue(getter)(value);
					found = /** @type {import('.').TypedArrayName} */ (stringValue($slice(name, 1)));
				} catch (e) { /**/ }
			}
		}
	);
	return found;
};

/** @type {import('.')} */
module.exports = function whichTypedArray(value: unknown) {
	if (!value || typeof value !== 'object') { return false; }
	if (!hasToStringTag) {
		/** @type {string} */
		var tag = stringValue($slice($toString(value), 8, -1));
		if (numberValue(callableValue($indexOf)(typedArrays, tag)) > -1) {
			return tag;
		}
		if (tag !== 'Object') {
			return false;
		}
		// node < 0.6 hits here on real Typed Arrays
		return trySlices(value);
	}
	if (!gOPD) { return null; } // unknown engine
	return tryTypedArrays(value);
};


/***/ 
const completed = module.exports;
if (!isExport(completed)) throw new TypeError("Unexpected completed shim export");
return completed;
}
