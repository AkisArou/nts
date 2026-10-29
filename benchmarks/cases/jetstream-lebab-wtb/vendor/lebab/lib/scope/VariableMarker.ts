import {scopeVariable, type ScopeEntry} from "../../../../ast.ts";
import type {ForOfHelper, ForOfStep} from "../../../../emitted-helper-types.ts";
import {nativeRegExpTest} from "../../../../emitted-helper-types.ts";
import type * as K from "../../../../types/ast-types/gen/kinds.js";
import type {AstNode, LoggerLike, Warning, Transform, ScopeLike, ScopeManagerLike, VariableLike, VariableGroupLike, VariableKind} from "../../../../ast.ts";
import type {Constructor, Descriptor} from "../../../../webpack.ts";
// Exact module body from JetStream 3.0 ./node_modules/lebab/lib/scope/VariableMarker.js.
// Dependencies are loaded at the original call sites; the cached export object is retained.
import {runtimeCallable, runtimeProperty, runtimeCall, runtimeArrayLike, runtimeArrayLikeOrIterable, runtimeIteratorResult, exportsReady, webpack, isRecord, record, readProperty, symbolValue, primitiveMethod, hasEsModuleFlag} from "../../../../webpack.ts";

let cache: {exports: Partial<ReturnType<typeof initialize>>} | undefined;
export function load(): ReturnType<typeof initialize> {
 if (cache !== undefined) {
  const value = cache.exports;
  if (!isExport(value)) throw new TypeError("Unexpected cached export for lebab/lib/scope/VariableMarker.js");
  return value;
 }
 return initialize();
}
function isExport(value: Partial<ReturnType<typeof initialize>>): value is ReturnType<typeof initialize> {
 return isRecord(value) && value.__esModule === true && value["default"] !== undefined;
}
function initialize() {
const exports: { __esModule?: true; "default"?: typeof VariableMarker; } = {};
let module = {exports};
cache = module;


"use strict";


Object.defineProperty(exports, "__esModule", ({
  value: true
}));
exports["default"] = void 0;
var _typeof = function(obj: unknown): string { "@babel/helpers - typeof"; return _typeof = "function" == typeof Symbol && "symbol" == typeof Symbol.iterator ? function (obj: unknown) { return typeof obj; } : function (obj: unknown) { return obj && "function" == typeof Symbol && readProperty(obj, "constructor") === Symbol && obj !== Symbol.prototype ? "symbol" : typeof obj; }, _typeof(obj); };
function _createForOfIteratorHelper<T>(o: Iterable<T, unknown, unknown> | ArrayLike<T>, allowArrayLike?: boolean): ForOfHelper<T>;
function _createForOfIteratorHelper(o: unknown, allowArrayLike?: boolean): unknown { var it: unknown = typeof Symbol !== "undefined" && runtimeProperty(o, Symbol.iterator) || runtimeProperty(o, "@@iterator"); if (!it) { if (Array.isArray(o) || (it = _unsupportedIterableToArray(o)) || allowArrayLike && o && typeof runtimeProperty(o, "length") === "number") { if (it) o = it; var i = 0; var F = function F() {}; return { s: F, n: function n() { if (i >= runtimeArrayLike(o).length) return { done: true }; return { done: false, value: runtimeProperty(o, i++) }; }, e: function e(_e: unknown) { throw _e; }, f: F }; } throw new TypeError("Invalid attempt to iterate non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method."); } var normalCompletion: unknown = true, didErr = false, err: unknown; return { s: function s() { it = runtimeCallable(it).call(o); }, n: function n() { var step = runtimeCallable(runtimeProperty(it, "next")).call(it); normalCompletion = runtimeProperty(step, "done"); return step; }, e: function e(_e2: unknown) { didErr = true; err = _e2; }, f: function f() { try { if (!normalCompletion && runtimeProperty(it, "return") != null) runtimeCallable(runtimeProperty(it, "return")).call(it); } finally { if (didErr) throw err; } } }; }
function _toConsumableArray<T>(arr: Iterable<T, unknown, unknown> | ArrayLike<T>): T[];
function _toConsumableArray(arr: unknown): unknown[] { return _arrayWithoutHoles(arr) || _iterableToArray(arr) || _unsupportedIterableToArray(arr) || _nonIterableSpread(); }
function _nonIterableSpread(): never { throw new TypeError("Invalid attempt to spread non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method."); }
function _unsupportedIterableToArray(o: unknown, minLen?: number): unknown[] | undefined { if (!o) return; if (typeof o === "string") return _arrayLikeToArray(runtimeArrayLike(o), minLen); var n: unknown = Object.prototype.toString.call(o).slice(8, -1); if (n === "Object" && runtimeProperty(o, "constructor")) n = runtimeProperty(runtimeProperty(o, "constructor"), "name"); if (n === "Map" || n === "Set") return Array.from(runtimeArrayLikeOrIterable(o)); if (n === "Arguments" || nativeRegExpTest(/^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/, n)) return _arrayLikeToArray(runtimeArrayLike(o), minLen); }
function _iterableToArray(iter: unknown): unknown[] | undefined { if (typeof Symbol !== "undefined" && runtimeProperty(iter, Symbol.iterator) != null || runtimeProperty(iter, "@@iterator") != null) return Array.from(runtimeArrayLikeOrIterable(iter)); }
function _arrayWithoutHoles(arr: unknown): unknown[] | undefined { if (Array.isArray(arr)) return _arrayLikeToArray(arr); }
function _arrayLikeToArray<T>(arr: ArrayLike<T>, len?: number | null): T[] { if (len == null || len > arr.length) len = arr.length; for (var i = 0, arr2 = new Array<T>(len); i < len; i++) arr2[i] = arr[i]; return arr2; }
function _classCallCheck(instance: unknown, Constructor: Constructor): void { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }
function _defineProperties(target: object, props: Descriptor[]): void { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, _toPropertyKey(descriptor.key), descriptor); } }
function _createClass<T extends Constructor>(Constructor: T, protoProps?: Descriptor[], staticProps?: Descriptor[]): T { if (protoProps) _defineProperties(Constructor.prototype, protoProps); if (staticProps) _defineProperties(Constructor, staticProps); Object.defineProperty(Constructor, "prototype", { writable: false }); return Constructor; }
function _toPropertyKey(arg: unknown): PropertyKey { var key = _toPrimitive(arg, "string"); return _typeof(key) === "symbol" ? symbolValue(key) : String(key); }
function _toPrimitive(input: unknown, hint?: string): unknown { if (_typeof(input) !== "object" || input === null) return input; var prim = primitiveMethod(readProperty(input, Symbol.toPrimitive)); if (prim !== undefined) { var res = prim.call(input, hint || "default"); if (_typeof(res) !== "object") return res; throw new TypeError("@@toPrimitive must return a primitive value."); } return (hint === "string" ? String : Number)(input); }
/**
 * Labels variables in relation to their use in block scope.
 *
 * When variable is declared/modified/referenced not according to
 * block scoping rules, it'll be marked hoisted.
 */
class VariableMarker {
declare "scopeManager": ScopeManagerLike;
constructor(scopeManager: ScopeManagerLike) {
    this.scopeManager = scopeManager;
  }
markDeclared(varNames: string[]) {
      var _this = this;
      var alreadySeen: ScopeEntry[] = [];
      varNames.forEach(function (varName: string) {
        var blockVars = _this.getScope()!.findFunctionScoped(varName);

        // all variable names declared with a destructuring operation
        // reference the same Variable object, so when we mark the
        // first variable in destructuring as declared, they all
        // will be marked as declared, but this kind of re-declaring
        // (which isn't actually real re-declaring) should not cause
        // variable to be marked as declared multiple times and
        // therefore marked as hoisted.
        if (blockVars.some(function (v) {
          return !alreadySeen.includes(v);
        })) {
          alreadySeen.push.apply(alreadySeen, _toConsumableArray(blockVars));

          // Ignore repeated var declarations
          if (blockVars.some(function (variable) {
            return scopeVariable(variable).isDeclared();
          })) {
            var _iterator = _createForOfIteratorHelper(blockVars),
              _step: ForOfStep<ScopeEntry>;
            try {
              for (_iterator.s(); !(_step = _iterator.n()).done;) {
                var variable = _step.value;
                scopeVariable(variable).markHoisted();
              }
            } catch (err) {
              _iterator.e(err);
            } finally {
              _iterator.f();
            }
            return;
          }
        }
        var _iterator2 = _createForOfIteratorHelper(blockVars),
          _step2: ForOfStep<ScopeEntry>;
        try {
          for (_iterator2.s(); !(_step2 = _iterator2.n()).done;) {
            var _variable = _step2.value;
            // Remember that it's declared and register in current block scope
            scopeVariable(_variable).markDeclared();
          }
        } catch (err) {
          _iterator2.e(err);
        } finally {
          _iterator2.f();
        }
        var scope = _this.getScope();
        var _iterator3 = _createForOfIteratorHelper(blockVars),
          _step3: ForOfStep<ScopeEntry>;
        try {
          for (_iterator3.s(); !(_step3 = _iterator3.n()).done;) {
            var _variable2 = _step3.value;
            scope!.register(varName, _variable2);
          }
        } catch (err) {
          _iterator3.e(err);
        } finally {
          _iterator3.f();
        }
      });
    }

markModified(varName: unknown) {
      var blockVars = this.getScope()!.findBlockScoped(varName);
      if (blockVars.length > 0) {
        var _iterator4 = _createForOfIteratorHelper(blockVars),
          _step4: ForOfStep<ScopeEntry>;
        try {
          for (_iterator4.s(); !(_step4 = _iterator4.n()).done;) {
            var variable = _step4.value;
            scopeVariable(variable).markModified();
          }
        } catch (err) {
          _iterator4.e(err);
        } finally {
          _iterator4.f();
        }
        return;
      }
      var _iterator5 = _createForOfIteratorHelper(this.getScope()!.findFunctionScoped(varName)),
        _step5: ForOfStep<ScopeEntry>;
      try {
        for (_iterator5.s(); !(_step5 = _iterator5.n()).done;) {
          var _variable3 = _step5.value;
          scopeVariable(_variable3).markHoisted();
          scopeVariable(_variable3).markModified();
        }
      } catch (err) {
        _iterator5.e(err);
      } finally {
        _iterator5.f();
      }
    }

markReferenced(varName: unknown) {
      var blockVars = this.getScope()!.findBlockScoped(varName);
      if (blockVars.length > 0) {
        return;
      }
      var _iterator6 = _createForOfIteratorHelper(this.getScope()!.findFunctionScoped(varName)),
        _step6: ForOfStep<ScopeEntry>;
      try {
        for (_iterator6.s(); !(_step6 = _iterator6.n()).done;) {
          var variable = _step6.value;
          scopeVariable(variable).markHoisted();
        }
      } catch (err) {
        _iterator6.e(err);
      } finally {
        _iterator6.f();
      }
    }

getScope() {
      return this.scopeManager.getScope();
    }
}
exports["default"] = VariableMarker;

/***/ 
if (!hasEsModuleFlag(exports)) throw new TypeError("Expected the initialized ES module flag");
if (!exportsReady(exports, ["default"])) throw new TypeError("Incomplete bundled exports");
return exports;
}
