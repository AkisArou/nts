import type {Constructor, Descriptor} from "../../../../webpack.ts";
import type {AstNode} from "../../../../ast.ts";
// Exact module body from JetStream 3.0 ./node_modules/lebab/lib/utils/copyComments.js.
// Dependencies are loaded at the original call sites; the cached export object is retained.
import {exportsReady, webpack, isRecord, record, readProperty, symbolValue, primitiveMethod, hasEsModuleFlag} from "../../../../webpack.ts";

let cache: {exports: Partial<ReturnType<typeof initialize>>} | undefined;
export function load(): ReturnType<typeof initialize> {
 if (cache !== undefined) {
  const value = cache.exports;
  if (!isExport(value)) throw new TypeError("Unexpected cached export for lebab/lib/utils/copyComments.js");
  return value;
 }
 return initialize();
}
function isExport(value: Partial<ReturnType<typeof initialize>>): value is ReturnType<typeof initialize> {
 return isRecord(value) && value.__esModule === true && value["default"] !== undefined;
}
function initialize() {
const exports: { __esModule?: true; "default"?: typeof copyComments; } = {};
let module = {exports};
cache = module;


"use strict";


Object.defineProperty(exports, "__esModule", ({
  value: true
}));
exports["default"] = copyComments;
/**
 * Appends comments of one node to comments of another.
 *
 * - Modifies `to` node with added comments.
 * - Does nothing when there are no comments to copy
 *   (ensuring we don't modify the `to` node when not needed).
 *
 * @param  {Object} from Node to copy comments from
 * @param  {Object} to Node to copy comments to
 */
function copyComments(_ref: {from: AstNode | undefined; to: AstNode}) {
  var from = _ref.from,
    to = _ref.to;
  if (from!.comments && from!.comments.length > 0) {
    to.comments = (to.comments || []).concat(from!.comments || []);
  }
}

/***/ 
if (!hasEsModuleFlag(exports)) throw new TypeError("Expected the initialized ES module flag");
if (!exportsReady(exports, ["default"])) throw new TypeError("Incomplete bundled exports");
return exports;
}
