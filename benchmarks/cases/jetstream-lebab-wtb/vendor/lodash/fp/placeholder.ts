// Exact module body from JetStream 3.0 ./node_modules/lodash/fp/placeholder.js.
// Dependencies are loaded at the original call sites; the cached export object is retained.
import {webpack, isRecord} from "../../../webpack.ts";

let cache: {exports: unknown} | undefined;
export function load(): ReturnType<typeof initialize> {
 if (cache !== undefined) {
  const value = cache.exports;
  if (!isExport(value)) throw new TypeError("Unexpected cached export for lodash/fp/placeholder.js");
  return value;
 }
 return initialize();
}
function isExport(value: unknown): value is ReturnType<typeof initialize> {
 return isRecord(value);
}
function initialize() {
let module: { exports: unknown; paths?: string[]; children?: unknown[] } = {exports: {}};
const exports = module.exports;
cache = module;


/**
 * The default argument placeholder value for methods.
 *
 * @type {Object}
 */
module.exports = {};


/***/ 
const result: unknown = module.exports;
if (!isRecord(result)) throw new TypeError("Expected the Lodash placeholder object");
return result;
}
