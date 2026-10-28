import {callableValue, present, type LodashCallable} from "../lodash/runtime.ts";
// Exact module body from JetStream 3.0 ./node_modules/call-bind-apply-helpers/applyBind.js.
// Dependencies are loaded at the original call sites; the cached export object is retained.
import {webpack, isRecord} from "../../webpack.ts";
import {load as load0} from "../function-bind/index.ts";
import {load as load1} from "./functionApply.ts";
import {load as load2} from "./actualApply.ts";

let cache: {exports: unknown} | undefined;
export function load(): ReturnType<typeof initialize> {
 if (cache !== undefined) {
  const value = cache.exports;
  if (!isExport(value)) throw new TypeError("Unexpected cached export for call-bind-apply-helpers/applyBind.js");
  return value;
 }
 return initialize();
}
function isExport(value: unknown): value is ReturnType<typeof initialize> {
 return typeof value === "function";
}
function initialize(): (...args: unknown[]) => LodashCallable {
let module: { exports: unknown; paths?: string[]; children?: unknown[] } = {exports: {}};
const exports = module.exports;
cache = module;


"use strict";


var bind = load0();
var $apply = load1();
var actualApply = load2();

/** @type {import('./applyBind')} */
module.exports = function applyBind() {
	return callableValue(actualApply(bind, $apply, arguments));
};


/***/ 
if (!isExport(module.exports)) throw new TypeError("Incomplete original call-bind-apply-helpers/applyBind exports");
return module.exports;
}
