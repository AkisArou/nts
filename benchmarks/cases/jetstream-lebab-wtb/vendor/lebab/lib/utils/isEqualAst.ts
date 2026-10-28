import type {Constructor, Descriptor} from "../../../../webpack.ts";
// Exact module body from JetStream 3.0 ./node_modules/lebab/lib/utils/isEqualAst.js.
// Dependencies are loaded at the original call sites; the cached export object is retained.
import {exportsReady, webpack, isRecord, record, readProperty, symbolValue, primitiveMethod, hasEsModuleFlag} from "../../../../webpack.ts";
import {propertyKey} from "../../../lodash/runtime.ts";
import {load as load0} from "../../../lodash/fp.ts";

let cache: {exports: Partial<ReturnType<typeof initialize>>} | undefined;
export function load(): ReturnType<typeof initialize> {
 if (cache !== undefined) {
  const value = cache.exports;
  if (!isExport(value)) throw new TypeError("Unexpected cached export for lebab/lib/utils/isEqualAst.js");
  return value;
 }
 return initialize();
}
function isExport(value: Partial<ReturnType<typeof initialize>>): value is ReturnType<typeof initialize> {
 return isRecord(value) && value.__esModule === true && value["default"] !== undefined;
}
function initialize() {
const exports: { __esModule?: true; "default"?: typeof isEqualAst; } = {};
let module = {exports};
cache = module;


"use strict";


Object.defineProperty(exports, "__esModule", ({
  value: true
}));
exports["default"] = isEqualAst;
var _fp = load0();
var metaDataFields = {
  comments: true,
  loc: true,
  start: true,
  end: true
};

/**
 * True when two AST nodes are structurally equal.
 * When comparing objects it ignores the meta-data fields for
 * comments and source-code position.
 * @param  {Object}  a
 * @param  {Object}  b
 * @return {Boolean}
 */
function isEqualAst(a: unknown, b: unknown) {
  return (0, _fp.isEqualWith)(function (aValue, bValue, key) {
    return readProperty(metaDataFields, propertyKey(key));
  }, a, b);
}

/***/ 
if (!hasEsModuleFlag(exports)) throw new TypeError("Expected the initialized ES module flag");
if (!exportsReady(exports, ["default"])) throw new TypeError("Incomplete bundled exports");
return exports;
}
