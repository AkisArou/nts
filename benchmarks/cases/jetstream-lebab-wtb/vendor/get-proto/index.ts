import type {ShimGetPrototype} from "../../shim-types.ts";
import {present} from "../lodash/runtime.ts";
// Exact module body from JetStream 3.0 ./node_modules/get-proto/index.js.
// Dependencies are loaded at the original call sites; the cached export object is retained.
import {webpack, isRecord} from "../../webpack.ts";
import {load as load0} from "./Reflect.getPrototypeOf.ts";
import {load as load1} from "./Object.getPrototypeOf.ts";
import {load as load2} from "../dunder-proto/get.ts";

let cache: {exports: unknown} | undefined;
export function load(): ReturnType<typeof initialize> {
 if (cache !== undefined) {
  const value = cache.exports;
  if (!isExport(value)) throw new TypeError("Unexpected cached export for get-proto/index.js");
  return value;
 }
 return initialize();
}
function isExport(value: unknown): value is ReturnType<typeof initialize> {
 return typeof value === "function" || value === null;
}
function callableGetDunder(value: ShimGetPrototype | false): ShimGetPrototype { if (value === false) throw new TypeError("Expected the original prototype getter"); return value; }
function initialize(): ShimGetPrototype | null {
let module: { exports: unknown; paths?: string[]; children?: unknown[] } = {exports: {}};
const exports = module.exports;
cache = module;


"use strict";


var reflectGetProto = load0();
var originalGetProto = load1();

var getDunderProto = load2();

/** @type {import('.')} */
module.exports = reflectGetProto
	? function getProto(O: unknown): object | null {
		// upstream JS type note: TS can't narrow inside a closure, for some reason
		return present(reflectGetProto)(O);
	}
	: originalGetProto
		? function getProto(O: unknown): object | null {
			if (!O || (typeof O !== 'object' && typeof O !== 'function')) {
				throw new TypeError('getProto: not an object');
			}
			// upstream JS type note: TS can't narrow inside a closure, for some reason
			return present(originalGetProto)(O);
		}
		: getDunderProto
			? function getProto(O: unknown): object | null {
				// upstream JS type note: TS can't narrow inside a closure, for some reason
				return callableGetDunder(getDunderProto)(O);
			}
			: null;


/***/ 
if (!isExport(module.exports)) throw new TypeError("Incomplete original get-proto/index exports");
return module.exports;
}
