import type {Scope as EscopeScope} from "../../../escope/lib/scope.ts";
import type {Variable as EscopeVariable} from "../../../escope/lib/variable.ts";
import type * as K from "../../../../types/ast-types/gen/kinds.js";
import type {namedTypes as N} from "../../../../types/ast-types/gen/namedTypes.js";
import type {FunctionNode} from "../../../../escope-types.ts";
import {classText, optionalText, classNode, classBlock, classFunction, classExpression, classIdentifier, loopMatch, forLoop, programNode, assignmentPattern, warningArgs, strings, type LoopMatch, type DefaultInfo} from "./runtime-transforms.ts";
import type {WildcardCache, WildcardCacheFactory, ForOfHelper} from "../../../../emitted-helper-types.ts";
import {nativeRegExpTest} from "../../../../emitted-helper-types.ts";
import type {AstNode, LoggerLike} from "../../../../ast.ts";
import type {Constructor, Descriptor} from "../../../../webpack.ts";
// Exact module body from JetStream 3.0 ./node_modules/lebab/lib/transform/destructParam.js.
// Dependencies are loaded at the original call sites; the cached export object is retained.
import {runtimeCallable, runtimeProperty, runtimeCall, runtimeArrayLike, runtimeArrayLikeOrIterable, runtimeIteratorResult, exportsReady, webpack, isRecord, record, readProperty, symbolValue, primitiveMethod, hasEsModuleFlag} from "../../../../webpack.ts";
import {load as load0} from "../../../lodash/fp.ts";
import {load as load1} from "../../../recast/main.ts";
import {load as load2} from "../Parser.ts";
import {load as load3} from "../traverser.ts";
import {load as load4} from "../withScope.ts";
import {load as load5} from "../utils/functionType.ts";
import {load as load6} from "../utils/Hierarchy.ts";

let cache: {exports: Partial<ReturnType<typeof initialize>>} | undefined;
export function load(): ReturnType<typeof initialize> {
 if (cache !== undefined) {
  const value = cache.exports;
  if (!isExport(value)) throw new TypeError("Unexpected cached export for lebab/lib/transform/destructParam.js");
  return value;
 }
 return initialize();
}
function isExport(value: Partial<ReturnType<typeof initialize>>): value is ReturnType<typeof initialize> {
 return isRecord(value) && value.__esModule === true && value["default"] !== undefined;
}
function initialize() {
let _getRequireWildcardCache: WildcardCacheFactory = function(nodeInterop?: boolean): WildcardCache | null { if (typeof WeakMap !== "function") return null; var cacheBabelInterop = new WeakMap<object, Record<string, unknown>>(); var cacheNodeInterop = new WeakMap<object, Record<string, unknown>>(); return (_getRequireWildcardCache = function _getRequireWildcardCache(nodeInterop?: boolean) { return nodeInterop ? cacheNodeInterop : cacheBabelInterop; })(nodeInterop); };
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
var _recast = load1();
var _Parser = _interopRequireDefault(load2());
var _traverser = _interopRequireDefault(load3());
var _withScope = _interopRequireDefault(load4());
var functionType = _interopRequireWildcard(load5());
var _Hierarchy = _interopRequireDefault(load6());

function _interopRequireWildcard<T extends {__esModule: true}>(obj: T, nodeInterop?: false): T;
function _interopRequireWildcard(obj: unknown, nodeInterop?: boolean): unknown;
function _interopRequireWildcard(obj: unknown, nodeInterop?: boolean): unknown { if (!nodeInterop && obj && readProperty(obj, "__esModule")) { return obj; } if (obj === null || _typeof(obj) !== "object" && typeof obj !== "function") { return { "default": obj }; } var cache = _getRequireWildcardCache(nodeInterop); if (cache && cache.has(record(obj))) { return cache.get(record(obj)); } var newObj: Record<string, unknown> = {}; var hasPropertyDescriptor = readProperty(Object, "defineProperty") && Object.getOwnPropertyDescriptor; for (var key in record(obj)) { if (key !== "default" && Object.prototype.hasOwnProperty.call(obj, key)) { var desc = hasPropertyDescriptor ? Object.getOwnPropertyDescriptor(obj, key) : null; if (desc && (desc.get || desc.set)) { Object.defineProperty(newObj, key, desc); } else { newObj[key] = readProperty(obj, key); } } } newObj["default"] = obj; if (cache) { cache.set(record(obj), newObj); } return newObj; }
function _interopRequireDefault<T extends {__esModule: true}>(obj: T): T;
function _interopRequireDefault<T>(obj: T): {default: T};
function _interopRequireDefault(obj: unknown) { return obj && readProperty(obj, "__esModule") ? obj : { "default": obj }; }
function _createForOfIteratorHelper<T>(o: Iterable<T, unknown, unknown> | ArrayLike<T>, allowArrayLike?: boolean): ForOfHelper<T>;
function _createForOfIteratorHelper(o: unknown, allowArrayLike?: boolean): unknown { var it: unknown = typeof Symbol !== "undefined" && runtimeProperty(o, Symbol.iterator) || runtimeProperty(o, "@@iterator"); if (!it) { if (Array.isArray(o) || (it = _unsupportedIterableToArray(o)) || allowArrayLike && o && typeof runtimeProperty(o, "length") === "number") { if (it) o = it; var i = 0; var F = function F() {}; return { s: F, n: function n() { if (i >= runtimeArrayLike(o).length) return { done: true }; return { done: false, value: runtimeProperty(o, i++) }; }, e: function e(_e: unknown) { throw _e; }, f: F }; } throw new TypeError("Invalid attempt to iterate non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method."); } var normalCompletion: unknown = true, didErr = false, err: unknown; return { s: function s() { it = runtimeCallable(it).call(o); }, n: function n() { var step = runtimeCallable(runtimeProperty(it, "next")).call(it); normalCompletion = runtimeProperty(step, "done"); return step; }, e: function e(_e2: unknown) { didErr = true; err = _e2; }, f: function f() { try { if (!normalCompletion && runtimeProperty(it, "return") != null) runtimeCallable(runtimeProperty(it, "return")).call(it); } finally { if (didErr) throw err; } } }; }
function _unsupportedIterableToArray(o: unknown, minLen?: number): unknown[] | undefined { if (!o) return; if (typeof o === "string") return _arrayLikeToArray(runtimeArrayLike(o), minLen); var n: unknown = Object.prototype.toString.call(o).slice(8, -1); if (n === "Object" && runtimeProperty(o, "constructor")) n = runtimeProperty(runtimeProperty(o, "constructor"), "name"); if (n === "Map" || n === "Set") return Array.from(runtimeArrayLikeOrIterable(o)); if (n === "Arguments" || nativeRegExpTest(/^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/, n)) return _arrayLikeToArray(runtimeArrayLike(o), minLen); }
function _arrayLikeToArray<T>(arr: ArrayLike<T>, len?: number | null): T[] { if (len == null || len > arr.length) len = arr.length; for (var i = 0, arr2 = new Array<T>(len); i < len; i++) arr2[i] = arr[i]; return arr2; }
var MAX_PROPS = 4;
function _default(ast: AstNode, logger: LoggerLike) {
  var hierarchy = new (_Hierarchy["default"]!)(ast);
  (_traverser["default"]!).traverse(ast, (0, _withScope["default"])(ast, {
    enter: function enter(fnNode: AstNode, parent: AstNode | null, scope: EscopeScope | null) {
      if (functionType.isFunction(fnNode)) {
        scope!.variables.filter(isParameter).map(function (v) {
          return {
            variable: v,
            exs: getMemberExpressions(v, hierarchy)
          };
        }).filter(function (_ref) {
          var exs = _ref.exs;
          return exs.length > 0;
        }).forEach(function (_ref2) {
          var variable = _ref2.variable,
            exs = _ref2.exs;
          // Replace parameter with destruct-pattern
          var index = fnNode.params.findIndex(function (param) {
            return param === variable.defs[0].name;
          });
          if (index === -1) {
            return;
          }
          if (uniqPropNames(exs).length > MAX_PROPS) {
            logger.warn(fnNode, "".concat(String(uniqPropNames(exs).length), " different props found, will not transform more than ").concat(String(MAX_PROPS)), 'destruct-param');
            return;
          }
          fnNode.params[index] = createDestructPattern(exs);

          // Replace references of obj.foo with simply foo
          exs.forEach(function (ex) {
            record(ex).type = ex.property.type;
            record(ex).name = readProperty(ex.property, "name");
          });
        });
      }
    }
  }));
}
function isParameter(variable: EscopeVariable) {
  return variable.defs.length === 1 && variable.defs[0].type === 'Parameter';
}
function getMemberExpressions(variable: EscopeVariable, hierarchy: InstanceType<ReturnType<typeof load6>["default"]>) {
  var memberExpressions: N.MemberExpression[] = [];
  var _iterator = _createForOfIteratorHelper(variable.references),
    _step: ReturnType<typeof _iterator.n>;
  try {
    for (_iterator.s(); !(_step = _iterator.n()).done;) {
      var ref = _step.value;
      var memEx = hierarchy.getParent(ref.identifier);
      if (!isMemberExpressionObject(memEx, ref.identifier)) {
        return [];
      }
      var ex = hierarchy.getParent(memEx);
      if (isAssignment(ex, memEx) || isUpdate(ex, memEx) || isMethodCall(ex, memEx)) {
        return [];
      }
      if (isKeyword(classText(classIdentifier(memEx.property).name)) || variableExists(classText(classIdentifier(memEx.property).name), ref.from)) {
        return [];
      }
      memberExpressions.push(memEx);
    }
  } catch (err) {
    _iterator.e(err);
  } finally {
    _iterator.f();
  }
  return memberExpressions;
}
function isMemberExpressionObject(memEx: AstNode | null | undefined, object: AstNode): memEx is N.MemberExpression {
  return memEx!.type === 'MemberExpression' && readProperty(memEx, "object") === object && readProperty(memEx, "computed") === false;
}
function isAssignment(ex: AstNode | null | undefined, node: AstNode) {
  return ex!.type === 'AssignmentExpression' && readProperty(ex, "left") === node;
}
function isUpdate(ex: AstNode | null | undefined, node: AstNode) {
  return ex!.type === 'UpdateExpression' && readProperty(ex, "argument") === node;
}
function isMethodCall(ex: AstNode | null | undefined, node: AstNode) {
  return ex!.type === 'CallExpression' && readProperty(ex, "callee") === node;
}
function variableExists(variableName: string, scope: EscopeScope | null) {
  while (scope) {
    if (scope.through.some(function (ref) {
      return ref.identifier.name === variableName;
    })) {
      return true;
    }
    if (scope.set.get(variableName)) {
      return true;
    }
    scope = scope.upper;
  }
  return false;
}
function isKeyword(name: string) {
  return (_Parser["default"]!).tokenize(name)[0].type === 'Keyword';
}
function uniqPropNames(exs: N.MemberExpression[]) {
  return (0, _fp.uniq)(exs.map(function (_ref3) {
    var property = _ref3.property;
    return readProperty(property, "name");
  }));
}

// By default recast indents the ObjectPattern AST node
// See: https://github.com/benjamn/recast/issues/240
//
// To work around this, we're building the desired string by ourselves,
// and parsing it with Recast and extracting the ObjectPatter node.
// Feeding this back to Recast will preserve the formatting.
function createDestructPattern(exs: N.MemberExpression[]) {
  var props = uniqPropNames(exs).join(', ');
  var js = "function foo({".concat(props, "}) {};");
  var ast = (0, _recast.parse)(js, {
    parser: (_Parser["default"]!)
  });
  return classFunction(programNode(readProperty(ast, "program")).body[0]).params[0];
}

/***/ 
if (!hasEsModuleFlag(exports)) throw new TypeError("Expected the initialized ES module flag");
if (!exportsReady(exports, ["default"])) throw new TypeError("Incomplete bundled exports");
return exports;
}
