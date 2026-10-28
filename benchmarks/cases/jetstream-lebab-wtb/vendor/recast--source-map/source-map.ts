// Exact module body from JetStream 3.0 ./node_modules/recast/node_modules/source-map/source-map.js.
// Dependencies are loaded at the original call sites; the cached export object is retained.
import {webpack, isRecord, exportsReady} from "../../webpack.ts";
import {load as load0} from "./lib/source-map-generator.ts";
import {load as load1} from "./lib/source-map-consumer.ts";
import {load as load2} from "./lib/source-node.ts";

let cache: {exports: unknown} | undefined;
export function load(): ReturnType<typeof initialize> {
 if (cache !== undefined) {
  const value = cache.exports;
  if (!isExport(value)) throw new TypeError("Unexpected cached export for recast--source-map/source-map.js");
  return value;
 }
 return initialize();
}
function isExport(value: unknown): value is ReturnType<typeof initialize> {
 return isRecord(value) && typeof value.SourceMapGenerator === "function" && typeof value.SourceMapConsumer === "function" && typeof value.SourceNode === "function";
}
function initialize() {
const exports: { "SourceMapGenerator"?: ReturnType<typeof load0>["SourceMapGenerator"]; "SourceMapConsumer"?: ReturnType<typeof load1>["SourceMapConsumer"]; "SourceNode"?: ReturnType<typeof load2>["SourceNode"]; } = {};
let module = {exports};
cache = module;


/*
 * Copyright 2009-2011 Mozilla Foundation and contributors
 * Licensed under the New BSD license. See LICENSE.txt or:
 * http://opensource.org/licenses/BSD-3-Clause
 */
exports.SourceMapGenerator = load0().SourceMapGenerator;
exports.SourceMapConsumer = load1().SourceMapConsumer;
exports.SourceNode = load2().SourceNode;


/***/ 
if (!exportsReady(exports, ["SourceMapGenerator", "SourceMapConsumer", "SourceNode"])) throw new TypeError("Incomplete original source-map exports");
return exports;
}
