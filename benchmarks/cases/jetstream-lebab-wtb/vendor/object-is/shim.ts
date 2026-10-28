// Exact module body from JetStream 3.0 ./node_modules/object-is/shim.js.
// Dependencies are loaded at the original call sites; the cached export object is retained.
import {webpack, isRecord, record, runtimeProperty} from "../../webpack.ts";
import {load as load0} from "./polyfill.ts";
import {load as load1} from "../define-properties/index.ts";

import type {ShimObjectIs, ShimObjectIsModule} from "../../shim-types.ts";
let cache: {exports: unknown} | undefined;
export function load(): ReturnType<typeof initialize> {
 if (cache !== undefined) {
  const value = cache.exports;
  if (!isExport(value)) throw new TypeError("Unexpected cached export for object-is/shim.js");
  return value;
 }
 return initialize();
}
function isExport(value: unknown): value is ReturnType<typeof initialize> {
 return typeof value === "function";
}
function initialize(): () => ShimObjectIs {
let module: { exports: unknown; paths?: string[]; children?: unknown[] } = {exports: {}};
const exports = module.exports;
cache = module;


"use strict";


var getPolyfill = load0();
var define = load1();

module.exports = function shimObjectIs() {
	var polyfill = getPolyfill();
	define(Object, { is: polyfill }, {
		is: function testObjectIs() {
			return Object.is !== polyfill;
		}
	});
	return polyfill;
};


/***/ 
const completed = module.exports;
if (!isExport(completed)) throw new TypeError("Unexpected completed compatibility-module export");
return completed;
}
