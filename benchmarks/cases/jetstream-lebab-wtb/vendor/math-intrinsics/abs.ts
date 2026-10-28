// Exact module body from JetStream 3.0 ./node_modules/math-intrinsics/abs.js.
// Dependencies are loaded at the original call sites; the cached export object is retained.
import {webpack, isRecord} from "../../webpack.ts";

let cache: {exports: unknown} | undefined;
export function load(): ReturnType<typeof initialize> {
 if (cache !== undefined) {
  const value = cache.exports;
  if (!isExport(value)) throw new TypeError("Unexpected cached export for math-intrinsics/abs.js");
  return value;
 }
 return initialize();
}
function isExport(value: unknown): value is ReturnType<typeof initialize> {
 return typeof value === "function";
}
function initialize(): typeof Math.abs {
let module: { exports: unknown; paths?: string[]; children?: unknown[] } = {exports: {}};
const exports = module.exports;
cache = module;


"use strict";


/** @type {import('./abs')} */
module.exports = Math.abs;


/***/ 
if (!isExport(module.exports)) throw new TypeError("Incomplete original math-intrinsics/abs exports");
return module.exports;
}
