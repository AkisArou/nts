// Exact module body from JetStream 3.0 ./node_modules/safe-regex-test/index.js.
// Dependencies are loaded at the original call sites; the cached export object is retained.
import {webpack, isRecord, record, runtimeProperty} from "../../webpack.ts";
import {load as load0} from "../call-bound/index.ts";
import {load as load1} from "../is-regex/index.ts";
import {load as load2} from "../es-errors/type.ts";

import {callableValue, present, stringValue, numberValue} from "../lodash/runtime.ts";
let cache: {exports: unknown} | undefined;
export function load(): ReturnType<typeof initialize> {
 if (cache !== undefined) {
  const value = cache.exports;
  if (!isExport(value)) throw new TypeError("Unexpected cached export for safe-regex-test/index.js");
  return value;
 }
 return initialize();
}
function isExport(value: unknown): value is ReturnType<typeof initialize> {
 return typeof value === "function";
}
function initialize(): (regex: unknown) => (value: unknown) => boolean {
let module: { exports: unknown; paths?: string[]; children?: unknown[] } = {exports: {}};
const exports = module.exports;
cache = module;


"use strict";


var callBound = load0();
var isRegex = load1();

var $exec = callableValue(callBound('RegExp.prototype.exec'));
var $TypeError = load2();

/** @type {import('.')} */
module.exports = function regexTester(regex: unknown) {
	if (!isRegex(regex)) {
		throw new $TypeError('`regex` must be a RegExp');
	}
	return function test(s: unknown) {
		return $exec(regex, s) !== null;
	};
};


/***/ 
const completed = module.exports;
if (!isExport(completed)) throw new TypeError("Unexpected completed compatibility-module export");
return completed;
}
