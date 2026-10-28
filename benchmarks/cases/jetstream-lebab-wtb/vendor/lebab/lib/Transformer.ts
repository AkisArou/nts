import {classNode, classExpression, classText, programNode} from "./transform/runtime-transforms.ts";
import {nativeRegExpTest} from "../../../emitted-helper-types.ts";
import type * as K from "../../../types/ast-types/gen/kinds.js";
import {transformList} from "../../../ast.ts";
import type {AstNode, LoggerLike, Warning, Transform, ScopeLike, ScopeManagerLike, VariableLike, VariableGroupLike, VariableKind} from "../../../ast.ts";
import type {Constructor, Descriptor, RawIteratorResult} from "../../../webpack.ts";
// Exact module body from JetStream 3.0 ./node_modules/lebab/lib/Transformer.js.
// Dependencies are loaded at the original call sites; the cached export object is retained.
import {runtimeCallable, runtimeProperty, runtimeCall, runtimeArrayLike, runtimeArrayLikeOrIterable, runtimeIteratorResult, exportsReady, webpack, isRecord, record, readProperty, symbolValue, primitiveMethod, hasEsModuleFlag} from "../../../webpack.ts";
import {load as load0} from "../../recast/main.ts";
import {load as load1} from "./Parser.ts";
import {load as load2} from "./Logger.ts";

let cache: {exports: Partial<ReturnType<typeof initialize>>} | undefined;
export function load(): ReturnType<typeof initialize> {
 if (cache !== undefined) {
  const value = cache.exports;
  if (!isExport(value)) throw new TypeError("Unexpected cached export for lebab/lib/Transformer.js");
  return value;
 }
 return initialize();
}
function isExport(value: Partial<ReturnType<typeof initialize>>): value is ReturnType<typeof initialize> {
 return isRecord(value) && value.__esModule === true && value["default"] !== undefined;
}
function initialize() {
const exports: { __esModule?: true; "default"?: typeof Transformer; } = {};
let module = {exports};
cache = module;


"use strict";


Object.defineProperty(exports, "__esModule", ({
  value: true
}));
exports["default"] = void 0;
var _recast = load0();
var _Parser = _interopRequireDefault(load1());
var _Logger = _interopRequireDefault(load2());
function _interopRequireDefault<T extends {__esModule: true}>(obj: T): T;
function _interopRequireDefault<T>(obj: T): {default: T};
function _interopRequireDefault(obj: unknown) { return obj && readProperty(obj, "__esModule") ? obj : { "default": obj }; }
var _typeof = function(obj: unknown): string { "@babel/helpers - typeof"; return _typeof = "function" == typeof Symbol && "symbol" == typeof Symbol.iterator ? function (obj: unknown) { return typeof obj; } : function (obj: unknown) { return obj && "function" == typeof Symbol && readProperty(obj, "constructor") === Symbol && obj !== Symbol.prototype ? "symbol" : typeof obj; }, _typeof(obj); };
function _slicedToArray<T extends readonly unknown[]>(arr: T, i?: number): T;
function _slicedToArray<T>(arr: Iterable<T, unknown, unknown> | ArrayLike<T>, i?: number): T[];
function _slicedToArray(arr: unknown, i?: number): unknown[] { return _arrayWithHoles(arr) || _iterableToArrayLimit(arr, i) || _unsupportedIterableToArray(arr, i) || _nonIterableRest(); }
function _nonIterableRest(): never { throw new TypeError("Invalid attempt to destructure non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method."); }
function _unsupportedIterableToArray(o: unknown, minLen?: number): unknown[] | undefined { if (!o) return; if (typeof o === "string") return _arrayLikeToArray(runtimeArrayLike(o), minLen); var n: unknown = Object.prototype.toString.call(o).slice(8, -1); if (n === "Object" && runtimeProperty(o, "constructor")) n = runtimeProperty(runtimeProperty(o, "constructor"), "name"); if (n === "Map" || n === "Set") return Array.from(runtimeArrayLikeOrIterable(o)); if (n === "Arguments" || nativeRegExpTest(/^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/, n)) return _arrayLikeToArray(runtimeArrayLike(o), minLen); }
function _arrayLikeToArray<T>(arr: ArrayLike<T>, len?: number | null): T[] { if (len == null || len > arr.length) len = arr.length; for (var i = 0, arr2 = new Array<T>(len); i < len; i++) arr2[i] = arr[i]; return arr2; }
function _iterableToArrayLimit(arr: unknown, i?: number): unknown[] | undefined { var _i: unknown = null == arr ? null : "undefined" != typeof Symbol && runtimeProperty(arr, Symbol.iterator) || runtimeProperty(arr, "@@iterator"); if (null != _i) { var _s: RawIteratorResult, _e: unknown, _x: unknown, _r: unknown, _arr: unknown[] = [], _n: unknown = !0, _d = !1; try { if (_x = runtimeProperty((_i = runtimeCall(_i, arr, [])), "next"), 0 === i) { if (Object(_i) !== _i) return; _n = !1; } else for (; !(_n = (_s = runtimeIteratorResult(runtimeCall(_x, _i, []))).done) && (_arr.push(_s.value), _arr.length !== i); _n = !0); } catch (err) { _d = !0, _e = err; } finally { try { if (!_n && null != runtimeProperty(_i, "return") && (_r = runtimeCall(runtimeProperty(_i, "return"), _i, []), Object(_r) !== _r)) return; } finally { if (_d) throw _e; } } return _arr; } }
function _arrayWithHoles(arr: unknown): unknown[] | undefined { if (Array.isArray(arr)) return arr; }
function _classCallCheck(instance: unknown, Constructor: Constructor): void { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }
function _defineProperties(target: object, props: Descriptor[]): void { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, _toPropertyKey(descriptor.key), descriptor); } }
function _createClass<T extends Constructor>(Constructor: T, protoProps?: Descriptor[], staticProps?: Descriptor[]): T { if (protoProps) _defineProperties(Constructor.prototype, protoProps); if (staticProps) _defineProperties(Constructor, staticProps); Object.defineProperty(Constructor, "prototype", { writable: false }); return Constructor; }
function _toPropertyKey(arg: unknown): PropertyKey { var key = _toPrimitive(arg, "string"); return _typeof(key) === "symbol" ? symbolValue(key) : String(key); }
function _toPrimitive(input: unknown, hint?: string): unknown { if (_typeof(input) !== "object" || input === null) return input; var prim = primitiveMethod(readProperty(input, Symbol.toPrimitive)); if (prim !== undefined) { var res = prim.call(input, hint || "default"); if (_typeof(res) !== "object") return res; throw new TypeError("@@toPrimitive must return a primitive value."); } return (hint === "string" ? String : Number)(input); }
/**
 * Runs transforms on code.
 */
class Transformer {
declare "transforms": Transform[];
constructor(transforms?: Transform[]);
constructor() {
    var transforms: Transform[] = arguments.length > 0 && arguments[0] !== undefined ? transformList(arguments[0]) : [];
    this.transforms = transforms;
  }
run(code: string) {
      var logger = new (_Logger["default"]!)();
      return {
        code: this.applyAllTransforms(code, logger),
        warnings: logger.getWarnings()
      };
    }

applyAllTransforms(code: string, logger: LoggerLike) {
      var _this = this;
      return this.ignoringHashBangComment(code, function (js) {
        var ast = (0, _recast.parse)(js, {
          parser: (_Parser["default"]!)
        });
        _this.transforms.forEach(function (transformer) {
          transformer(programNode(readProperty(ast, "program")), logger);
        });
        return (0, _recast.print)(ast, {
          lineTerminator: _this.detectLineTerminator(code),
          objectCurlySpacing: false
        }).code;
      });
    }

ignoringHashBangComment(code: string, callback: (code: string) => string) {
      var _code$match = code.match(/^(\s*#!.*?\r?\n|)([\s\S]*)$/),
        _code$match2 = _slicedToArray(_code$match!, 3),
        hashBang = _code$match2[1],
        js = _code$match2[2];
      return hashBang + callback(js);
    }

detectLineTerminator(code: string) {
      var hasCRLF = /\r\n/.test(code);
      var hasLF = /[^\r]\n/.test(code);
      return hasCRLF && !hasLF ? '\r\n' : '\n';
    }
}
exports["default"] = Transformer;

/***/ 
if (!hasEsModuleFlag(exports)) throw new TypeError("Expected the initialized ES module flag");
if (!exportsReady(exports, ["default"])) throw new TypeError("Incomplete bundled exports");
return exports;
}
