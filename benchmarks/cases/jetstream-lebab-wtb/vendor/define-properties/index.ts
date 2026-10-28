// Exact module body from JetStream 3.0 ./node_modules/define-properties/index.js.
// Dependencies are loaded at the original call sites; the cached export object is retained.
import {webpack, isRecord, record, runtimeProperty, runtimeConstructor} from "../../webpack.ts";
import {load as load0} from "../object-keys/index.ts";
import {load as load1} from "../define-data-property/index.ts";
import {load as load2} from "../has-property-descriptors/index.ts";

import type {ShimDefineProperties} from "../../shim-types.ts";
import {callableValue, present, stringValue, numberValue, stringArray, numericRelationalValue, concatenatedString} from "../lodash/runtime.ts";
import type {LodashCallable} from "../lodash/runtime.ts";
function propertyKeys(value: unknown): PropertyKey[] {
 if (!Array.isArray(value) || !value.every((key: unknown) => typeof key === "string" || typeof key === "number" || typeof key === "symbol")) throw new TypeError("Expected property keys");
 return value;
}

let cache: {exports: unknown} | undefined;
export function load(): ReturnType<typeof initialize> {
 if (cache !== undefined) {
  const value = cache.exports;
  if (!isExport(value)) throw new TypeError("Unexpected cached export for define-properties/index.js");
  return value;
 }
 return initialize();
}
function isExport(value: unknown): value is ReturnType<typeof initialize> {
 return typeof value === "function" && typeof record(value).supportsDescriptors === "boolean";
}
function initialize(): ShimDefineProperties {
let module: { exports: unknown; paths?: string[]; children?: unknown[] } = {exports: {}};
const exports = module.exports;
cache = module;


"use strict";


var keys = load0();
var hasSymbols = typeof Symbol === 'function' && typeof Symbol('foo') === 'symbol';

var toStr = Object.prototype.toString;
var concat = Array.prototype.concat;
var defineDataProperty = load1();

var isFunction = function (fn: unknown) {
	return typeof fn === 'function' && toStr.call(fn) === '[object Function]';
};

var supportsDescriptors = load2()();

var defineProperty = function (object: unknown, name: PropertyKey, value: unknown, predicate: unknown) {
	if (name in record(object)) {
		if (predicate === true) {
			if (runtimeProperty(object, name) === value) {
				return;
			}
		} else if (!isFunction(predicate) || !callableValue(predicate)()) {
			return;
		}
	}

	if (supportsDescriptors) {
		defineDataProperty(object, name, value, true);
	} else {
		defineDataProperty(object, name, value);
	}
};

var defineProperties: ((object: unknown, map: Record<PropertyKey, unknown>) => void) & {supportsDescriptors?: boolean} = function (object: unknown, map: Record<PropertyKey, unknown>) {
	var predicates: unknown = arguments.length > 2 ? arguments[2] : {};
	var props: PropertyKey[] = keys(map);
	if (hasSymbols) {
		props = propertyKeys(callableValue(concat).call(props, Object.getOwnPropertySymbols(map)));
	}
	for (var i = 0; i < props.length; i += 1) {
		defineProperty(object, props[i], map[props[i]], runtimeProperty(predicates, props[i]));
	}
};

defineProperties.supportsDescriptors = !!supportsDescriptors;

module.exports = defineProperties;


/***/ 
const completed = module.exports;
if (!isExport(completed)) throw new TypeError("Unexpected completed shim export");
return completed;
}
