import type {namedTypes as N} from "../../../../types/ast-types/gen/namedTypes.js";
import {declaratorView} from "../../../../scope-layouts.ts";
export interface HoistConfig {id?: K.IdentifierKind | null; params?: K.PatternKind[]; body: AstNode;}
import type {WildcardCache, WildcardCacheFactory} from "../../../../emitted-helper-types.ts";
import type * as K from "../../../../types/ast-types/gen/kinds.js";
import type {AstNode, LoggerLike, Warning, Transform, ScopeLike, ScopeManagerLike, VariableLike, VariableGroupLike, VariableKind} from "../../../../ast.ts";
import type {Constructor, Descriptor} from "../../../../webpack.ts";
// Exact module body from JetStream 3.0 ./node_modules/lebab/lib/scope/FunctionHoister.js.
// Dependencies are loaded at the original call sites; the cached export object is retained.
import {runtimeArrayLikeOrIterable, runtimeArrayLike, runtimeProperty, runtimeCallable, exportsReady, webpack, isRecord, record, readProperty, symbolValue, primitiveMethod, hasEsModuleFlag} from "../../../../webpack.ts";
import {load as load0} from "../../../lodash/fp.ts";
import {load as load1} from "../traverser.ts";
import {load as load2} from "../utils/functionType.ts";
import {load as load3} from "../utils/destructuring.ts";
import {load as load4} from "./Variable.ts";
import {load as load5} from "./VariableGroup.ts";

let cache: {exports: Partial<ReturnType<typeof initialize>>} | undefined;
export function load(): ReturnType<typeof initialize> {
 if (cache !== undefined) {
  const value = cache.exports;
  if (!isExport(value)) throw new TypeError("Unexpected cached export for lebab/lib/scope/FunctionHoister.js");
  return value;
 }
 return initialize();
}
function isExport(value: Partial<ReturnType<typeof initialize>>): value is ReturnType<typeof initialize> {
 return isRecord(value) && value.__esModule === true && value["default"] !== undefined;
}
function initialize() {
let _getRequireWildcardCache: WildcardCacheFactory = function(nodeInterop?: boolean): WildcardCache | null { if (typeof WeakMap !== "function") return null; var cacheBabelInterop = new WeakMap<object, Record<string, unknown>>(); var cacheNodeInterop = new WeakMap<object, Record<string, unknown>>(); return (_getRequireWildcardCache = function _getRequireWildcardCache(nodeInterop?: boolean) { return nodeInterop ? cacheNodeInterop : cacheBabelInterop; })(nodeInterop); };
const exports: { __esModule?: true; "default"?: typeof FunctionHoister; } = {};
let module = {exports};
cache = module;


"use strict";


Object.defineProperty(exports, "__esModule", ({
  value: true
}));
exports["default"] = void 0;
var _fp = load0();
var _traverser = _interopRequireDefault(load1());
var functionType = _interopRequireWildcard(load2());
var destructuring = _interopRequireWildcard(load3());
var _Variable = _interopRequireDefault(load4());
var _VariableGroup = _interopRequireDefault(load5());

function _interopRequireWildcard<T extends {__esModule: true}>(obj: T, nodeInterop?: false): T;
function _interopRequireWildcard(obj: unknown, nodeInterop?: boolean): unknown;
function _interopRequireWildcard(obj: unknown, nodeInterop?: boolean): unknown { if (!nodeInterop && obj && readProperty(obj, "__esModule")) { return obj; } if (obj === null || _typeof(obj) !== "object" && typeof obj !== "function") { return { "default": obj }; } var cache = _getRequireWildcardCache(nodeInterop); if (cache && cache.has(record(obj))) { return cache.get(record(obj)); } var newObj: Record<string, unknown> = {}; var hasPropertyDescriptor = readProperty(Object, "defineProperty") && Object.getOwnPropertyDescriptor; for (var key in record(obj)) { if (key !== "default" && Object.prototype.hasOwnProperty.call(obj, key)) { var desc = hasPropertyDescriptor ? Object.getOwnPropertyDescriptor(obj, key) : null; if (desc && (desc.get || desc.set)) { Object.defineProperty(newObj, key, desc); } else { newObj[key] = readProperty(obj, key); } } } newObj["default"] = obj; if (cache) { cache.set(record(obj), newObj); } return newObj; }
function _interopRequireDefault<T extends {__esModule: true}>(obj: T): T;
function _interopRequireDefault<T>(obj: T): {default: T};
function _interopRequireDefault(obj: unknown) { return obj && readProperty(obj, "__esModule") ? obj : { "default": obj }; }
var _typeof = function(obj: unknown): string { "@babel/helpers - typeof"; return _typeof = "function" == typeof Symbol && "symbol" == typeof Symbol.iterator ? function (obj: unknown) { return typeof obj; } : function (obj: unknown) { return obj && "function" == typeof Symbol && readProperty(obj, "constructor") === Symbol && obj !== Symbol.prototype ? "symbol" : typeof obj; }, _typeof(obj); };
function _classCallCheck(instance: unknown, Constructor: Constructor): void { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }
function _defineProperties(target: object, props: Descriptor[]): void { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, _toPropertyKey(descriptor.key), descriptor); } }
function _createClass<T extends Constructor>(Constructor: T, protoProps?: Descriptor[], staticProps?: Descriptor[]): T { if (protoProps) _defineProperties(Constructor.prototype, protoProps); if (staticProps) _defineProperties(Constructor, staticProps); Object.defineProperty(Constructor, "prototype", { writable: false }); return Constructor; }
function _toPropertyKey(arg: unknown): PropertyKey { var key = _toPrimitive(arg, "string"); return _typeof(key) === "symbol" ? symbolValue(key) : String(key); }
function _toPrimitive(input: unknown, hint?: string): unknown { if (_typeof(input) !== "object" || input === null) return input; var prim = primitiveMethod(readProperty(input, Symbol.toPrimitive)); if (prim !== undefined) { var res = prim.call(input, hint || "default"); if (_typeof(res) !== "object") return res; throw new TypeError("@@toPrimitive must return a primitive value."); } return (hint === "string" ? String : Number)(input); }
/**
 * Registers all variables defined inside a function.
 * Emulating ECMAScript variable hoisting.
 */
class FunctionHoister {
declare "functionScope": ScopeLike;
constructor(functionScope: ScopeLike) {
    this.functionScope = functionScope;
  }
hoist(_ref: HoistConfig) {
      var id = _ref.id,
        params = _ref.params,
        body = _ref.body;
      if (id) {
        this.declareVariable(id, id.name);
      }
      if (params) {
        this.hoistFunctionParams(params);
      }
      this.hoistVariables(body);
    }

hoistFunctionParams(params: K.PatternKind[]) {
      var _this = this;
      return (0, _fp.flow)((0, _fp.map)(destructuring.extractVariables), _fp.flatten, (0, _fp.forEach)(function (node: N.Identifier) {
        return _this.declareVariable(node, node.name);
      }))(params);
    }

declareVariable(node: AstNode, name: unknown) {
      var variable = new (_Variable["default"]!)(node);
      variable.markDeclared();
      this.functionScope.register(name, variable);
    }

hoistVariables(ast: AstNode) {
      var _this2 = this;
      (_traverser["default"]!).traverse(ast, {
        // Use arrow-function here, so we can access outer `this`.
        enter: function enter(node: AstNode, parent: AstNode | null) {
          if (node.type === 'VariableDeclaration') {
            _this2.hoistVariableDeclaration(node, parent);
          } else if (functionType.isFunctionDeclaration(node)) {
            // Register variable for the function if it has a name
            if (node.id) {
              _this2.declareVariable(node, node.id.name);
            }
            // Skip anything inside the nested function
            return (_traverser["default"]!).VisitorOption.Skip;
          } else if (functionType.isFunctionExpression(node)) {
            // Skip anything inside the nested function
            return (_traverser["default"]!).VisitorOption.Skip;
          }
        }
      });
    }

hoistVariableDeclaration(node: N.VariableDeclaration, parent: AstNode | null) {
      var _this3 = this;
      var group = new (_VariableGroup["default"]!)(node, parent);
      node.declarations.forEach(function (declaratorNode) {
        var variable = new (_Variable["default"]!)(declaratorNode, group);
        group.add(variable);
        // All destructured variable names point to the same Variable instance,
        // as we want to treat the destructured variables as one un-breakable
        // unit - if one of them is modified and other one not, we cannot break
        // them apart into const and let, but instead need to use let for both.
        destructuring.extractVariableNames(declaratorView(declaratorNode).id!).forEach(function (name: string) {
          _this3.functionScope.register(name, variable);
        });
      });
    }
}
exports["default"] = FunctionHoister;

/***/ 
if (!hasEsModuleFlag(exports)) throw new TypeError("Expected the initialized ES module flag");
if (!exportsReady(exports, ["default"])) throw new TypeError("Incomplete bundled exports");
return exports;
}
