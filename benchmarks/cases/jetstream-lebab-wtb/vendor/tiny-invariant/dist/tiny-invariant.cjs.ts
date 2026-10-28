// Exact module body from JetStream 3.0 ./node_modules/tiny-invariant/dist/tiny-invariant.cjs.js.
// Dependencies are loaded at the original call sites; the cached export object is retained.
import {webpack, isRecord} from "../../../webpack.ts";
export type Invariant = (condition: unknown, message?: string | (() => string)) => asserts condition;

let cache: {exports: unknown} | undefined;
export function load(): ReturnType<typeof initialize> {
 if (cache !== undefined) {
  const value = cache.exports;
  if (!isExport(value)) throw new TypeError("Unexpected cached export for tiny-invariant/dist/tiny-invariant.cjs.js");
  return value;
 }
 return initialize();
}
function isExport(value: unknown): value is ReturnType<typeof initialize> {
 return typeof value === "function";
}
function initialize(): Invariant {
let module: { exports: unknown; paths?: string[]; children?: unknown[] } = {exports: {}};
const exports = module.exports;
cache = module;


"use strict";


const environment: string = "development";
var isProduction = environment === 'production';
var prefix = 'Invariant failed';
function invariant(condition: unknown, message?: string | (() => string)): asserts condition {
    if (condition) {
        return;
    }
    if (isProduction) {
        throw new Error(prefix);
    }
    var provided = typeof message === 'function' ? message() : message;
    var value = provided ? "".concat(prefix, ": ").concat(provided) : prefix;
    throw new Error(value);
}

module.exports = invariant;


/***/ 
if (!isExport(module.exports)) throw new TypeError("Incomplete original module exports");
return module.exports;
}
