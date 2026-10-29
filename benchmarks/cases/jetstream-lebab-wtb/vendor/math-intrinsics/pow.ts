// Exact module body from JetStream 3.0 ./node_modules/math-intrinsics/pow.js.
// Dependencies are loaded at the original call sites; the cached export object is retained.
import {webpack, isRecord} from "../../webpack.ts";

let cache: {exports: unknown} | undefined;
export function load(): ReturnType<typeof initialize> {
 if (cache !== undefined) {
  const value = cache.exports;
  if (!isExport(value)) throw new TypeError("Unexpected cached export for math-intrinsics/pow.js");
  return value;
 }
 return initialize();
}
function isExport(value: unknown): value is ReturnType<typeof initialize> {
 return typeof value === "function";
}
function initialize(): typeof Math.pow {
let module: { exports: unknown; paths?: string[]; children?: unknown[] } = {exports: {}};
const exports = module.exports;
cache = module;


"use strict";


/** @type {import('./pow')} */
module.exports = Math.pow;


/***/ 
if (!isExport(module.exports)) throw new TypeError("Incomplete original math-intrinsics/pow exports");
return module.exports;
}
