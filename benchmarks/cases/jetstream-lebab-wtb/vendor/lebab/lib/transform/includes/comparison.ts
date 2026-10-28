import type {Constructor, Descriptor} from "../../../../../webpack.ts";
// Exact module body from JetStream 3.0 ./node_modules/lebab/lib/transform/includes/comparison.js.
// Dependencies are loaded at the original call sites; the cached export object is retained.
import {exportsReady, webpack, isRecord, record, readProperty, symbolValue, primitiveMethod, hasEsModuleFlag} from "../../../../../webpack.ts";
import {load as load0} from "./matchesIndexOf.ts";

let cache: {exports: Partial<ReturnType<typeof initialize>>} | undefined;
export function load(): ReturnType<typeof initialize> {
 if (cache !== undefined) {
  const value = cache.exports;
  if (!isExport(value)) throw new TypeError("Unexpected cached export for lebab/lib/transform/includes/comparison.js");
  return value;
 }
 return initialize();
}
function isExport(value: Partial<ReturnType<typeof initialize>>): value is ReturnType<typeof initialize> {
 return isRecord(value) && value.__esModule === true && value["isIncludesComparison"] !== undefined && value["isNotIncludesComparison"] !== undefined;
}
function initialize() {
const exports: { __esModule?: true; "isIncludesComparison"?: typeof isIncludesComparison; "isNotIncludesComparison"?: typeof isNotIncludesComparison; } = {};
let module = {exports};
cache = module;


"use strict";


Object.defineProperty(exports, "__esModule", ({
  value: true
}));
exports.isIncludesComparison = isIncludesComparison;
exports.isNotIncludesComparison = isNotIncludesComparison;
var _matchesIndexOf = load0();
/**
 * True when indexOf() comparison can be translated to includes()
 * @param {Object} matches
 * @return {Boolean}
 */
function isIncludesComparison(_ref: Record<string, unknown>) {
  var operator = _ref.operator,
    index = _ref.index;
  switch (operator) {
    case '!==':
    case '!=':
    case '>':
      return (0, _matchesIndexOf.isMinusOne)(index);
    case '>=':
      return (0, _matchesIndexOf.isZero)(index);
    default:
      return false;
  }
}

/**
 * True when indexOf() comparison can be translated to !includes()
 * @param {Object} matches
 * @return {Boolean}
 */
function isNotIncludesComparison(_ref2: Record<string, unknown>) {
  var operator = _ref2.operator,
    index = _ref2.index;
  switch (operator) {
    case '===':
    case '==':
      return (0, _matchesIndexOf.isMinusOne)(index);
    case '<':
      return (0, _matchesIndexOf.isZero)(index);
    default:
      return false;
  }
}

/***/ 
if (!hasEsModuleFlag(exports)) throw new TypeError("Expected the initialized ES module flag");
if (!exportsReady(exports, ["isIncludesComparison","isNotIncludesComparison"])) throw new TypeError("Incomplete bundled exports");
return exports;
}
