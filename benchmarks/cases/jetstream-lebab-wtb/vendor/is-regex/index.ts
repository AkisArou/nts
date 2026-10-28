// Exact module body from JetStream 3.0 ./node_modules/is-regex/index.js.
// Dependencies are loaded at the original call sites; the cached export object is retained.
import {webpack, isRecord, record, runtimeProperty} from "../../webpack.ts";
import {load as load0} from "../call-bound/index.ts";
import {load as load1} from "../has-tostringtag/shams.ts";
import {load as load2} from "../hasown/index.ts";
import {load as load3} from "../gopd/index.ts";

import {callableValue, present, stringValue, numberValue} from "../lodash/runtime.ts";
let cache: {exports: unknown} | undefined;
export function load(): ReturnType<typeof initialize> {
 if (cache !== undefined) {
  const value = cache.exports;
  if (!isExport(value)) throw new TypeError("Unexpected cached export for is-regex/index.js");
  return value;
 }
 return initialize();
}
function isExport(value: unknown): value is ReturnType<typeof initialize> {
 return typeof value === "function";
}
function initialize(): (value: unknown) => boolean | undefined {
let module: { exports: unknown; paths?: string[]; children?: unknown[] } = {exports: {}};
const exports = module.exports;
cache = module;


"use strict";


var callBound = load0();
var hasToStringTag = load1()();
var hasOwn = load2();
var gOPD = load3();

/** @type {import('.')} */
var fn: ((value: unknown) => boolean | undefined) | undefined;

if (hasToStringTag) {
	/** @type {(receiver: ThisParameterType<typeof RegExp.prototype.exec>, ...args: Parameters<typeof RegExp.prototype.exec>) => ReturnType<typeof RegExp.prototype.exec>} */
	var $exec = callableValue(callBound('RegExp.prototype.exec'));
	/** @type {object} */
	var isRegexMarker = {};

	var throwRegexMarker = function () {
		throw isRegexMarker;
	};
	/** @type {{ toString(): never, valueOf(): never, [Symbol.toPrimitive]?(): never }} */
	var badStringifier: {toString(): never; valueOf(): never; [Symbol.toPrimitive]?: () => never} = {
		toString: throwRegexMarker,
		valueOf: throwRegexMarker
	};

	if (typeof Symbol.toPrimitive === 'symbol') {
		badStringifier[Symbol.toPrimitive] = throwRegexMarker;
	}

	/** @type {import('.')} */
	// upstream JS type note: TS can't figure out that the $exec call always throws
	// eslint-disable-next-line consistent-return
	fn = function isRegex(value: unknown) {
		if (!value || typeof value !== 'object') {
			return false;
		}

		// eslint-disable-next-line no-extra-parens
		var descriptor = /** @type {NonNullable<typeof gOPD>} */ (present(gOPD))(/** @type {{ lastIndex?: unknown }} */ (value), 'lastIndex');
		var hasLastIndexDataProperty = descriptor && hasOwn(descriptor, 'value');
		if (!hasLastIndexDataProperty) {
			return false;
		}

		try {
			// eslint-disable-next-line no-extra-parens
			$exec(value, /** @type {string} */ (/** @type {unknown} */ (badStringifier)));
		} catch (e) {
			return e === isRegexMarker;
		}
	};
} else {
	/** @type {(receiver: ThisParameterType<typeof Object.prototype.toString>, ...args: Parameters<typeof Object.prototype.toString>) => ReturnType<typeof Object.prototype.toString>} */
	var $toString = callableValue(callBound('Object.prototype.toString'));
	/** @const @type {'[object RegExp]'} */
	var regexClass = '[object RegExp]';

	/** @type {import('.')} */
	fn = function isRegex(value: unknown) {
		// In older browsers, typeof regex incorrectly returns 'function'
		if (!value || (typeof value !== 'object' && typeof value !== 'function')) {
			return false;
		}

		return $toString(value) === regexClass;
	};
}

module.exports = fn;


/***/ 
const completed = module.exports;
if (!isExport(completed)) throw new TypeError("Unexpected completed compatibility-module export");
return completed;
}
