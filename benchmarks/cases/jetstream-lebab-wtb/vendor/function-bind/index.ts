import type {ShimBind} from "../../shim-types.ts";
// Exact module body from JetStream 3.0 ./node_modules/function-bind/index.js.
// Dependencies are loaded at the original call sites; the cached export object is retained.
import {webpack, isRecord} from "../../webpack.ts";
import {load as load0} from "./implementation.ts";

let cache: {exports: unknown} | undefined;
export function load(): ReturnType<typeof initialize> {
 if (cache !== undefined) {
  const value = cache.exports;
  if (!isExport(value)) throw new TypeError("Unexpected cached export for function-bind/index.js");
  return value;
 }
 return initialize();
}
function isExport(value: unknown): value is ReturnType<typeof initialize> {
 return typeof value === "function";
}
function initialize(): ShimBind {
let module: { exports: unknown; paths?: string[]; children?: unknown[] } = {exports: {}};
const exports = module.exports;
cache = module;


"use strict";


var implementation = load0();

module.exports = Function.prototype.bind || implementation;


/***/ 
if (!isExport(module.exports)) throw new TypeError("Incomplete original function-bind/index exports");
return module.exports;
}
