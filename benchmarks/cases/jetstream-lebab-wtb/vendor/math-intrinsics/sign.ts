// Exact module body from JetStream 3.0 ./node_modules/math-intrinsics/sign.js.
// Dependencies are loaded at the original call sites; the cached export object is retained.
import {webpack, isRecord} from "../../webpack.ts";
import {load as load0} from "./isNaN.ts";

let cache: {exports: unknown} | undefined;
export function load(): ReturnType<typeof initialize> {
 if (cache !== undefined) {
  const value = cache.exports;
  if (!isExport(value)) throw new TypeError("Unexpected cached export for math-intrinsics/sign.js");
  return value;
 }
 return initialize();
}
function isExport(value: unknown): value is ReturnType<typeof initialize> {
 return typeof value === "function";
}
function initialize(): (number: number) => number {
let module: { exports: unknown; paths?: string[]; children?: unknown[] } = {exports: {}};
const exports = module.exports;
cache = module;


"use strict";


var $isNaN = load0();

/** @type {import('./sign')} */
module.exports = function sign(number: number) {
	if ($isNaN(number) || number === 0) {
		return number;
	}
	return number < 0 ? -1 : +1;
};


/***/ 
if (!isExport(module.exports)) throw new TypeError("Incomplete original math-intrinsics/sign exports");
return module.exports;
}
