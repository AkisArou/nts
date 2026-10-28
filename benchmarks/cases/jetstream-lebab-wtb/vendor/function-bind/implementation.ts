import {type ShimBind, shimPrototypeAllocator} from "../../shim-types.ts";
import {callableValue, present, type LodashCallable} from "../lodash/runtime.ts";
// Exact module body from JetStream 3.0 ./node_modules/function-bind/implementation.js.
// Dependencies are loaded at the original call sites; the cached export object is retained.
import {webpack, isRecord} from "../../webpack.ts";

let cache: {exports: unknown} | undefined;
export function load(): ReturnType<typeof initialize> {
 if (cache !== undefined) {
  const value = cache.exports;
  if (!isExport(value)) throw new TypeError("Unexpected cached export for function-bind/implementation.js");
  return value;
 }
 return initialize();
}
function isExport(value: unknown): value is ReturnType<typeof initialize> {
 return typeof value === "function";
}
function initialize(): ShimBind {
let module: { exports: unknown; paths?: string[]; children?: unknown[] } = {exports: {}};
const exports = module.exports;
cache = module;


"use strict";


/* eslint no-invalid-this: 1 */

var ERROR_MESSAGE = 'Function.prototype.bind called on incompatible ';
var toStr = Object.prototype.toString;
var max = Math.max;
var funcType = '[object Function]';

var concatty = function concatty(a: ArrayLike<unknown>, b: ArrayLike<unknown>): unknown[] {
    var arr: unknown[] = [];

    for (var i = 0; i < a.length; i += 1) {
        arr[i] = a[i];
    }
    for (var j = 0; j < b.length; j += 1) {
        arr[j + a.length] = b[j];
    }

    return arr;
};

var slicy = function slicy(arrLike: ArrayLike<unknown>, offset: number): unknown[] {
    var arr: unknown[] = [];
    for (var i = offset || 0, j = 0; i < arrLike.length; i += 1, j += 1) {
        arr[j] = arrLike[i];
    }
    return arr;
};

var joiny = function (arr: string[], joiner: string) {
    var str = '';
    for (var i = 0; i < arr.length; i += 1) {
        str += arr[i];
        if (i + 1 < arr.length) {
            str += joiner;
        }
    }
    return str;
};

module.exports = function bind(this: unknown, that?: unknown): LodashCallable {
    var target = this;
    if (typeof target !== 'function' || toStr.apply(target) !== funcType) {
        throw new TypeError(ERROR_MESSAGE + target);
    }
    var args = slicy(arguments, 1);

    var bound: LodashCallable | undefined;
    var binder = function (this: unknown): unknown {
        if (this instanceof present(bound)) {
            var result: unknown = callableValue(target).apply(
                this,
                concatty(args, arguments)
            );
            if (Object(result) === result) {
                return result;
            }
            return this;
        }
        return callableValue(target).apply(
            that,
            concatty(args, arguments)
        );

    };

    var boundLength = max(0, target.length - args.length);
    var boundArgs: string[] = [];
    for (var i = 0; i < boundLength; i++) {
        boundArgs[i] = '$' + i;
    }

    bound = callableValue(callableValue(Function('binder', 'return function (' + joiny(boundArgs, ',') + '){ return binder.apply(this,arguments); }'))(binder));

    if (target.prototype) {
        var Empty = function Empty() {};
        Empty.prototype = target.prototype;
        bound.prototype = new (shimPrototypeAllocator(Empty))();
        Empty.prototype = null;
    }

    return bound;
};


/***/ 
if (!isExport(module.exports)) throw new TypeError("Incomplete original function-bind/implementation exports");
return module.exports;
}
