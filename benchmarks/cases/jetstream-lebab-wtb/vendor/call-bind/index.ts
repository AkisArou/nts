import type {ShimCallBind} from "../../shim-types.ts";
import {callableValue} from "../lodash/runtime.ts";
import {record} from "../../webpack.ts";
// Exact module body from JetStream 3.0 ./node_modules/call-bind/index.js.
// Dependencies are loaded at the original call sites; the cached export object is retained.
import {webpack, isRecord} from "../../webpack.ts";
import {load as load0} from "../set-function-length/index.ts";
import {load as load1} from "../es-define-property/index.ts";
import {load as load2} from "../call-bind-apply-helpers/index.ts";
import {load as load3} from "../call-bind-apply-helpers/applyBind.ts";

let cache: {exports: unknown} | undefined;
export function load(): ReturnType<typeof initialize> {
 if (cache !== undefined) {
  const value = cache.exports;
  if (!isExport(value)) throw new TypeError("Unexpected cached export for call-bind/index.js");
  return value;
 }
 return initialize();
}
function isExport(value: unknown): value is ReturnType<typeof initialize> {
 return typeof value === "function" && isRecord(value) && typeof value.apply === "function";
}
function initialize(): ShimCallBind {
let module: { exports: unknown; paths?: string[]; children?: unknown[] } = {exports: {}};
const exports = module.exports;
cache = module;


"use strict";


var setFunctionLength = load0();

var $defineProperty = load1();

var callBindBasic = load2();
var applyBind = load3();

module.exports = function callBind(originalFunction: unknown) {
	var func = callBindBasic(arguments);
	var adjustedLength = callableValue(originalFunction).length - (arguments.length - 1);
	return setFunctionLength(
		func,
		1 + (adjustedLength > 0 ? adjustedLength : 0),
		true
	);
};

if ($defineProperty) {
	$defineProperty(record(module.exports), 'apply', { value: applyBind });
} else {
	record(module.exports).apply = applyBind;
}


/***/ 
if (!isExport(module.exports)) throw new TypeError("Incomplete original call-bind/index exports");
return module.exports;
}
