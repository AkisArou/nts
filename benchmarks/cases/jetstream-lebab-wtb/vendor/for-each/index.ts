// Exact module body from JetStream 3.0 ./node_modules/for-each/index.js.
// Dependencies are loaded at the original call sites; the cached export object is retained.
import {webpack, isRecord, record, runtimeProperty, runtimeConstructor} from "../../webpack.ts";
import {load as load0} from "../is-callable/index.ts";

import {shimForInObject} from "../../shim-types.ts";
import type {ShimForEach} from "../../shim-types.ts";
import {callableValue, present, stringValue, numberValue, stringArray, numericRelationalValue, concatenatedString} from "../lodash/runtime.ts";
import type {LodashCallable} from "../lodash/runtime.ts";
let cache: {exports: unknown} | undefined;
export function load(): ReturnType<typeof initialize> {
 if (cache !== undefined) {
  const value = cache.exports;
  if (!isExport(value)) throw new TypeError("Unexpected cached export for for-each/index.js");
  return value;
 }
 return initialize();
}
function isExport(value: unknown): value is ReturnType<typeof initialize> {
 return typeof value === "function";
}
function initialize(): ShimForEach {
let module: { exports: unknown; paths?: string[]; children?: unknown[] } = {exports: {}};
const exports = module.exports;
cache = module;


"use strict";


var isCallable = load0();

var toStr = Object.prototype.toString;
var hasOwnProperty = Object.prototype.hasOwnProperty;

/** @type {<This, A extends readonly unknown[]>(arr: A, iterator: (this: This | void, value: A[number], index: number, arr: A) => void, receiver: This | undefined) => void} */
var forEachArray = function forEachArray(array: readonly unknown[], iterator: LodashCallable, receiver: unknown) {
    for (var i = 0, len = array.length; i < len; i++) {
        if (hasOwnProperty.call(array, i)) {
            if (receiver == null) {
                iterator(array[i], i, array);
            } else {
                iterator.call(receiver, array[i], i, array);
            }
        }
    }
};

/** @type {<This, S extends string>(string: S, iterator: (this: This | void, value: S[number], index: number, string: S) => void, receiver: This | undefined) => void} */
var forEachString = function forEachString(string: string, iterator: LodashCallable, receiver: unknown) {
    for (var i = 0, len = string.length; i < len; i++) {
        // no such thing as a sparse string.
        if (receiver == null) {
            iterator(string.charAt(i), i, string);
        } else {
            iterator.call(receiver, string.charAt(i), i, string);
        }
    }
};

/** @type {<This, O>(obj: O, iterator: (this: This | void, value: O[keyof O], index: keyof O, obj: O) => void, receiver: This | undefined) => void} */
var forEachObject = function forEachObject(object: unknown, iterator: LodashCallable, receiver: unknown) {
    for (var k in shimForInObject(object)) {
        if (hasOwnProperty.call(object, k)) {
            if (receiver == null) {
                iterator(runtimeProperty(object, k), k, object);
            } else {
                iterator.call(receiver, runtimeProperty(object, k), k, object);
            }
        }
    }
};

/** @type {(x: unknown) => x is readonly unknown[]} */
function isArray(x: unknown): x is readonly unknown[] {
    return toStr.call(x) === '[object Array]';
}

/** @type {import('.')._internal} */
module.exports = function forEach(list: unknown, iterator: unknown, thisArg: unknown) {
    if (!isCallable(iterator)) {
        throw new TypeError('iterator must be a function');
    }

    var receiver: unknown;
    if (arguments.length >= 3) {
        receiver = thisArg;
    }

    if (isArray(list)) {
        forEachArray(list, iterator, receiver);
    } else if (typeof list === 'string') {
        forEachString(list, iterator, receiver);
    } else {
        forEachObject(list, iterator, receiver);
    }
};


/***/ 
const completed = module.exports;
if (!isExport(completed)) throw new TypeError("Unexpected completed shim export");
return completed;
}
