import {callableValue, present, type LodashCallable} from "../lodash/runtime.ts";
// Exact module body from JetStream 3.0 ./node_modules/call-bind-apply-helpers/index.js.
// Dependencies are loaded at the original call sites; the cached export object is retained.
import {webpack, isRecord} from "../../webpack.ts";
import {load as load0} from "../function-bind/index.ts";
import {load as load1} from "../es-errors/type.ts";
import {load as load2} from "./functionCall.ts";
import {load as load3} from "./actualApply.ts";

let cache: {exports: unknown} | undefined;
export function load(): ReturnType<typeof initialize> {
 if (cache !== undefined) {
  const value = cache.exports;
  if (!isExport(value)) throw new TypeError("Unexpected cached export for call-bind-apply-helpers/index.js");
  return value;
 }
 return initialize();
}
function isExport(value: unknown): value is ReturnType<typeof initialize> {
 return typeof value === "function";
}
function initialize(): (args: ArrayLike<unknown>) => LodashCallable {
let module: { exports: unknown; paths?: string[]; children?: unknown[] } = {exports: {}};
const exports = module.exports;
cache = module;


"use strict";


var bind = load0();
var $TypeError = load1();

var $call = load2();
var $actualApply = load3();

/** @type {(args: [Function, thisArg?: unknown, ...args: unknown[]]) => Function} TODO FIXME, find a way to use import('.') */
module.exports = function callBindBasic(args: ArrayLike<unknown>) {
	if (args.length < 1 || typeof args[0] !== 'function') {
		throw new $TypeError('a function is required');
	}
	return callableValue($actualApply(bind, $call, args));
};


/***/ 
if (!isExport(module.exports)) throw new TypeError("Incomplete original call-bind-apply-helpers/index exports");
return module.exports;
}
