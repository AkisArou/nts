// Exact module body from JetStream 3.0 ./node_modules/is-generator-function/index.js.
// Dependencies are loaded at the original call sites; the cached export object is retained.
import {webpack, isRecord, record, runtimeProperty} from "../../webpack.ts";
import {load as load0} from "../call-bound/index.ts";
import {load as load1} from "../safe-regex-test/index.ts";
import {load as load2} from "../has-tostringtag/shams.ts";
import {load as load3} from "../get-proto/index.ts";

import {callableValue, present, stringValue, numberValue} from "../lodash/runtime.ts";
let cache: {exports: unknown} | undefined;
export function load(): ReturnType<typeof initialize> {
 if (cache !== undefined) {
  const value = cache.exports;
  if (!isExport(value)) throw new TypeError("Unexpected cached export for is-generator-function/index.js");
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


var callBound = load0();
var safeRegexTest = load1();
var isFnRegex = safeRegexTest(/^\s*(?:function)?\*/);
var hasToStringTag = load2()();
var getProto = load3();

var toStr = callableValue(callBound('Object.prototype.toString'));
var fnToStr = callableValue(callBound('Function.prototype.toString'));

var getGeneratorFunc = function (): unknown { // eslint-disable-line consistent-return
	if (!hasToStringTag) {
		return false;
	}
	try {
		return Function('return function*() {}')();
	} catch (e) {
	}
};
/** @type {undefined | false | null | GeneratorFunctionConstructor} */
var GeneratorFunction: object | false | null | undefined;

/** @type {import('.')} */
module.exports = function isGeneratorFunction(fn: unknown) {
	if (typeof fn !== 'function') {
		return false;
	}
	if (isFnRegex(fnToStr(fn))) {
		return true;
	}
	if (!hasToStringTag) {
		var str = toStr(fn);
		return str === '[object GeneratorFunction]';
	}
	if (!getProto) {
		return false;
	}
	if (typeof GeneratorFunction === 'undefined') {
		var generatorFunc = getGeneratorFunc();
		GeneratorFunction = generatorFunc
			// eslint-disable-next-line no-extra-parens
			? /** @type {GeneratorFunctionConstructor} */ (getProto(generatorFunc))
			: false;
	}
	return getProto(fn) === GeneratorFunction;
};


/***/ 
const completed = module.exports;
if (!isExport(completed)) throw new TypeError("Unexpected completed compatibility-module export");
return completed;
}
