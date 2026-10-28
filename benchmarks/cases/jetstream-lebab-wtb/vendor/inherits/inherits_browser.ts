// Exact module body from JetStream 3.0 ./node_modules/inherits/inherits_browser.js.
// Dependencies are loaded at the original call sites; the cached export object is retained.
import {webpack, isRecord, record, runtimeProperty, runtimeConstructor} from "../../webpack.ts";

import {shimPrototypeAllocator} from "../../shim-types.ts";
import {callableValue, present, stringValue, numberValue, stringArray, numericRelationalValue, concatenatedString, writeProperty} from "../lodash/runtime.ts";
import type {LodashCallable} from "../lodash/runtime.ts";
let cache: {exports: unknown} | undefined;
export function load(): ReturnType<typeof initialize> {
 if (cache !== undefined) {
  const value = cache.exports;
  if (!isExport(value)) throw new TypeError("Unexpected cached export for inherits/inherits_browser.js");
  return value;
 }
 return initialize();
}
function isExport(value: unknown): value is ReturnType<typeof initialize> {
 return typeof value === "function";
}
function initialize(): (ctor: unknown, superCtor: unknown) => void {
let module: { exports: unknown; paths?: string[]; children?: unknown[] } = {exports: {}};
const exports = module.exports;
cache = module;


if (typeof Object.create === 'function') {
  // implementation from standard node.js 'util' module
  module.exports = function inherits(ctor: unknown, superCtor: unknown) {
    if (superCtor) {
      record(ctor).super_ = superCtor
      record(ctor).prototype = callableValue(Object.create)(runtimeProperty(superCtor, "prototype"), {
        constructor: {
          value: ctor,
          enumerable: false,
          writable: true,
          configurable: true
        }
      })
    }
  };
} else {
  // old school shim for old browsers
  module.exports = function inherits(ctor: unknown, superCtor: unknown) {
    if (superCtor) {
      record(ctor).super_ = superCtor
      var TempCtor = function () {}
      TempCtor.prototype = runtimeProperty(superCtor, "prototype")
      record(ctor).prototype = new (shimPrototypeAllocator(TempCtor))()
      writeProperty(runtimeProperty(ctor, "prototype"), "constructor", ctor)
    }
  }
}


/***/ 
const completed = module.exports;
if (!isExport(completed)) throw new TypeError("Unexpected completed shim export");
return completed;
}
