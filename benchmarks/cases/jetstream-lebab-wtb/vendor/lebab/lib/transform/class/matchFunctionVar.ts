import type {AstNode} from "../../../../../ast.ts";
import type * as K from "../../../../../types/ast-types/gen/kinds.js";
import {classText, optionalText, classNode, classExpression, optionalExpression, classFunction, classIdentifier, classVariableDeclaration, classCallStatement, classObject, classProperties, optionalProperties, functionProperty, descriptorArray, methodMatches, matchFlag, relatedExpressions, unknownArray, type ClassFunction, type MethodConfig, type RelatedExpression, type Replacement, type ClassConfig} from "./runtime.ts";
import type {Constructor, Descriptor, RawIteratorResult} from "../../../../../webpack.ts";
// Exact module body from JetStream 3.0 ./node_modules/lebab/lib/transform/class/matchFunctionVar.js.
// Dependencies are loaded at the original call sites; the cached export object is retained.
import {runtimeProperty, runtimeCall, runtimeArrayLike, runtimeArrayLikeOrIterable, runtimeIteratorResult, exportsReady, webpack, isRecord, record, readProperty, symbolValue, primitiveMethod, hasEsModuleFlag} from "../../../../../webpack.ts";
import {load as load0} from "../../../../f-matches/index.ts";

let cache: {exports: Partial<ReturnType<typeof initialize>>} | undefined;
export function load(): ReturnType<typeof initialize> {
 if (cache !== undefined) {
  const value = cache.exports;
  if (!isExport(value)) throw new TypeError("Unexpected cached export for lebab/lib/transform/class/matchFunctionVar.js");
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
function _slicedToArray<T extends readonly unknown[]>(arr: T, i?: number): T;
function _slicedToArray<T>(arr: Iterable<T, unknown, unknown> | ArrayLike<T>, i?: number): T[];
function _slicedToArray(arr: unknown, i?: number): unknown[] { return _arrayWithHoles(arr) || _iterableToArrayLimit(arr, i) || _unsupportedIterableToArray(arr, i) || _nonIterableRest(); }
function _nonIterableRest(): never { throw new TypeError("Invalid attempt to destructure non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method."); }
function _unsupportedIterableToArray(o: unknown, minLen?: number): unknown[] | undefined { if (!o) return; if (typeof o === "string") return _arrayLikeToArray(runtimeArrayLike(o), minLen); var n = Object.prototype.toString.call(o).slice(8, -1); if (n === "Object" && runtimeProperty(o, "constructor")) n = classText(runtimeProperty(runtimeProperty(o, "constructor"), "name")); if (n === "Map" || n === "Set") return Array.from(runtimeArrayLikeOrIterable(o)); if (n === "Arguments" || /^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(n)) return _arrayLikeToArray(runtimeArrayLike(o), minLen); }
function _arrayLikeToArray<T>(arr: ArrayLike<T>, len?: number | null): T[] { if (len == null || len > arr.length) len = arr.length; for (var i = 0, arr2 = new Array<T>(len); i < len; i++) arr2[i] = arr[i]; return arr2; }
function _iterableToArrayLimit(arr: unknown, i?: number): unknown[] | undefined { var _i: unknown = null == arr ? null : "undefined" != typeof Symbol && runtimeProperty(arr, Symbol.iterator) || runtimeProperty(arr, "@@iterator"); if (null != _i) { var _s: RawIteratorResult, _e: unknown, _x: unknown, _r: unknown, _arr: unknown[] = [], _n: unknown = !0, _d = !1; try { if (_x = runtimeProperty((_i = runtimeCall(_i, arr, [])), "next"), 0 === i) { if (Object(_i) !== _i) return; _n = !1; } else for (; !(_n = (_s = runtimeIteratorResult(runtimeCall(_x, _i, []))).done) && (_arr.push(_s.value), _arr.length !== i); _n = !0); } catch (err) { _d = !0, _e = err; } finally { try { if (!_n && null != runtimeProperty(_i, "return") && (_r = runtimeCall(runtimeProperty(_i, "return"), _i, []), Object(_r) !== _r)) return; } finally { if (_d) throw _e; } } return _arr; } }
function _arrayWithHoles(arr: unknown): unknown[] | undefined { if (Array.isArray(arr)) return arr; }
var isFunctionExpression = (0, _fMatches.matches)({
  type: 'FunctionExpression'
});
var isFunctionVariableDeclaration = (0, _fMatches.matches)({
  type: 'VariableDeclaration',
  declarations: function declarations(decs: unknown) {
    return unknownArray(decs).length === 1 && isFunctionExpression(readProperty(unknownArray(decs)[0], "init"));
  }
});

/**
 * Matches: var <className> = function () { ... }
 *
 * When node matches returns the extracted fields:
 *
 * - className
 * - constructorNode
 *
 * @param  {Object} node
 * @return {Object}
 */
function _default(node: AstNode) {
  if (isFunctionVariableDeclaration(node)) {
    var _node$declarations = _slicedToArray(classVariableDeclaration(node).declarations, 1),
      _node$declarations$ = _node$declarations[0],
      className = classText(classIdentifier(readProperty(_node$declarations$, "id")).name),
      constructorNode = classFunction(readProperty(_node$declarations$, "init"));
    return {
      className: className,
      constructorNode: constructorNode
    };
  }
}

/***/ 
if (!hasEsModuleFlag(exports)) throw new TypeError("Expected the initialized ES module flag");
if (!exportsReady(exports, ["default"])) throw new TypeError("Incomplete bundled exports");
return exports;
}
