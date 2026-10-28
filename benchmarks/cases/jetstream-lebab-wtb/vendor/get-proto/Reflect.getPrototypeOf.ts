import type {ShimGetPrototype} from "../../shim-types.ts";
// Exact module body from JetStream 3.0 ./node_modules/get-proto/Reflect.getPrototypeOf.js.
// Dependencies are loaded at the original call sites; the cached export object is retained.
import {webpack, isRecord} from "../../webpack.ts";

let cache: {exports: unknown} | undefined;
export function load(): ReturnType<typeof initialize> {
 if (cache !== undefined) {
  const value = cache.exports;
  if (!isExport(value)) throw new TypeError("Unexpected cached export for get-proto/Reflect.getPrototypeOf.js");
  return value;
 }
 return initialize();
}
function isExport(value: unknown): value is ReturnType<typeof initialize> {
 return typeof value === "function" || value === null;
}
function initialize(): ShimGetPrototype | null {
let module: { exports: unknown; paths?: string[]; children?: unknown[] } = {exports: {}};
const exports = module.exports;
cache = module;


"use strict";


/** @type {import('./Reflect.getPrototypeOf')} */
module.exports = (typeof Reflect !== 'undefined' && Reflect.getPrototypeOf) || null;


/***/ 
if (!isExport(module.exports)) throw new TypeError("Incomplete original get-proto/Reflect.getPrototypeOf exports");
return module.exports;
}
