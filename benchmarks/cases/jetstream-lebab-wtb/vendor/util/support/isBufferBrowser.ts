// Exact module body from JetStream 3.0 ./node_modules/util/support/isBufferBrowser.js.
// Dependencies are loaded at the original call sites; the cached export object is retained.
import {webpack, isRecord, record, runtimeProperty} from "../../../webpack.ts";


let cache: {exports: unknown} | undefined;
export function load(): ReturnType<typeof initialize> {
 if (cache !== undefined) {
  const value = cache.exports;
  if (!isExport(value)) throw new TypeError("Unexpected cached export for util/support/isBufferBrowser.js");
  return value;
 }
 return initialize();
}
function isExport(value: unknown): value is ReturnType<typeof initialize> {
 return typeof value === "function";
}
function initialize(): (value: unknown) => unknown {
let module: { exports: unknown; paths?: string[]; children?: unknown[] } = {exports: {}};
const exports = module.exports;
cache = module;


module.exports = function isBuffer(arg: unknown) {
  return arg && typeof arg === 'object'
    && typeof record(arg).copy === 'function'
    && typeof record(arg).fill === 'function'
    && typeof record(arg).readUInt8 === 'function';
}

/***/ 
const completed = module.exports;
if (!isExport(completed)) throw new TypeError("Unexpected completed compatibility-module export");
return completed;
}
