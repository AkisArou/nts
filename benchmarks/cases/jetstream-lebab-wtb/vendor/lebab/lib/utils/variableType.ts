import type {namedTypes as N} from "../../../../types/ast-types/gen/namedTypes.js";
import type {AstNode, LoggerLike} from "../../../../ast.ts";
import type {Constructor, Descriptor} from "../../../../webpack.ts";
// Exact module body from JetStream 3.0 ./node_modules/lebab/lib/utils/variableType.js.
// Dependencies are loaded at the original call sites; the cached export object is retained.
import {exportsReady, webpack, isRecord, record, readProperty, symbolValue, primitiveMethod, hasEsModuleFlag} from "../../../../webpack.ts";
import {load as load0} from "./functionType.ts";

let cache: {exports: Partial<ReturnType<typeof initialize>>} | undefined;
export function load(): ReturnType<typeof initialize> {
 if (cache !== undefined) {
  const value = cache.exports;
  if (!isExport(value)) throw new TypeError("Unexpected cached export for lebab/lib/utils/variableType.js");
  return value;
 }
 return initialize();
}
function isExport(value: Partial<ReturnType<typeof initialize>>): value is ReturnType<typeof initialize> {
 return isRecord(value) && value.__esModule === true && value["isReference"] !== undefined && value["isUpdate"] !== undefined;
}
function initialize() {
const exports: { __esModule?: true; "isReference"?: typeof isReference; "isUpdate"?: typeof isUpdate; } = {};
let module = {exports};
cache = module;


"use strict";


Object.defineProperty(exports, "__esModule", ({
  value: true
}));
exports.isReference = isReference;
exports.isUpdate = isUpdate;
var _functionType = load0();
/**
 * True when node is variable update expression (like x++).
 *
 * @param {Object} node
 * @return {Boolean}
 */
function isUpdate(node: AstNode): node is N.UpdateExpression & {argument: N.Identifier} {
  return node.type === 'UpdateExpression' && node.argument.type === 'Identifier';
}

/**
 * True when node is reference to a variable.
 *
 * That is it's an identifier, that's not used:
 *
 * - as function name in function declaration/expression,
 * - as parameter name in function declaration/expression,
 * - as declared variable name in variable declaration,
 * - as object property name in member expression.
 * - as object property name in object literal.
 *
 * @param {Object} node
 * @param {Object} parent Immediate parent node (to determine context)
 * @return {Boolean}
 */
function isReference(node: AstNode, parent: AstNode | null): node is N.Identifier {
  return node.type === 'Identifier' && !isFunctionName(node, parent) && !isFunctionParameter(node, parent) && !isDeclaredVariable(node, parent) && !isPropertyInMemberExpression(node, parent) && !isPropertyInObjectLiteral(node, parent);
}
function isFunctionName(node: AstNode, parent: AstNode | null) {
  return (0, _functionType.isFunction)(parent) && parent!.id === node;
}
function isFunctionParameter(node: AstNode, parent: AstNode | null) {
  return (0, _functionType.isFunction)(parent) && parent.params.some(function (p) {
    return p === node;
  });
}
function isDeclaredVariable(node: AstNode, parent: AstNode | null) {
  return parent!.type === 'VariableDeclarator' && parent!.id === node;
}
function isPropertyInMemberExpression(node: AstNode, parent: AstNode | null) {
  return parent!.type === 'MemberExpression' && parent!.property === node && !parent!.computed;
}
function isPropertyInObjectLiteral(node: AstNode, parent: AstNode | null) {
  return parent!.type === 'Property' && parent!.key === node;
}

/***/ 
if (!hasEsModuleFlag(exports)) throw new TypeError("Expected the initialized ES module flag");
if (!exportsReady(exports, ["isReference","isUpdate"])) throw new TypeError("Incomplete bundled exports");
return exports;
}
