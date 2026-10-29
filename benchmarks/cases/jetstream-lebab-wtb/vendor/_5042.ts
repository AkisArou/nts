// Exact module body from JetStream 3.0 ?5042.
// Dependencies are loaded at the original call sites; the cached export object is retained.
import {webpack, isRecord} from "../webpack.ts";

let cache: {exports: unknown} | undefined;
export function load(): ReturnType<typeof initialize> {
 if (cache !== undefined) {
  const value = cache.exports;
  if (!isExport(value)) throw new TypeError("Unexpected cached export for _5042.js");
  return value;
 }
 return initialize();
}
function isExport(value: unknown): value is ReturnType<typeof initialize> {
 return isRecord(value);
}
function initialize() {
const exports: { __esModule?: boolean;  } = {};
let module = {exports};
cache = module;


/* (ignored) */

/***/ 
return exports;
}
