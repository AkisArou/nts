// Exact module body from JetStream 3.0 ./node_modules/math-intrinsics/min.js.
// Dependencies are loaded at the original call sites; the cached export object is retained.
import {webpack, isRecord} from "../../webpack.ts";

let cache: {exports: unknown} | undefined;
export function load(): ReturnType<typeof initialize> {
 if (cache !== undefined) {
  const value = cache.exports;
  if (!isExport(value)) throw new TypeError("Unexpected cached export for math-intrinsics/min.js");
  return value;
 }
 return initialize();
}
function isExport(value: unknown): value is ReturnType<typeof initialize> {
 return typeof value === "function";
}
function initialize(): typeof Math.min {
let module: { exports: unknown; paths?: string[]; children?: unknown[] } = {exports: {}};
const exports = module.exports;
cache = module;


"use strict";


/** @type {import('./min')} */
module.exports = Math.min;


/***/ 
if (!isExport(module.exports)) throw new TypeError("Incomplete original math-intrinsics/min exports");
return module.exports;
}
