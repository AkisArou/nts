import type * as K from "../../../../types/ast-types/gen/kinds.js";
import type {namedTypes as N} from "../../../../types/ast-types/gen/namedTypes.js";
import type {FunctionNode} from "../../../../escope-types.ts";
import {classText, optionalText, classNode, classBlock, classFunction, classExpression, classIdentifier, loopMatch, forLoop, programNode, assignmentPattern, warningArgs, strings, type LoopMatch, type DefaultInfo} from "./runtime-transforms.ts";
import type {AstNode, LoggerLike} from "../../../../ast.ts";
import type {Constructor, Descriptor} from "../../../../webpack.ts";
// Exact module body from JetStream 3.0 ./node_modules/lebab/lib/transform/forOf.js.
// Dependencies are loaded at the original call sites; the cached export object is retained.
import {exportsReady, webpack, isRecord, record, readProperty, symbolValue, primitiveMethod, hasEsModuleFlag} from "../../../../webpack.ts";
import {load as load0} from "../../../lodash/fp.ts";
import {load as load1} from "../traverser.ts";
import {load as load2} from "../utils/isEqualAst.ts";
import {load as load3} from "../utils/variableType.ts";
import {load as load4} from "../utils/copyComments.ts";
import {load as load5} from "../utils/matchAliasedForLoop.ts";

let cache: {exports: Partial<ReturnType<typeof initialize>>} | undefined;
export function load(): ReturnType<typeof initialize> {
 if (cache !== undefined) {
  const value = cache.exports;
  if (!isExport(value)) throw new TypeError("Unexpected cached export for lebab/lib/transform/forOf.js");
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
var _fp = load0();
var _traverser = _interopRequireDefault(load1());
var _isEqualAst = _interopRequireDefault(load2());
var _variableType = load3();
var _copyComments = _interopRequireDefault(load4());
var _matchAliasedForLoop = _interopRequireDefault(load5());
function _interopRequireDefault<T extends {__esModule: true}>(obj: T): T;
function _interopRequireDefault<T>(obj: T): {default: T};
function _interopRequireDefault(obj: unknown) { return obj && readProperty(obj, "__esModule") ? obj : { "default": obj }; }
var _typeof = function(obj: unknown): string { "@babel/helpers - typeof"; return _typeof = "function" == typeof Symbol && "symbol" == typeof Symbol.iterator ? function (obj: unknown) { return typeof obj; } : function (obj: unknown) { return obj && "function" == typeof Symbol && readProperty(obj, "constructor") === Symbol && obj !== Symbol.prototype ? "symbol" : typeof obj; }, _typeof(obj); };
function ownKeys(object: object, enumerableOnly?: boolean) { var keys: PropertyKey[] = Object.keys(object); if (Object.getOwnPropertySymbols) { var symbols = Object.getOwnPropertySymbols(object); enumerableOnly && (symbols = symbols.filter(function (sym) { return Object.getOwnPropertyDescriptor(object, sym)!.enumerable; })), keys.push.apply(keys, symbols); } return keys; }
function _objectSpread<T extends object>(target: T, ...sources: unknown[]): T;
function _objectSpread(target: object): object { for (var i = 1; i < arguments.length; i++) { var source: unknown = null != arguments[i] ? arguments[i] : {}; i % 2 ? ownKeys(Object(source), !0).forEach(function (key) { _defineProperty(target, key, readProperty(source, key)); }) : Object.getOwnPropertyDescriptors ? Object.defineProperties(target, Object.getOwnPropertyDescriptors(source)) : ownKeys(Object(source)).forEach(function (key) { Object.defineProperty(target, key, Object.getOwnPropertyDescriptor(source, key)!); }); } return target; }
function _defineProperty<T extends object>(obj: T, key: PropertyKey, value: unknown) { key = _toPropertyKey(key); if (key in obj) { Object.defineProperty(obj, key, { value: value, enumerable: true, configurable: true, writable: true }); } else { record(obj)[key] = value; } return obj; }
function _toPropertyKey(arg: unknown): PropertyKey { var key = _toPrimitive(arg, "string"); return _typeof(key) === "symbol" ? symbolValue(key) : String(key); }
function _toPrimitive(input: unknown, hint?: string): unknown { if (_typeof(input) !== "object" || input === null) return input; var prim = primitiveMethod(readProperty(input, Symbol.toPrimitive)); if (prim !== undefined) { var res = prim.call(input, hint || "default"); if (_typeof(res) !== "object") return res; throw new TypeError("@@toPrimitive must return a primitive value."); } return (hint === "string" ? String : Number)(input); }
function _default(ast: AstNode, logger: LoggerLike) {
  (_traverser["default"]!).replace(ast, {
    enter: function enter(node: AstNode) {
      var matches = loopMatch((0, _matchAliasedForLoop["default"])(node));
      if (matches) {
        if (indexUsedInBody(matches)) {
          logger.warn(node, 'Index variable used in for-loop body', 'for-of');
          return;
        }
        if (matches.itemKind === 'var' || matches.indexKind === 'var') {
          logger.warn(node, 'Only for-loops with let/const can be transformed (use let transform first)', 'for-of');
          return;
        }
        return withComments(node, createForOf(matches));
      }
      if (node.type === 'ForStatement') {
        logger.warn(node, 'Unable to transform for loop', 'for-of');
      }
    }
  });
}
function indexUsedInBody(_ref: LoopMatch) {
  var body = _ref.body,
    index = _ref.index;
  return (_traverser["default"]!).find(removeFirstBodyElement(body), function (node: AstNode, parent: AstNode | null) {
    return (0, _isEqualAst["default"])(node, index) && (0, _variableType.isReference)(node, parent);
  });
}
function withComments(node: AstNode, forOf: AstNode) {
  (0, _copyComments["default"])({
    from: node,
    to: forOf
  });
  (0, _copyComments["default"])({
    from: classBlock(forLoop(node).body).body[0],
    to: forOf
  });
  return forOf;
}
function createForOf(_ref2: LoopMatch) {
  var item = _ref2.item,
    itemKind = _ref2.itemKind,
    array = _ref2.array,
    body = _ref2.body;
  return classNode({
    type: 'ForOfStatement',
    left: {
      type: 'VariableDeclaration',
      declarations: [{
        type: 'VariableDeclarator',
        id: item,
        init: null // eslint-disable-line no-null/no-null
      }],
      kind: itemKind
    },
    right: array,
    body: removeFirstBodyElement(body)
  });
}
function removeFirstBodyElement(body: N.BlockStatement): N.BlockStatement {
  return classBlock(_objectSpread(_objectSpread({}, body), {}, {
    body: (0, _fp.tail)(body.body)
  }));
}

/***/ 
if (!hasEsModuleFlag(exports)) throw new TypeError("Expected the initialized ES module flag");
if (!exportsReady(exports, ["default"])) throw new TypeError("Incomplete bundled exports");
return exports;
}
