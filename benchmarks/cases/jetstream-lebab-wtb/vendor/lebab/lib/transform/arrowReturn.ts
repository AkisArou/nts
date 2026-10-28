import type {namedTypes as N} from "../../../../types/ast-types/gen/namedTypes.js";
import type * as K from "../../../../types/ast-types/gen/kinds.js";
import {classNode, classExpression} from "./runtime-transforms.ts";
import {arrowFunction} from "./runtime-remaining.ts";
import type {AstNode, LoggerLike} from "../../../../ast.ts";
import type {Constructor, Descriptor} from "../../../../webpack.ts";
// Exact module body from JetStream 3.0 ./node_modules/lebab/lib/transform/arrowReturn.js.
// Dependencies are loaded at the original call sites; the cached export object is retained.
import {exportsReady, webpack, isRecord, record, readProperty, symbolValue, primitiveMethod, hasEsModuleFlag} from "../../../../webpack.ts";
import {load as load0} from "../traverser.ts";
import {load as load1} from "../../../f-matches/index.ts";
import {load as load2} from "../utils/copyComments.ts";
import {load as load3} from "../../../lodash/fp.ts";

let cache: {exports: Partial<ReturnType<typeof initialize>>} | undefined;
export function load(): ReturnType<typeof initialize> {
 if (cache !== undefined) {
  const value = cache.exports;
  if (!isExport(value)) throw new TypeError("Unexpected cached export for lebab/lib/transform/arrowReturn.js");
  return value;
 }
 return initialize();
}
function isExport(value: Partial<ReturnType<typeof initialize>>): value is ReturnType<typeof initialize> {
 return isRecord(value) && value.__esModule === true && value["default"] !== undefined;
}
function initialize() {
const exports: { __esModule?: true; "default"?: typeof _default; } = {};
let module = {exports};
cache = module;


"use strict";


Object.defineProperty(exports, "__esModule", ({
  value: true
}));
exports["default"] = _default;
var _traverser = _interopRequireDefault(load0());
var _fMatches = load1();
var _copyComments = _interopRequireDefault(load2());
var _fp = load3();
function _interopRequireDefault<T extends {__esModule: true}>(obj: T): T;
function _interopRequireDefault<T>(obj: T): {default: T};
function _interopRequireDefault(obj: unknown) { return obj && readProperty(obj, "__esModule") ? obj : { "default": obj }; }
function _default(ast: AstNode) {
  (_traverser["default"]!).replace(ast, {
    enter: function enter(node: AstNode) {
      if (isShortenableArrowFunction(node)) {
        return shortenReturn(arrowFunction(node));
      }
    }
  });
}
function shortenReturn(node: N.ArrowFunctionExpression) {
  node.body = extractArrowBody(node.body);
  return node;
}
var matchesReturnBlock = (0, _fMatches.matches)({
  type: 'BlockStatement',
  body: (0, _fMatches.matchesLength)([(0, _fMatches.extract)('returnStatement', {
    type: 'ReturnStatement',
    argument: (0, _fMatches.extract)('returnVal', (0, _fp.negate)(_fp.isNull))
  })])
});
function isShortenableArrowFunction(node: AstNode) {
  return node.type === 'ArrowFunctionExpression' && matchesReturnBlock(node.body);
}
function extractArrowBody(block: AstNode): K.ExpressionKind {
  var _matchesReturnBlock = matchesReturnBlock(block),
    returnStatement = readProperty(_matchesReturnBlock, "returnStatement"),
    returnVal = readProperty(_matchesReturnBlock, "returnVal");
  // preserve return statement comments
  (0, _copyComments["default"])({
    from: classNode(returnStatement),
    to: classExpression(returnVal)
  });
  return classExpression(returnVal);
}

/***/ 
if (!hasEsModuleFlag(exports)) throw new TypeError("Expected the initialized ES module flag");
if (!exportsReady(exports, ["default"])) throw new TypeError("Incomplete bundled exports");
return exports;
}
