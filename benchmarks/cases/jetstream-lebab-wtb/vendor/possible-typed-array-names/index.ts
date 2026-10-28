// Exact module body from JetStream 3.0 ./node_modules/possible-typed-array-names/index.js.
// Dependencies are loaded at the original call sites; the cached export object is retained.
import {webpack, isRecord, record, runtimeProperty} from "../../webpack.ts";


let cache: {exports: unknown} | undefined;
export function load(): ReturnType<typeof initialize> {
 if (cache !== undefined) {
  const value = cache.exports;
  if (!isExport(value)) throw new TypeError("Unexpected cached export for possible-typed-array-names/index.js");
  return value;
 }
 return initialize();
}
function isExport(value: unknown): value is ReturnType<typeof initialize> {
 return Array.isArray(value) && value.every((name: unknown) => typeof name === "string");
}
function initialize(): string[] {
let module: { exports: unknown; paths?: string[]; children?: unknown[] } = {exports: {}};
const exports = module.exports;
cache = module;


"use strict";


/** @type {import('.')} */
module.exports = [
	'Float16Array',
	'Float32Array',
	'Float64Array',
	'Int8Array',
	'Int16Array',
	'Int32Array',
	'Uint8Array',
	'Uint8ClampedArray',
	'Uint16Array',
	'Uint32Array',
	'BigInt64Array',
	'BigUint64Array'
];


/***/ 
const completed = module.exports;
if (!isExport(completed)) throw new TypeError("Unexpected completed compatibility-module export");
return completed;
}
