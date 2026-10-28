import type {ForOfHelper} from "../../../../../../emitted-helper-types.ts";
import {nativeRegExpTest} from "../../../../../../emitted-helper-types.ts";
import type * as K from "../../../../../../types/ast-types/gen/kinds.js";
import {inheritsExpression, classText, optionalText, classNode, classExpression, optionalExpression, classFunction, classIdentifier, classVariableDeclaration, classCallStatement, classObject, classProperties, optionalProperties, functionProperty, descriptorArray, methodMatches, matchFlag, relatedExpressions, unknownArray, type ClassFunction, type MethodConfig, type RelatedExpression, type Replacement, type ClassConfig} from "../runtime.ts";
import type {AstNode, LoggerLike} from "../../../../../../ast.ts";
import type {Constructor, Descriptor} from "../../../../../../webpack.ts";
// Exact module body from JetStream 3.0 ./node_modules/lebab/lib/transform/class/inheritance/UtilInherits.js.
// Dependencies are loaded at the original call sites; the cached export object is retained.
import {runtimeCallable, runtimeProperty, runtimeCall, runtimeArrayLike, runtimeArrayLikeOrIterable, runtimeIteratorResult, exportsReady, webpack, isRecord, record, readProperty, symbolValue, primitiveMethod, hasEsModuleFlag} from "../../../../../../webpack.ts";
import {load as load0} from "../../../../../f-matches/index.ts";
import {load as load1} from "./RequireUtilDetector.ts";
import {load as load2} from "./RequireUtilInheritsDetector.ts";
import {load as load3} from "./ImportUtilDetector.ts";

let cache: {exports: Partial<ReturnType<typeof initialize>>} | undefined;
export function load(): ReturnType<typeof initialize> {
 if (cache !== undefined) {
  const value = cache.exports;
  if (!isExport(value)) throw new TypeError("Unexpected cached export for lebab/lib/transform/class/inheritance/UtilInherits.js");
  return value;
 }
 return initialize();
}
function isExport(value: Partial<ReturnType<typeof initialize>>): value is ReturnType<typeof initialize> {
 return isRecord(value) && value.__esModule === true && value["default"] !== undefined;
}
function initialize() {
const exports: { __esModule?: true; "default"?: typeof UtilInherits; } = {};
let module = {exports};
cache = module;


"use strict";


Object.defineProperty(exports, "__esModule", ({
  value: true
}));
exports["default"] = void 0;
var _fMatches = load0();
var _RequireUtilDetector = _interopRequireDefault(load1());
var _RequireUtilInheritsDetector = _interopRequireDefault(load2());
var _ImportUtilDetector = _interopRequireDefault(load3());
function _interopRequireDefault<T extends {__esModule: true}>(obj: T): T;
function _interopRequireDefault<T>(obj: T): {default: T};
function _interopRequireDefault(obj: unknown) { return obj && readProperty(obj, "__esModule") ? obj : { "default": obj }; }
var _typeof = function(obj: unknown): string { "@babel/helpers - typeof"; return _typeof = "function" == typeof Symbol && "symbol" == typeof Symbol.iterator ? function (obj: unknown) { return typeof obj; } : function (obj: unknown) { return obj && "function" == typeof Symbol && readProperty(obj, "constructor") === Symbol && obj !== Symbol.prototype ? "symbol" : typeof obj; }, _typeof(obj); };
function _createForOfIteratorHelper<T>(o: Iterable<T, unknown, unknown> | ArrayLike<T>, allowArrayLike?: boolean): ForOfHelper<T>;
function _createForOfIteratorHelper(o: unknown, allowArrayLike?: boolean): unknown { var it: unknown = typeof Symbol !== "undefined" && runtimeProperty(o, Symbol.iterator) || runtimeProperty(o, "@@iterator"); if (!it) { if (Array.isArray(o) || (it = _unsupportedIterableToArray(o)) || allowArrayLike && o && typeof runtimeProperty(o, "length") === "number") { if (it) o = it; var i = 0; var F = function F() {}; return { s: F, n: function n() { if (i >= runtimeArrayLike(o).length) return { done: true }; return { done: false, value: runtimeProperty(o, i++) }; }, e: function e(_e: unknown) { throw _e; }, f: F }; } throw new TypeError("Invalid attempt to iterate non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method."); } var normalCompletion: unknown = true, didErr = false, err: unknown; return { s: function s() { it = runtimeCallable(it).call(o); }, n: function n() { var step = runtimeCallable(runtimeProperty(it, "next")).call(it); normalCompletion = runtimeProperty(step, "done"); return step; }, e: function e(_e2: unknown) { didErr = true; err = _e2; }, f: function f() { try { if (!normalCompletion && runtimeProperty(it, "return") != null) runtimeCallable(runtimeProperty(it, "return")).call(it); } finally { if (didErr) throw err; } } }; }
function _unsupportedIterableToArray(o: unknown, minLen?: number): unknown[] | undefined { if (!o) return; if (typeof o === "string") return _arrayLikeToArray(runtimeArrayLike(o), minLen); var n: unknown = Object.prototype.toString.call(o).slice(8, -1); if (n === "Object" && runtimeProperty(o, "constructor")) n = runtimeProperty(runtimeProperty(o, "constructor"), "name"); if (n === "Map" || n === "Set") return Array.from(runtimeArrayLikeOrIterable(o)); if (n === "Arguments" || nativeRegExpTest(/^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/, n)) return _arrayLikeToArray(runtimeArrayLike(o), minLen); }
function _arrayLikeToArray<T>(arr: ArrayLike<T>, len?: number | null): T[] { if (len == null || len > arr.length) len = arr.length; for (var i = 0, arr2 = new Array<T>(len); i < len; i++) arr2[i] = arr[i]; return arr2; }
function _classCallCheck(instance: unknown, Constructor: Constructor): void { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }
function _defineProperties(target: object, props: Descriptor[]): void { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, _toPropertyKey(descriptor.key), descriptor); } }
function _createClass<T extends Constructor>(Constructor: T, protoProps?: Descriptor[], staticProps?: Descriptor[]): T { if (protoProps) _defineProperties(Constructor.prototype, protoProps); if (staticProps) _defineProperties(Constructor, staticProps); Object.defineProperty(Constructor, "prototype", { writable: false }); return Constructor; }
function _toPropertyKey(arg: unknown): PropertyKey { var key = _toPrimitive(arg, "string"); return _typeof(key) === "symbol" ? symbolValue(key) : String(key); }
function _toPrimitive(input: unknown, hint?: string): unknown { if (_typeof(input) !== "object" || input === null) return input; var prim = primitiveMethod(readProperty(input, Symbol.toPrimitive)); if (prim !== undefined) { var res = prim.call(input, hint || "default"); if (_typeof(res) !== "object") return res; throw new TypeError("@@toPrimitive must return a primitive value."); } return (hint === "string" ? String : Number)(input); }
/**
 * Processes nodes to detect super classes and return information for later
 * transformation.
 *
 * Detects:
 *
 *   var util = require('util');
 *   ...
 *   util.inherits(Class1, Class2);
 */
class UtilInherits {
declare "inheritsNode": K.MemberExpressionKind | K.IdentifierKind | undefined;
declare "detectors": {detect(node: AstNode): K.MemberExpressionKind | K.IdentifierKind | undefined}[];
constructor() {
    this.inheritsNode = undefined;
    this.detectors = [new (_RequireUtilDetector["default"]!)(), new (_RequireUtilInheritsDetector["default"]!)(), new (_ImportUtilDetector["default"]!)()];
  }
process(node: AstNode, parent: AstNode | null) {
      var m: unknown;
      if (parent && parent.type === 'Program' && (m = this.detectInheritsNode(node))) {
        this.inheritsNode = inheritsExpression(m);
      } else if (this.inheritsNode && (m = this.matchUtilInherits(node))) {
        return {
          className: classText(readProperty(m, "className")),
          superClass: classExpression(readProperty(m, "superClass")),
          relatedExpressions: [{
            node: node,
            parent: parent
          }]
        };
      }
    }

detectInheritsNode(node: AstNode) {
      var _iterator = _createForOfIteratorHelper(this.detectors),
        _step: ReturnType<typeof _iterator.n>;
      try {
        for (_iterator.s(); !(_step = _iterator.n()).done;) {
          var detector = _step.value;
          var inheritsNode: K.MemberExpressionKind | K.IdentifierKind | undefined = void 0;
          if (inheritsNode = detector.detect(node)) {
            return inheritsNode;
          }
        }
      } catch (err) {
        _iterator.e(err);
      } finally {
        _iterator.f();
      }
    }

matchUtilInherits(node: AstNode) {
      return (0, _fMatches.matches)({
        type: 'ExpressionStatement',
        expression: {
          type: 'CallExpression',
          callee: this.inheritsNode,
          arguments: [{
            type: 'Identifier',
            name: (0, _fMatches.extractAny)('className')
          }, (0, _fMatches.extractAny)('superClass')]
        }
      }, node);
    }
}
exports["default"] = UtilInherits;

/***/ 
if (!hasEsModuleFlag(exports)) throw new TypeError("Expected the initialized ES module flag");
if (!exportsReady(exports, ["default"])) throw new TypeError("Incomplete bundled exports");
return exports;
}
