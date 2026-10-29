import type {ShimGetDescriptor} from "../../shim-types.ts";
// Exact module body from JetStream 3.0 ./node_modules/gopd/index.js.
// Dependencies are loaded at the original call sites; the cached export object is retained.
import {webpack, isRecord} from "../../webpack.ts";
import {load as load0} from "./gOPD.ts";

let cache: {exports: unknown} | undefined;
export function load(): ReturnType<typeof initialize> {
 if (cache !== undefined) {
  const value = cache.exports;
  if (!isExport(value)) throw new TypeError("Unexpected cached export for gopd/index.js");
  return value;
 }
 return initialize();
}
function isExport(value: unknown): value is ReturnType<typeof initialize> {
 return typeof value === "function" || value === null || value === undefined;
}
function initialize(): ShimGetDescriptor | null | undefined {
let module: { exports: unknown; paths?: string[]; children?: unknown[] } = {exports: {}};
const exports = module.exports;
cache = module;


"use strict";


/** @type {import('.')} */
var $gOPD: ShimGetDescriptor | null | undefined = load0();

if ($gOPD) {
	try {
		$gOPD([], 'length');
	} catch (e) {
		// IE 8 has a broken gOPD
		$gOPD = null;
	}
}

module.exports = $gOPD;


/***/ 
if (!isExport(module.exports)) throw new TypeError("Incomplete original gopd/index exports");
return module.exports;
}
