// Exact module body from JetStream 3.0 ./node_modules/is-nan/index.js.
// Dependencies are loaded at the original call sites; the cached export object is retained.
import {webpack, isRecord, record, runtimeProperty} from "../../webpack.ts";
import {load as load0} from "../call-bind/index.ts";
import {load as load1} from "../define-properties/index.ts";
import {load as load2} from "./implementation.ts";
import {load as load3} from "./polyfill.ts";
import {load as load4} from "./shim.ts";

import type {ShimPredicate, ShimIsNaNModule} from "../../shim-types.ts";
let cache: {exports: unknown} | undefined;
export function load(): ReturnType<typeof initialize> {
 if (cache !== undefined) {
  const value = cache.exports;
  if (!isExport(value)) throw new TypeError("Unexpected cached export for is-nan/index.js");
  return value;
 }
 return initialize();
}
function isExport(value: unknown): value is ReturnType<typeof initialize> {
 return typeof value === "function" && typeof record(value).getPolyfill === "function" && typeof record(value).implementation === "function" && typeof record(value).shim === "function";
}
function initialize(): ShimIsNaNModule {
let module: { exports: unknown; paths?: string[]; children?: unknown[] } = {exports: {}};
const exports = module.exports;
cache = module;


"use strict";


var callBind = load0();
var define = load1();

var implementation = load2();
var getPolyfill = load3();
var shim = load4();

var polyfill = callBind(getPolyfill(), Number);

/* http://www.ecma-international.org/ecma-262/6.0/#sec-number.isnan */

define(polyfill, {
	getPolyfill: getPolyfill,
	implementation: implementation,
	shim: shim
});

module.exports = polyfill;


/***/ 
const completed = module.exports;
if (!isExport(completed)) throw new TypeError("Unexpected completed compatibility-module export");
return completed;
}
