import type {ShimFunctionApply} from "../../shim-types.ts";
// Exact module body from JetStream 3.0 ./node_modules/call-bind-apply-helpers/functionApply.js.
// Dependencies are loaded at the original call sites; the cached export object is retained.
import {webpack, isRecord} from "../../webpack.ts";

let cache: {exports: unknown} | undefined;
export function load(): ReturnType<typeof initialize> {
 if (cache !== undefined) {
  const value = cache.exports;
  if (!isExport(value)) throw new TypeError("Unexpected cached export for call-bind-apply-helpers/functionApply.js");
  return value;
 }
 return initialize();
}
function isExport(value: unknown): value is ReturnType<typeof initialize> {
 return typeof value === "function";
}
function initialize(): ShimFunctionApply {
let module: { exports: unknown; paths?: string[]; children?: unknown[] } = {exports: {}};
const exports = module.exports;
cache = module;


"use strict";


/** @type {import('./functionApply')} */
module.exports = Function.prototype.apply;


/***/ 
if (!isExport(module.exports)) throw new TypeError("Incomplete original call-bind-apply-helpers/functionApply exports");
return module.exports;
}
