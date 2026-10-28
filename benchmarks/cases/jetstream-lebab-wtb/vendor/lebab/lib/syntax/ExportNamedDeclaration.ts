import type * as K from "../../../../types/ast-types/gen/kinds.js";
import type {AstNode, LoggerLike, Warning, Transform, ScopeLike, ScopeManagerLike, VariableLike, VariableGroupLike, VariableKind} from "../../../../ast.ts";
import type {Constructor, Descriptor} from "../../../../webpack.ts";
// Exact module body from JetStream 3.0 ./node_modules/lebab/lib/syntax/ExportNamedDeclaration.js.
// Dependencies are loaded at the original call sites; the cached export object is retained.
import {runtimeProperty, runtimeCall, runtimeCallable, runtimeMethod, boundSetPrototypeOf, exportsReady, webpack, isRecord, record, readProperty, symbolValue, primitiveMethod, hasEsModuleFlag} from "../../../../webpack.ts";
import {load as load0} from "./BaseSyntax.ts";

let cache: {exports: Partial<ReturnType<typeof initialize>>} | undefined;
export function load(): ReturnType<typeof initialize> {
 if (cache !== undefined) {
  const value = cache.exports;
  if (!isExport(value)) throw new TypeError("Unexpected cached export for lebab/lib/syntax/ExportNamedDeclaration.js");
  return value;
 }
 return initialize();
}
function isExport(value: Partial<ReturnType<typeof initialize>>): value is ReturnType<typeof initialize> {
 return isRecord(value) && value.__esModule === true && value["default"] !== undefined;
}
function initialize() {
const exports: { __esModule?: true; "default"?: typeof ExportNamedDeclaration; } = {};
let module = {exports};
cache = module;


"use strict";


var _typeof = function(obj: unknown): string { "@babel/helpers - typeof"; return _typeof = "function" == typeof Symbol && "symbol" == typeof Symbol.iterator ? function (obj: unknown) { return typeof obj; } : function (obj: unknown) { return obj && "function" == typeof Symbol && readProperty(obj, "constructor") === Symbol && obj !== Symbol.prototype ? "symbol" : typeof obj; }, _typeof(obj); };
Object.defineProperty(exports, "__esModule", ({
  value: true
}));
exports["default"] = void 0;
var _BaseSyntax2 = _interopRequireDefault(load0());
function _interopRequireDefault<T extends {__esModule: true}>(obj: T): T;
function _interopRequireDefault<T>(obj: T): {default: T};
function _interopRequireDefault(obj: unknown) { return obj && readProperty(obj, "__esModule") ? obj : { "default": obj }; }
function _defineProperties(target: object, props: Descriptor[]): void { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, _toPropertyKey(descriptor.key), descriptor); } }
function _createClass<T extends Constructor>(Constructor: T, protoProps?: Descriptor[], staticProps?: Descriptor[]): T { if (protoProps) _defineProperties(Constructor.prototype, protoProps); if (staticProps) _defineProperties(Constructor, staticProps); Object.defineProperty(Constructor, "prototype", { writable: false }); return Constructor; }
function _toPropertyKey(arg: unknown): PropertyKey { var key = _toPrimitive(arg, "string"); return _typeof(key) === "symbol" ? symbolValue(key) : String(key); }
function _toPrimitive(input: unknown, hint?: string): unknown { if (_typeof(input) !== "object" || input === null) return input; var prim = primitiveMethod(readProperty(input, Symbol.toPrimitive)); if (prim !== undefined) { var res = prim.call(input, hint || "default"); if (_typeof(res) !== "object") return res; throw new TypeError("@@toPrimitive must return a primitive value."); } return (hint === "string" ? String : Number)(input); }
function _classCallCheck(instance: unknown, Constructor: Constructor): void { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }
function _inherits(subClass: Constructor, superClass: Constructor | null): void { if (typeof superClass !== "function" && superClass !== null) { throw new TypeError("Super expression must either be null or a function"); } subClass.prototype = Object.create(superClass && superClass.prototype, { constructor: { value: subClass, writable: true, configurable: true } }); Object.defineProperty(subClass, "prototype", { writable: false }); if (superClass) _setPrototypeOf(subClass, superClass); }
var _setPrototypeOf = function(o: object, p: object | null): object { _setPrototypeOf = Boolean(Object.setPrototypeOf) ? boundSetPrototypeOf(runtimeCall(Object.setPrototypeOf.bind, Object.setPrototypeOf, [])) : function _setPrototypeOf(o: object, p: object | null): object { record(o).__proto__ = p; return o; }; return _setPrototypeOf(o, p); };
function _createSuper(Derived: Constructor) { var hasNativeReflectConstruct = _isNativeReflectConstruct(); return function _createSuperInternal(this: object): unknown { var Super = _getPrototypeOf(Derived), result: unknown; if (hasNativeReflectConstruct) { var NewTarget = runtimeProperty(_getPrototypeOf(this), "constructor"); result = runtimeCall(Reflect.construct, Reflect, [Super, arguments, NewTarget]); } else { result = runtimeMethod(Super, "apply", [this, arguments]); } return _possibleConstructorReturn(this, result); }; }
function _possibleConstructorReturn(self: unknown, call: unknown): unknown { if (call && (_typeof(call) === "object" || typeof call === "function")) { return call; } else if (call !== void 0) { throw new TypeError("Derived constructors may only return object or undefined"); } return _assertThisInitialized(self); }
function _assertThisInitialized<T>(self: T): T { if (self === void 0) { throw new ReferenceError("this hasn't been initialised - super() hasn't been called"); } return self; }
function _isNativeReflectConstruct(): boolean { if (typeof Reflect === "undefined" || !Reflect.construct) return false; if (runtimeProperty(Reflect.construct, "sham")) return false; if (typeof Proxy === "function") return true; try { Boolean.prototype.valueOf.call(Reflect.construct(Boolean, [], function () {})); return true; } catch (e) { return false; } }
var _getPrototypeOf: (o: object) => unknown = function(o: object): unknown { _getPrototypeOf = Boolean(Object.setPrototypeOf) ? runtimeCallable(runtimeCall(Object.getPrototypeOf.bind, Object.getPrototypeOf, [])) : function _getPrototypeOf(o: object): unknown { return readProperty(o, "__proto__") || Object.getPrototypeOf(o); }; return _getPrototypeOf(o); };
/**
 * The class to define the ExportNamedDeclaration syntax.
 */
class ExportNamedDeclaration extends (_BaseSyntax2["default"]!) {
declare type: "ExportNamedDeclaration";
declare "declaration": K.DeclarationKind | undefined;
declare "specifiers": K.ExportSpecifierKind[] | undefined;
declare "comments": K.CommentKind[] | null | undefined;
constructor(_ref: {declaration?: K.DeclarationKind; specifiers?: K.ExportSpecifierKind[]; comments?: K.CommentKind[] | null}) {
    var _this: ExportNamedDeclaration;
    var declaration = _ref.declaration,
      specifiers = _ref.specifiers,
      comments = _ref.comments;
    super('ExportNamedDeclaration');
    _this = this;
    _this.declaration = declaration;
    _this.specifiers = specifiers;
    _this.comments = comments;
    return _this;
  }

}
exports["default"] = ExportNamedDeclaration;

/***/ 
if (!hasEsModuleFlag(exports)) throw new TypeError("Expected the initialized ES module flag");
if (!exportsReady(exports, ["default"])) throw new TypeError("Incomplete bundled exports");
return exports;
}
