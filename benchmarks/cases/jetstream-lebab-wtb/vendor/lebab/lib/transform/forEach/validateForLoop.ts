import type * as K from "../../../../../types/ast-types/gen/kinds.js";
import type {namedTypes as N} from "../../../../../types/ast-types/gen/namedTypes.js";
import type {FunctionNode} from "../../../../../escope-types.ts";
import {classText, optionalText, classNode, classBlock, classFunction, classExpression, classIdentifier, loopMatch, forLoop, programNode, assignmentPattern, warningArgs, strings, type LoopMatch, type DefaultInfo} from "../runtime-transforms.ts";
import type {AstNode, LoggerLike} from "../../../../../ast.ts";
import type {Constructor, Descriptor} from "../../../../../webpack.ts";
// Exact module body from JetStream 3.0 ./node_modules/lebab/lib/transform/forEach/validateForLoop.js.
// Dependencies are loaded at the original call sites; the cached export object is retained.
import {exportsReady, webpack, isRecord, record, readProperty, symbolValue, primitiveMethod, hasEsModuleFlag} from "../../../../../webpack.ts";
import {load as load0} from "../../traverser.ts";

let cache: {exports: Partial<ReturnType<typeof initialize>>} | undefined;
export function load(): ReturnType<typeof initialize> {
 if (cache !== undefined) {
  const value = cache.exports;
  if (!isExport(value)) throw new TypeError("Unexpected cached export for lebab/lib/transform/forEach/validateForLoop.js");
  return value;
 }
 return initialize();
}
function isExport(value: Partial<ReturnType<typeof initialize>>): value is ReturnType<typeof initialize> {
 return isRecord(value) && value.__esModule === true && value["default"] !== undefined;
}
function initialize() {
const exports: { __esModule?: true; "default"?: typeof validateForLoop; } = {};
let module = {exports};
cache = module;


"use strict";


Object.defineProperty(exports, "__esModule", ({
  value: true
}));
exports["default"] = validateForLoop;
var _traverser = _interopRequireDefault(load0());
function _interopRequireDefault<T extends {__esModule: true}>(obj: T): T;
function _interopRequireDefault<T>(obj: T): {default: T};
function _interopRequireDefault(obj: unknown) { return obj && readProperty(obj, "__esModule") ? obj : { "default": obj }; }
/**
 * Checks that for-loop can be transformed to Array.forEach()
 *
 * Returns a warning message in case we can't transform.
 *
 * @param  {Object} node The ForStatement
 * @param  {Object} body BlockStatement that's body of ForStatement
 * @param  {String} indexKind
 * @param  {String} itemKind
 * @return {Array} Array of node and warnings message or undefined on success.
 */
function validateForLoop(node: AstNode, _ref: LoopMatch): [AstNode, string] | undefined {
  var body = _ref.body,
    indexKind = _ref.indexKind,
    itemKind = _ref.itemKind;
  var statement: AstNode | undefined;
  if (statement = returnUsed(body)) {
    return [statement, 'Return statement used in for-loop body'];
  } else if (statement = breakWithLabelUsed(body)) {
    return [statement, 'Break statement with label used in for-loop body'];
  } else if (statement = continueWithLabelUsed(body)) {
    return [statement, 'Continue statement with label used in for-loop body'];
  } else if (statement = breakUsed(body)) {
    return [statement, 'Break statement used in for-loop body'];
  } else if (statement = continueUsed(body)) {
    return [statement, 'Continue statement used in for-loop body'];
  } else if (indexKind !== 'let') {
    return [node, 'Only for-loops with indexes declared as let can be transformed (use let transform first)'];
  } else if (itemKind !== 'const') {
    return [node, 'Only for-loops with const array items can be transformed (use let transform first)'];
  }
}
var loopStatements = ['ForStatement', 'ForInStatement', 'ForOfStatement', 'DoWhileStatement', 'WhileStatement'];
function returnUsed(body: N.BlockStatement) {
  return (_traverser["default"]!).find(body, 'ReturnStatement');
}
function breakWithLabelUsed(body: N.BlockStatement) {
  return (_traverser["default"]!).find(body, function (_ref2) {
    var type = _ref2.type,
      label = readProperty(_ref2, "label");
    return type === 'BreakStatement' && label;
  });
}
function continueWithLabelUsed(body: N.BlockStatement) {
  return (_traverser["default"]!).find(body, function (_ref3) {
    var type = _ref3.type,
      label = readProperty(_ref3, "label");
    return type === 'ContinueStatement' && label;
  });
}
function breakUsed(body: N.BlockStatement) {
  return (_traverser["default"]!).find(body, 'BreakStatement', {
    skipTypes: strings([]).concat(loopStatements, ['SwitchStatement'])
  });
}
function continueUsed(body: N.BlockStatement) {
  return (_traverser["default"]!).find(body, 'ContinueStatement', {
    skipTypes: loopStatements
  });
}

/***/ 
if (!hasEsModuleFlag(exports)) throw new TypeError("Expected the initialized ES module flag");
if (!exportsReady(exports, ["default"])) throw new TypeError("Incomplete bundled exports");
return exports;
}
