import type {ForOfHelper} from "../../../../../emitted-helper-types.ts";
import {nativeRegExpTest} from "../../../../../emitted-helper-types.ts";
import type {AstNode} from "../../../../../ast.ts";
import type * as K from "../../../../../types/ast-types/gen/kinds.js";
import {classText, optionalText, classNode, classExpression, optionalExpression, classFunction, classIdentifier, classVariableDeclaration, classCallStatement, classObject, classProperties, optionalProperties, functionProperty, descriptorArray, methodMatches, matchFlag, relatedExpressions, unknownArray, type ClassFunction, type MethodConfig, type RelatedExpression, type Replacement, type ClassConfig} from "./runtime.ts";
import type {Constructor, Descriptor} from "../../../../../webpack.ts";
// Exact module body from JetStream 3.0 ./node_modules/lebab/lib/transform/class/PotentialClass.js.
// Dependencies are loaded at the original call sites; the cached export object is retained.
import {runtimeCallable, runtimeProperty, runtimeCall, runtimeArrayLike, runtimeArrayLikeOrIterable, runtimeIteratorResult, exportsReady, webpack, isRecord, record, readProperty, symbolValue, primitiveMethod, hasEsModuleFlag} from "../../../../../webpack.ts";
import {load as load0} from "../../../../lodash/fp.ts";
import {load as load1} from "./extractComments.ts";
import {load as load2} from "../../utils/multiReplaceStatement.ts";

let cache: {exports: Partial<ReturnType<typeof initialize>>} | undefined;
export function load(): ReturnType<typeof initialize> {
 if (cache !== undefined) {
  const value = cache.exports;
  if (!isExport(value)) throw new TypeError("Unexpected cached export for lebab/lib/transform/class/PotentialClass.js");
  return value;
 }
 return initialize();
}
function isExport(value: Partial<ReturnType<typeof initialize>>): value is ReturnType<typeof initialize> {
 return isRecord(value) && value.__esModule === true && value["default"] !== undefined;
}
function initialize() {
const exports: { __esModule?: true; "default"?: typeof PotentialClass; } = {};
let module = {exports};
cache = module;


"use strict";


Object.defineProperty(exports, "__esModule", ({
  value: true
}));
exports["default"] = void 0;
var _fp = load0();
var _extractComments = _interopRequireDefault(load1());
var _multiReplaceStatement = _interopRequireDefault(load2());
function _interopRequireDefault<T extends {__esModule: true}>(obj: T): T;
function _interopRequireDefault<T>(obj: T): {default: T};
function _interopRequireDefault(obj: unknown) { return obj && readProperty(obj, "__esModule") ? obj : { "default": obj }; }
var _typeof = function(obj: unknown): string { "@babel/helpers - typeof"; return _typeof = "function" == typeof Symbol && "symbol" == typeof Symbol.iterator ? function (obj: unknown) { return typeof obj; } : function (obj: unknown) { return obj && "function" == typeof Symbol && readProperty(obj, "constructor") === Symbol && obj !== Symbol.prototype ? "symbol" : typeof obj; }, _typeof(obj); };
function _toConsumableArray<T>(arr: Iterable<T, unknown, unknown> | ArrayLike<T>): T[];
function _toConsumableArray(arr: unknown): unknown[] { return _arrayWithoutHoles(arr) || _iterableToArray(arr) || _unsupportedIterableToArray(arr) || _nonIterableSpread(); }
function _nonIterableSpread(): never { throw new TypeError("Invalid attempt to spread non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method."); }
function _iterableToArray(iter: unknown): unknown[] | undefined { if (typeof Symbol !== "undefined" && runtimeProperty(iter, Symbol.iterator) != null || runtimeProperty(iter, "@@iterator") != null) return Array.from(runtimeArrayLikeOrIterable(iter)); }
function _arrayWithoutHoles(arr: unknown): unknown[] | undefined { if (Array.isArray(arr)) return _arrayLikeToArray(arr); }
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
 * Represents a potential class to be created.
 */
const constructorProperty = "constructor";
class PotentialClass {
declare "name": string;
declare [constructorProperty]: InstanceType<ReturnType<typeof import("./PotentialConstructor.ts").load>["default"]> | undefined;
declare "fullNode": AstNode;
declare "superClass": K.ExpressionKind | undefined;
declare "commentNodes": AstNode[];
declare "parent": AstNode | null;
declare "methods": InstanceType<ReturnType<typeof import("./PotentialMethod.ts").load>["default"]>[];
declare "replacements": Replacement[];
constructor(_ref: ClassConfig) {
    var name = _ref.name,
      fullNode = _ref.fullNode,
      commentNodes = _ref.commentNodes,
      parent = _ref.parent;
    this.name = name;
    this.constructor = undefined;
    this.fullNode = fullNode;
    this.superClass = undefined;
    this.commentNodes = commentNodes;
    this.parent = parent;
    this.methods = [];
    this.replacements = [];
  }
getName() {
      return this.name;
    }

getFullNode() {
      return this.fullNode;
    }

setConstructor(method: NonNullable<PotentialClass["constructor"]>) {
      this.constructor = method;
    }

setSuperClass(superClass: K.ExpressionKind | undefined, relatedExpressions: RelatedExpression[]) {
      this.superClass = superClass;
      var _iterator = _createForOfIteratorHelper(relatedExpressions),
        _step: ReturnType<typeof _iterator.n>;
      try {
        for (_iterator.s(); !(_step = _iterator.n()).done;) {
          var _step$value = _step.value,
            parent = _step$value.parent,
            node = _step$value.node;
          this.replacements.push({
            parent: parent,
            node: node,
            replacements: []
          });
        }
      } catch (err) {
        _iterator.e(err);
      } finally {
        _iterator.f();
      }
      this.constructor!.setSuperClass(superClass);
    }

addMethod(method: PotentialClass["methods"][number]) {
      this.methods.push(method);
    }

isTransformable() {
      return this.methods.length > 0 || this.superClass !== undefined;
    }

transform() {
      (0, _multiReplaceStatement["default"])({
        parent: this.parent,
        node: this.fullNode,
        replacements: [classNode(this.toClassDeclaration())]
      });
      this.replacements.forEach((_multiReplaceStatement["default"]!));
      this.methods.forEach(function (method) {
        return method.remove();
      });
    }

toClassDeclaration() {
      return {
        type: 'ClassDeclaration',
        superClass: this.superClass,
        id: {
          type: 'Identifier',
          name: this.name
        },
        body: {
          type: 'ClassBody',
          body: this.createMethods()
        },
        comments: (0, _extractComments["default"])(this.commentNodes)
      };
    }

createMethods() {
      var _this = this;
      return (0, _fp.compact)([this.createConstructor()].concat(_toConsumableArray(this.methods.map(function (method) {
        method.setSuperClass(_this.superClass);
        return method.toMethodDefinition();
      }))));
    }

createConstructor() {
      return this.constructor!.isEmpty() ? undefined : this.constructor!.toMethodDefinition();
    }
}
exports["default"] = PotentialClass;

/***/ 
if (!hasEsModuleFlag(exports)) throw new TypeError("Expected the initialized ES module flag");
if (!exportsReady(exports, ["default"])) throw new TypeError("Incomplete bundled exports");
return exports;
}
