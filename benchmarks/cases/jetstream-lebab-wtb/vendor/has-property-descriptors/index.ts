import type {ShimHasPropertyDescriptors} from "../../shim-types.ts";
// Exact module body from JetStream 3.0 ./node_modules/has-property-descriptors/index.js.
// Dependencies are loaded at the original call sites; the cached export object is retained.
import {webpack, isRecord} from "../../webpack.ts";
import {load as load0} from "../es-define-property/index.ts";

let cache: {exports: unknown} | undefined;
export function load(): ReturnType<typeof initialize> {
 if (cache !== undefined) {
  const value = cache.exports;
  if (!isExport(value)) throw new TypeError("Unexpected cached export for has-property-descriptors/index.js");
  return value;
 }
 return initialize();
}
function isExport(value: unknown): value is ReturnType<typeof initialize> {
 return typeof value === "function" && isRecord(value) && typeof value.hasArrayLengthDefineBug === "function";
}
function initialize(): ShimHasPropertyDescriptors {
let module: { exports: unknown; paths?: string[]; children?: unknown[] } = {exports: {}};
const exports = module.exports;
cache = module;


"use strict";


var $defineProperty = load0();

var hasPropertyDescriptors: (() => boolean) & {hasArrayLengthDefineBug?: () => boolean | null} = function hasPropertyDescriptors() {
	return !!$defineProperty;
};

hasPropertyDescriptors.hasArrayLengthDefineBug = function hasArrayLengthDefineBug() {
	// node v0.6 has a bug where array lengths can be Set but not Defined
	if (!$defineProperty) {
		return null;
	}
	try {
		return $defineProperty([], 'length', { value: 1 }).length !== 1;
	} catch (e) {
		// In Firefox 4-22, defining length on an array throws an exception.
		return true;
	}
};

module.exports = hasPropertyDescriptors;


/***/ 
if (!isExport(module.exports)) throw new TypeError("Incomplete original has-property-descriptors/index exports");
return module.exports;
}
