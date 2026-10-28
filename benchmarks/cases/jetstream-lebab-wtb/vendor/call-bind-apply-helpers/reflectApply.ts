import type {ShimApply} from "../../shim-types.ts";
// Exact module body from JetStream 3.0 ./node_modules/call-bind-apply-helpers/reflectApply.js.
// Dependencies are loaded at the original call sites; the cached export object is retained.
import {webpack, isRecord} from "../../webpack.ts";

let cache: {exports: unknown} | undefined;
export function load(): ReturnType<typeof initialize> {
 if (cache !== undefined) {
  const value = cache.exports;
  if (!isExport(value)) throw new TypeError("Unexpected cached export for call-bind-apply-helpers/reflectApply.js");
  return value;
 }
 return initialize();
}
function isExport(value: unknown): value is ReturnType<typeof initialize> {
 return typeof value === "function" || value === false || value === undefined;
}
function initialize(): ShimApply | false | undefined {
let module: { exports: unknown; paths?: string[]; children?: unknown[] } = {exports: {}};
const exports = module.exports;
cache = module;


"use strict";


/** @type {import('./reflectApply')} */
module.exports = typeof Reflect !== 'undefined' && Reflect && Reflect.apply;


/***/ 
if (!isExport(module.exports)) throw new TypeError("Incomplete original call-bind-apply-helpers/reflectApply exports");
return module.exports;
}
