import {numberValue} from "../lodash/runtime.ts";
// Exact module body from JetStream 3.0 ./node_modules/call-bind/callBound.js.
// Dependencies are loaded at the original call sites; the cached export object is retained.
import {webpack, isRecord} from "../../webpack.ts";
import {load as load0} from "../get-intrinsic/index.ts";
import {load as load1} from "./index.ts";

let cache: {exports: unknown} | undefined;
export function load(): ReturnType<typeof initialize> {
 if (cache !== undefined) {
  const value = cache.exports;
  if (!isExport(value)) throw new TypeError("Unexpected cached export for call-bind/callBound.js");
  return value;
 }
 return initialize();
}
function isExport(value: unknown): value is ReturnType<typeof initialize> {
 return typeof value === "function";
}
function initialize(): (name: unknown, allowMissing?: unknown) => unknown {
let module: { exports: unknown; paths?: string[]; children?: unknown[] } = {exports: {}};
const exports = module.exports;
cache = module;


"use strict";


var GetIntrinsic = load0();

var callBind = load1();

var $indexOf = callBind(GetIntrinsic('String.prototype.indexOf'));

module.exports = function callBoundIntrinsic(name: unknown, allowMissing?: unknown) {
	var intrinsic = GetIntrinsic(name, !!allowMissing);
	if (typeof intrinsic === 'function' && numberValue($indexOf(name, '.prototype.')) > -1) {
		return callBind(intrinsic);
	}
	return intrinsic;
};


/***/ 
if (!isExport(module.exports)) throw new TypeError("Incomplete original call-bind/callBound exports");
return module.exports;
}
