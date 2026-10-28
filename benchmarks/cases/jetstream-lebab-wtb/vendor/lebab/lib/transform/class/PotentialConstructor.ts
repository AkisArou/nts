import type * as K from "../../../../../types/ast-types/gen/kinds.js";
import {classBlock, classText, optionalText, classNode, classExpression, optionalExpression, classFunction, classIdentifier, classVariableDeclaration, classCallStatement, classObject, classProperties, optionalProperties, functionProperty, descriptorArray, methodMatches, matchFlag, relatedExpressions, unknownArray, type ClassFunction, type MethodConfig, type RelatedExpression, type Replacement, type ClassConfig} from "./runtime.ts";
import type {AstNode, LoggerLike} from "../../../../../ast.ts";
import type {Constructor, Descriptor} from "../../../../../webpack.ts";
// Exact module body from JetStream 3.0 ./node_modules/lebab/lib/transform/class/PotentialConstructor.js.
// Dependencies are loaded at the original call sites; the cached export object is retained.
import {runtimeProperty, runtimeCall, runtimeCallable, runtimeMethod, boundSetPrototypeOf, exportsReady, webpack, isRecord, record, readProperty, symbolValue, primitiveMethod, hasEsModuleFlag} from "../../../../../webpack.ts";
import {load as load0} from "../../traverser.ts";
import {load as load1} from "../../utils/isEqualAst.ts";
import {load as load2} from "../../../../f-matches/index.ts";
import {load as load3} from "./PotentialMethod.ts";

let cache: {exports: Partial<ReturnType<typeof initialize>>} | undefined;
export function load(): ReturnType<typeof initialize> {
 if (cache !== undefined) {
  const value = cache.exports;
  if (!isExport(value)) throw new TypeError("Unexpected cached export for lebab/lib/transform/class/PotentialConstructor.js");
  return value;
 }
 return initialize();
}
function isExport(value: Partial<ReturnType<typeof initialize>>): value is ReturnType<typeof initialize> {
 return isRecord(value) && value.__esModule === true && value["default"] !== undefined;
}
function initialize() {
const exports: { __esModule?: true; "default"?: typeof PotentialConstructor; } = {};
let module = {exports};
cache = module;


"use strict";


var _typeof = function(obj: unknown): string { "@babel/helpers - typeof"; return _typeof = "function" == typeof Symbol && "symbol" == typeof Symbol.iterator ? function (obj: unknown) { return typeof obj; } : function (obj: unknown) { return obj && "function" == typeof Symbol && readProperty(obj, "constructor") === Symbol && obj !== Symbol.prototype ? "symbol" : typeof obj; }, _typeof(obj); };
Object.defineProperty(exports, "__esModule", ({
  value: true
}));
exports["default"] = void 0;
var _traverser = _interopRequireDefault(load0());
var _isEqualAst = _interopRequireDefault(load1());
var _fMatches = load2();
var _PotentialMethod2 = _interopRequireDefault(load3());
function _interopRequireDefault<T extends {__esModule: true}>(obj: T): T;
function _interopRequireDefault<T>(obj: T): {default: T};
function _interopRequireDefault(obj: unknown) { return obj && readProperty(obj, "__esModule") ? obj : { "default": obj }; }
function _classCallCheck(instance: unknown, Constructor: Constructor): void { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }
function _defineProperties(target: object, props: Descriptor[]): void { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, _toPropertyKey(descriptor.key), descriptor); } }
function _createClass<T extends Constructor>(Constructor: T, protoProps?: Descriptor[], staticProps?: Descriptor[]): T { if (protoProps) _defineProperties(Constructor.prototype, protoProps); if (staticProps) _defineProperties(Constructor, staticProps); Object.defineProperty(Constructor, "prototype", { writable: false }); return Constructor; }
function _toPropertyKey(arg: unknown): PropertyKey { var key = _toPrimitive(arg, "string"); return _typeof(key) === "symbol" ? symbolValue(key) : String(key); }
function _toPrimitive(input: unknown, hint?: string): unknown { if (_typeof(input) !== "object" || input === null) return input; var prim = primitiveMethod(readProperty(input, Symbol.toPrimitive)); if (prim !== undefined) { var res = prim.call(input, hint || "default"); if (_typeof(res) !== "object") return res; throw new TypeError("@@toPrimitive must return a primitive value."); } return (hint === "string" ? String : Number)(input); }
function _inherits(subClass: Constructor, superClass: Constructor | null): void { if (typeof superClass !== "function" && superClass !== null) { throw new TypeError("Super expression must either be null or a function"); } subClass.prototype = Object.create(superClass && superClass.prototype, { constructor: { value: subClass, writable: true, configurable: true } }); Object.defineProperty(subClass, "prototype", { writable: false }); if (superClass) _setPrototypeOf(subClass, superClass); }
var _setPrototypeOf = function(o: object, p: object | null): object { _setPrototypeOf = Boolean(Object.setPrototypeOf) ? boundSetPrototypeOf(runtimeCall(Object.setPrototypeOf.bind, Object.setPrototypeOf, [])) : function _setPrototypeOf(o: object, p: object | null): object { record(o).__proto__ = p; return o; }; return _setPrototypeOf(o, p); };
function _createSuper(Derived: Constructor) { var hasNativeReflectConstruct = _isNativeReflectConstruct(); return function _createSuperInternal(this: object): unknown { var Super = _getPrototypeOf(Derived), result: unknown; if (hasNativeReflectConstruct) { var NewTarget = runtimeProperty(_getPrototypeOf(this), "constructor"); result = runtimeCall(Reflect.construct, Reflect, [Super, arguments, NewTarget]); } else { result = runtimeMethod(Super, "apply", [this, arguments]); } return _possibleConstructorReturn(this, result); }; }
function _possibleConstructorReturn(self: unknown, call: unknown): unknown { if (call && (_typeof(call) === "object" || typeof call === "function")) { return call; } else if (call !== void 0) { throw new TypeError("Derived constructors may only return object or undefined"); } return _assertThisInitialized(self); }
function _assertThisInitialized<T>(self: T): T { if (self === void 0) { throw new ReferenceError("this hasn't been initialised - super() hasn't been called"); } return self; }
function _isNativeReflectConstruct(): boolean { if (typeof Reflect === "undefined" || !Reflect.construct) return false; if (runtimeProperty(Reflect.construct, "sham")) return false; if (typeof Proxy === "function") return true; try { Boolean.prototype.valueOf.call(Reflect.construct(Boolean, [], function () {})); return true; } catch (e) { return false; } }
var _getPrototypeOf: (o: object) => unknown = function(o: object): unknown { _getPrototypeOf = Boolean(Object.setPrototypeOf) ? runtimeCallable(runtimeCall(Object.getPrototypeOf.bind, Object.getPrototypeOf, [])) : function _getPrototypeOf(o: object): unknown { return readProperty(o, "__proto__") || Object.getPrototypeOf(o); }; return _getPrototypeOf(o); };
/**
 * Represents a potential constructor method to be created.
 */
class PotentialConstructor extends (_PotentialMethod2["default"]!) {

constructor(cfg: MethodConfig) {
    cfg.name = 'constructor';
    super(cfg);
  }
getBody() {
      if (this.superClass) {
        return this.transformSuperCalls(this.getBodyBlock());
      } else {
        return this.getBodyBlock();
      }
    }

transformSuperCalls(body: K.BlockStatementKind): K.BlockStatementKind {
      var _this = this;
      return classBlock((_traverser["default"]!).replace(body, {
        enter: function enter(node: AstNode) {
          if (_this.isSuperConstructorCall(node)) {
            classCallStatement(node).expression.callee = {
              type: 'Super'
            };
            classCallStatement(node).expression.arguments = classCallStatement(node).expression.arguments.slice(1);
          }
        }
      }));
    }

isSuperConstructorCall(node: AstNode) {
      var _this2 = this;
      return (0, _fMatches.matches)({
        type: 'ExpressionStatement',
        expression: {
          type: 'CallExpression',
          callee: {
            type: 'MemberExpression',
            object: function object(obj: unknown) {
              return (0, _isEqualAst["default"])(obj, _this2.superClass);
            },
            property: {
              type: 'Identifier',
              name: 'call'
            }
          },
          arguments: [{
            type: 'ThisExpression'
          }]
        }
      }, node);
    }
}
exports["default"] = PotentialConstructor;

/***/ 
if (!hasEsModuleFlag(exports)) throw new TypeError("Expected the initialized ES module flag");
if (!exportsReady(exports, ["default"])) throw new TypeError("Incomplete bundled exports");
return exports;
}
