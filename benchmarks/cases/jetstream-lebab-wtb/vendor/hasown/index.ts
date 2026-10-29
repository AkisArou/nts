
// Exact module body from JetStream 3.0 ./node_modules/hasown/index.js.
// Dependencies are loaded at the original call sites; the cached export object is retained.
import {webpack, isRecord} from "../../webpack.ts";
import {load as load0} from "../function-bind/index.ts";

let cache: {exports: unknown} | undefined;
export function load(): ReturnType<typeof initialize> {
 if (cache !== undefined) {
  const value = cache.exports;
  if (!isExport(value)) throw new TypeError("Unexpected cached export for hasown/index.js");
  return value;
 }
 return initialize();
}
function isExport(value: unknown): value is ReturnType<typeof initialize> {
 return typeof value === "function";
}
function initialize(): (value: unknown, key: PropertyKey) => boolean {
let module: { exports: unknown; paths?: string[]; children?: unknown[] } = {exports: {}};
const exports = module.exports;
cache = module;


"use strict";


var call = Function.prototype.call;
var $hasOwn = Object.prototype.hasOwnProperty;
var bind = load0();

/** @type {import('.')} */
module.exports = bind.call(call, $hasOwn);


/***/ 
if (!isExport(module.exports)) throw new TypeError("Incomplete original hasown/index exports");
return module.exports;
}
