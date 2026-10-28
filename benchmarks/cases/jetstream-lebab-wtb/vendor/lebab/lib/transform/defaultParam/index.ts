import type * as K from "../../../../../types/ast-types/gen/kinds.js";
import type {namedTypes as N} from "../../../../../types/ast-types/gen/namedTypes.js";
import type {FunctionNode} from "../../../../../escope-types.ts";
import {classText, optionalText, classNode, classBlock, classFunction, classExpression, classIdentifier, loopMatch, forLoop, programNode, assignmentPattern, warningArgs, strings, type LoopMatch, type DefaultInfo} from "../runtime-transforms.ts";
import type {ForOfHelper} from "../../../../../emitted-helper-types.ts";
import {nativeRegExpTest} from "../../../../../emitted-helper-types.ts";
import type {AstNode, LoggerLike} from "../../../../../ast.ts";
import type {Constructor, Descriptor} from "../../../../../webpack.ts";
// Exact module body from JetStream 3.0 ./node_modules/lebab/lib/transform/defaultParam/index.js.
// Dependencies are loaded at the original call sites; the cached export object is retained.
import {runtimeCallable, runtimeProperty, runtimeCall, runtimeArrayLike, runtimeArrayLikeOrIterable, runtimeIteratorResult, exportsReady, webpack, isRecord, record, readProperty, symbolValue, primitiveMethod, hasEsModuleFlag} from "../../../../../webpack.ts";
import {load as load0} from "../../../../f-matches/index.ts";
import {load as load1} from "../../../../lodash/fp.ts";
import {load as load2} from "../../utils/destructuring.ts";
import {load as load3} from "../../traverser.ts";
import {load as load4} from "../../utils/multiReplaceStatement.ts";
import {load as load5} from "../../utils/functionType.ts";
import {load as load6} from "./matchOrAssignment.ts";
import {load as load7} from "./matchTernaryAssignment.ts";
import {load as load8} from "./matchIfUndefinedAssignment.ts";

let cache: {exports: Partial<ReturnType<typeof initialize>>} | undefined;
export function load(): ReturnType<typeof initialize> {
 if (cache !== undefined) {
  const value = cache.exports;
  if (!isExport(value)) throw new TypeError("Unexpected cached export for lebab/lib/transform/defaultParam/index.js");
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
var _fMatches = load0();
var _fp = load1();
var _destructuring = load2();
var _traverser = _interopRequireDefault(load3());
var _multiReplaceStatement = _interopRequireDefault(load4());
var _functionType = load5();
var _matchOrAssignment = _interopRequireDefault(load6());
var _matchTernaryAssignment = _interopRequireDefault(load7());
var _matchIfUndefinedAssignment = _interopRequireDefault(load8());
function _interopRequireDefault<T extends {__esModule: true}>(obj: T): T;
function _interopRequireDefault<T>(obj: T): {default: T};
function _interopRequireDefault(obj: unknown) { return obj && readProperty(obj, "__esModule") ? obj : { "default": obj }; }
function _createForOfIteratorHelper<T>(o: Iterable<T, unknown, unknown> | ArrayLike<T>, allowArrayLike?: boolean): ForOfHelper<T>;
function _createForOfIteratorHelper(o: unknown, allowArrayLike?: boolean): unknown { var it: unknown = typeof Symbol !== "undefined" && runtimeProperty(o, Symbol.iterator) || runtimeProperty(o, "@@iterator"); if (!it) { if (Array.isArray(o) || (it = _unsupportedIterableToArray(o)) || allowArrayLike && o && typeof runtimeProperty(o, "length") === "number") { if (it) o = it; var i = 0; var F = function F() {}; return { s: F, n: function n() { if (i >= runtimeArrayLike(o).length) return { done: true }; return { done: false, value: runtimeProperty(o, i++) }; }, e: function e(_e: unknown) { throw _e; }, f: F }; } throw new TypeError("Invalid attempt to iterate non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method."); } var normalCompletion: unknown = true, didErr = false, err: unknown; return { s: function s() { it = runtimeCallable(it).call(o); }, n: function n() { var step = runtimeCallable(runtimeProperty(it, "next")).call(it); normalCompletion = runtimeProperty(step, "done"); return step; }, e: function e(_e2: unknown) { didErr = true; err = _e2; }, f: function f() { try { if (!normalCompletion && runtimeProperty(it, "return") != null) runtimeCallable(runtimeProperty(it, "return")).call(it); } finally { if (didErr) throw err; } } }; }
function _unsupportedIterableToArray(o: unknown, minLen?: number): unknown[] | undefined { if (!o) return; if (typeof o === "string") return _arrayLikeToArray(runtimeArrayLike(o), minLen); var n: unknown = Object.prototype.toString.call(o).slice(8, -1); if (n === "Object" && runtimeProperty(o, "constructor")) n = runtimeProperty(runtimeProperty(o, "constructor"), "name"); if (n === "Map" || n === "Set") return Array.from(runtimeArrayLikeOrIterable(o)); if (n === "Arguments" || nativeRegExpTest(/^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/, n)) return _arrayLikeToArray(runtimeArrayLike(o), minLen); }
function _arrayLikeToArray<T>(arr: ArrayLike<T>, len?: number | null): T[] { if (len == null || len > arr.length) len = arr.length; for (var i = 0, arr2 = new Array<T>(len); i < len; i++) arr2[i] = arr[i]; return arr2; }
function _default(ast: AstNode) {
  (_traverser["default"]!).replace(ast, {
    enter: function enter(node: AstNode) {
      if ((0, _functionType.isFunction)(node) && node.body.type === 'BlockStatement') {
        transformDefaultParams(node);
      }
    }
  });
}
function transformDefaultParams(fn: FunctionNode) {
  var detectedDefaults = findDefaults(classBlock(fn.body).body);
  fn.params = fn.params.map(function (param, i) {
    // Ignore params that use destructuring or already have a default
    if (param.type !== 'Identifier') {
      return param;
    }
    var detected = detectedDefaults[param.name];
    // Transform when default value detected
    // and default does not contain this or any of the remaining parameters
    if (detected && !containsParams(detected.value, remainingParams(fn, i))) {
      (0, _multiReplaceStatement["default"])({
        parent: fn.body,
        node: detected.node,
        replacements: []
      });
      return withDefault(param, detected.value);
    }
    return param;
  });
}
function withDefault(param: K.PatternKind, value: unknown) {
  return assignmentPattern({
    type: 'AssignmentPattern',
    left: param,
    right: value
  });
}
function remainingParams(fn: FunctionNode, i: number) {
  return fn.params.slice(i);
}
function containsParams(defaultValue: unknown, params: K.PatternKind[]) {
  return (0, _fp.flow)((0, _fp.flatMap)(_destructuring.extractVariables), (0, _fp.some)(function (param) {
    return (_traverser["default"]!).find(classNode(defaultValue), (0, _fMatches.matches)({
      type: 'Identifier',
      name: param.name
    }));
  }))(params);
}

// Looks default value assignments at the beginning of a function
//
// Returns a map of variable-name:{name, value, node}
function findDefaults(fnBody: K.StatementKind[]) {
  var defaults: Record<string, DefaultInfo> = {};
  var _iterator = _createForOfIteratorHelper(fnBody),
    _step: ReturnType<typeof _iterator.n>;
  try {
    for (_iterator.s(); !(_step = _iterator.n()).done;) {
      var node = _step.value;
      var def = matchDefaultAssignment(node);
      if (!def) {
        break;
      }
      defaults[def.name] = def;
    }
  } catch (err) {
    _iterator.e(err);
  } finally {
    _iterator.f();
  }
  return defaults;
}
function matchDefaultAssignment(node: AstNode) {
  return (0, _matchOrAssignment["default"])(node) || (0, _matchTernaryAssignment["default"])(node) || (0, _matchIfUndefinedAssignment["default"])(node);
}

/***/ 
if (!hasEsModuleFlag(exports)) throw new TypeError("Expected the initialized ES module flag");
if (!exportsReady(exports, ["default"])) throw new TypeError("Incomplete bundled exports");
return exports;
}
