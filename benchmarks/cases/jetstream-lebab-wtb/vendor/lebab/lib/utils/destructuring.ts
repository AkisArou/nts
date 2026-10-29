import type {namedTypes as N} from "../../../../types/ast-types/gen/namedTypes.js";
import type {AstNode, LoggerLike} from "../../../../ast.ts";
import type {Constructor, Descriptor} from "../../../../webpack.ts";
// Exact module body from JetStream 3.0 ./node_modules/lebab/lib/utils/destructuring.js.
// Dependencies are loaded at the original call sites; the cached export object is retained.
import {exportsReady, webpack, isRecord, record, readProperty, symbolValue, primitiveMethod, hasEsModuleFlag} from "../../../../webpack.ts";
import {load as load0} from "../../../lodash/fp.ts";

let cache: {exports: Partial<ReturnType<typeof initialize>>} | undefined;
export function load(): ReturnType<typeof initialize> {
 if (cache !== undefined) {
  const value = cache.exports;
  if (!isExport(value)) throw new TypeError("Unexpected cached export for lebab/lib/utils/destructuring.js");
  return value;
 }
 return initialize();
}
function isExport(value: Partial<ReturnType<typeof initialize>>): value is ReturnType<typeof initialize> {
 return isRecord(value) && value.__esModule === true && value["extractVariableNames"] !== undefined && value["extractVariables"] !== undefined;
}
function initialize() {
const exports: { __esModule?: true; "extractVariableNames"?: typeof extractVariableNames; "extractVariables"?: typeof extractVariables; } = {};
let module = {exports};
cache = module;


"use strict";


Object.defineProperty(exports, "__esModule", ({
  value: true
}));
exports.extractVariableNames = extractVariableNames;
exports.extractVariables = extractVariables;
var _fp = load0();
/**
 * Extracts all variables from from destructuring
 * operation in assignment or variable declaration.
 *
 * Also works for a single identifier (so it generalizes
 * for all assignments / variable declarations).
 *
 * @param  {Object} node
 * @return {Object[]} Identifiers
 */
function extractVariables(node: AstNode): N.Identifier[] {
  if (node.type === 'Identifier') {
    return [node];
  }
  if (node.type === 'ArrayPattern') {
    // Use compact() to ignore missing elements in ArrayPattern
    return (0, _fp.flatMap)(extractVariables, (0, _fp.compact)(node.elements));
  }
  if (node.type === 'ObjectPattern') {
    return (0, _fp.flatMap)(extractVariables, node.properties);
  }
  if (node.type === 'Property') {
    return extractVariables(node.value);
  }
  if (node.type === 'AssignmentPattern') {
    return extractVariables(node.left);
  }

  // Ignore stuff like MemberExpressions,
  // we only care about variables.
  return [];
}

/**
 * Like extractVariables(), but returns the names of variables
 * instead of Identifier objects.
 *
 * @param  {Object} node
 * @return {String[]} variable names
 */
function extractVariableNames(node: AstNode): string[] {
  return extractVariables(node).map(function (v) {
    return v.name;
  });
}

/***/ 
if (!hasEsModuleFlag(exports)) throw new TypeError("Expected the initialized ES module flag");
if (!exportsReady(exports, ["extractVariableNames","extractVariables"])) throw new TypeError("Incomplete bundled exports");
return exports;
}
