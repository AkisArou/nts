import type * as K from "../../../../../types/ast-types/gen/kinds.js";
import type {namedTypes as N} from "../../../../../types/ast-types/gen/namedTypes.js";
import type {FunctionNode} from "../../../../../escope-types.ts";
import {classText, optionalText, classNode, classBlock, classFunction, classExpression, classIdentifier, loopMatch, forLoop, programNode, assignmentPattern, warningArgs, strings, type LoopMatch, type DefaultInfo} from "../runtime-transforms.ts";
import {nativeRegExpTest} from "../../../../../emitted-helper-types.ts";
import type {AstNode, LoggerLike} from "../../../../../ast.ts";
import type {Constructor, Descriptor} from "../../../../../webpack.ts";
// Exact module body from JetStream 3.0 ./node_modules/lebab/lib/transform/forEach/index.js.
// Dependencies are loaded at the original call sites; the cached export object is retained.
import {runtimeCallable, runtimeProperty, runtimeCall, runtimeArrayLike, runtimeArrayLikeOrIterable, runtimeIteratorResult, exportsReady, webpack, isRecord, record, readProperty, symbolValue, primitiveMethod, hasEsModuleFlag} from "../../../../../webpack.ts";
import {load as load0} from "../../../../lodash/fp.ts";
import {load as load1} from "../../traverser.ts";
import {load as load2} from "../../utils/isEqualAst.ts";
import {load as load3} from "../../utils/variableType.ts";
import {load as load4} from "../../utils/copyComments.ts";
import {load as load5} from "../../utils/matchAliasedForLoop.ts";
import {load as load6} from "./validateForLoop.ts";

let cache: {exports: Partial<ReturnType<typeof initialize>>} | undefined;
export function load(): ReturnType<typeof initialize> {
 if (cache !== undefined) {
  const value = cache.exports;
  if (!isExport(value)) throw new TypeError("Unexpected cached export for lebab/lib/transform/forEach/index.js");
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


var _typeof = function(obj: unknown): string { "@babel/helpers - typeof"; return _typeof = "function" == typeof Symbol && "symbol" == typeof Symbol.iterator ? function (obj: unknown) { return typeof obj; } : function (obj: unknown) { return obj && "function" == typeof Symbol && readProperty(obj, "constructor") === Symbol && obj !== Symbol.prototype ? "symbol" : typeof obj; }, _typeof(obj); };
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
var _validateForLoop = _interopRequireDefault(load6());
function _interopRequireDefault<T extends {__esModule: true}>(obj: T): T;
function _interopRequireDefault<T>(obj: T): {default: T};
function _interopRequireDefault(obj: unknown) { return obj && readProperty(obj, "__esModule") ? obj : { "default": obj }; }
function ownKeys(object: object, enumerableOnly?: boolean) { var keys: PropertyKey[] = Object.keys(object); if (Object.getOwnPropertySymbols) { var symbols = Object.getOwnPropertySymbols(object); enumerableOnly && (symbols = symbols.filter(function (sym) { return Object.getOwnPropertyDescriptor(object, sym)!.enumerable; })), keys.push.apply(keys, symbols); } return keys; }
function _objectSpread<T extends object>(target: T, ...sources: unknown[]): T;
function _objectSpread(target: object): object { for (var i = 1; i < arguments.length; i++) { var source: unknown = null != arguments[i] ? arguments[i] : {}; i % 2 ? ownKeys(Object(source), !0).forEach(function (key) { _defineProperty(target, key, readProperty(source, key)); }) : Object.getOwnPropertyDescriptors ? Object.defineProperties(target, Object.getOwnPropertyDescriptors(source)) : ownKeys(Object(source)).forEach(function (key) { Object.defineProperty(target, key, Object.getOwnPropertyDescriptor(source, key)!); }); } return target; }
function _defineProperty<T extends object>(obj: T, key: PropertyKey, value: unknown) { key = _toPropertyKey(key); if (key in obj) { Object.defineProperty(obj, key, { value: value, enumerable: true, configurable: true, writable: true }); } else { record(obj)[key] = value; } return obj; }
function _toPropertyKey(arg: unknown): PropertyKey { var key = _toPrimitive(arg, "string"); return _typeof(key) === "symbol" ? symbolValue(key) : String(key); }
function _toPrimitive(input: unknown, hint?: string): unknown { if (_typeof(input) !== "object" || input === null) return input; var prim = primitiveMethod(readProperty(input, Symbol.toPrimitive)); if (prim !== undefined) { var res = prim.call(input, hint || "default"); if (_typeof(res) !== "object") return res; throw new TypeError("@@toPrimitive must return a primitive value."); } return (hint === "string" ? String : Number)(input); }
function _toConsumableArray<T>(arr: Iterable<T, unknown, unknown> | ArrayLike<T>): T[];
function _toConsumableArray(arr: unknown): unknown[] { return _arrayWithoutHoles(arr) || _iterableToArray(arr) || _unsupportedIterableToArray(arr) || _nonIterableSpread(); }
function _nonIterableSpread(): never { throw new TypeError("Invalid attempt to spread non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method."); }
function _unsupportedIterableToArray(o: unknown, minLen?: number): unknown[] | undefined { if (!o) return; if (typeof o === "string") return _arrayLikeToArray(runtimeArrayLike(o), minLen); var n: unknown = Object.prototype.toString.call(o).slice(8, -1); if (n === "Object" && runtimeProperty(o, "constructor")) n = runtimeProperty(runtimeProperty(o, "constructor"), "name"); if (n === "Map" || n === "Set") return Array.from(runtimeArrayLikeOrIterable(o)); if (n === "Arguments" || nativeRegExpTest(/^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/, n)) return _arrayLikeToArray(runtimeArrayLike(o), minLen); }
function _iterableToArray(iter: unknown): unknown[] | undefined { if (typeof Symbol !== "undefined" && runtimeProperty(iter, Symbol.iterator) != null || runtimeProperty(iter, "@@iterator") != null) return Array.from(runtimeArrayLikeOrIterable(iter)); }
function _arrayWithoutHoles(arr: unknown): unknown[] | undefined { if (Array.isArray(arr)) return _arrayLikeToArray(arr); }
function _arrayLikeToArray<T>(arr: ArrayLike<T>, len?: number | null): T[] { if (len == null || len > arr.length) len = arr.length; for (var i = 0, arr2 = new Array<T>(len); i < len; i++) arr2[i] = arr[i]; return arr2; }
function _default(ast: AstNode, logger: LoggerLike) {
  (_traverser["default"]!).replace(ast, {
    enter: function enter(node: AstNode) {
      var matches = loopMatch((0, _matchAliasedForLoop["default"])(node));
      if (matches) {
        var warning = (0, _validateForLoop["default"])(node, matches);
        if (warning) {
          logger.warn.apply(logger, warningArgs(_toConsumableArray(warning).concat(['for-each'])));
          return;
        }
        return withComments(node, createForEach(matches));
      }
      if (node.type === 'ForStatement') {
        logger.warn(node, 'Unable to transform for loop', 'for-each');
      }
    }
  });
}
function withComments(node: AstNode, forEach: AstNode) {
  (0, _copyComments["default"])({
    from: node,
    to: forEach
  });
  (0, _copyComments["default"])({
    from: classBlock(forLoop(node).body).body[0],
    to: forEach
  });
  return forEach;
}
function createForEach(_ref: LoopMatch) {
  var body = _ref.body,
    item = _ref.item,
    index = _ref.index,
    array = _ref.array;
  var newBody = removeFirstBodyElement(body);
  var params = createForEachParams(newBody, item, index);
  return classNode({
    type: 'ExpressionStatement',
    expression: {
      type: 'CallExpression',
      callee: {
        type: 'MemberExpression',
        object: array,
        property: {
          type: 'Identifier',
          name: 'forEach'
        }
      },
      arguments: [{
        type: 'ArrowFunctionExpression',
        params: params,
        body: newBody
      }]
    }
  });
}
function removeFirstBodyElement(body: N.BlockStatement): N.BlockStatement {
  return classBlock(_objectSpread(_objectSpread({}, body), {}, {
    body: (0, _fp.tail)(body.body)
  }));
}
function createForEachParams(newBody: N.BlockStatement, item: N.Identifier, index: N.Identifier) {
  if (indexUsedInBody(newBody, index)) {
    return [item, index];
  }
  return [item];
}
function indexUsedInBody(newBody: N.BlockStatement, index: N.Identifier) {
  return (_traverser["default"]!).find(newBody, function (node: AstNode, parent: AstNode | null) {
    return (0, _isEqualAst["default"])(node, index) && (0, _variableType.isReference)(node, parent);
  });
}

/***/ 
if (!hasEsModuleFlag(exports)) throw new TypeError("Expected the initialized ES module flag");
if (!exportsReady(exports, ["default"])) throw new TypeError("Incomplete bundled exports");
return exports;
}
