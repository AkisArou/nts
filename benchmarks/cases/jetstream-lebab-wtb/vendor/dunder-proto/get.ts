import type {ShimGetPrototype} from "../../shim-types.ts";
import {record} from "../../webpack.ts";
import {callableValue, present, type LodashCallable} from "../lodash/runtime.ts";
// Exact module body from JetStream 3.0 ./node_modules/dunder-proto/get.js.
// Dependencies are loaded at the original call sites; the cached export object is retained.
import {webpack, isRecord} from "../../webpack.ts";
import {load as load0} from "../call-bind-apply-helpers/index.ts";
import {load as load1} from "../gopd/index.ts";

let cache: {exports: unknown} | undefined;
export function load(): ReturnType<typeof initialize> {
 if (cache !== undefined) {
  const value = cache.exports;
  if (!isExport(value)) throw new TypeError("Unexpected cached export for dunder-proto/get.js");
  return value;
 }
 return initialize();
}
function isExport(value: unknown): value is ReturnType<typeof initialize> {
 return typeof value === "function" || value === false;
}
function initialize(): ShimGetPrototype | false {
let module: { exports: unknown; paths?: string[]; children?: unknown[] } = {exports: {}};
const exports = module.exports;
cache = module;


"use strict";


var callBind = load0();
var gOPD = load1();

var hasProtoAccessor: boolean | undefined;
try {
	// eslint-disable-next-line no-extra-parens, no-proto
	hasProtoAccessor = /** @type {{ __proto__?: typeof Array.prototype }} */ record([]).__proto__ === Array.prototype;
} catch (e) {
	if (!e || typeof e !== 'object' || !('code' in e) || e.code !== 'ERR_PROTO_ACCESS') {
		throw e;
	}
}

// eslint-disable-next-line no-extra-parens
var desc = !!hasProtoAccessor && gOPD && gOPD(Object.prototype, /** @type {keyof typeof Object.prototype} */ ('__proto__'));

var $Object = Object;
var $getPrototypeOf = $Object.getPrototypeOf;

/** @type {import('./get')} */
module.exports = desc && typeof desc.get === 'function'
	? callBind([desc.get])
	: typeof $getPrototypeOf === 'function'
		? /** @type {import('./get')} */ function getDunder(value: unknown): object | null {
			// eslint-disable-next-line eqeqeq
			return $getPrototypeOf(value == null ? value : $Object(value));
		}
		: false;


/***/ 
if (!isExport(module.exports)) throw new TypeError("Incomplete original dunder-proto/get exports");
return module.exports;
}
