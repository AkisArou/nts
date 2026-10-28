import type {WildcardCache, WildcardCacheFactory} from "../../../emitted-helper-types.ts";
import type {Constructor, Descriptor} from "../../../webpack.ts";
// Exact module body from JetStream 3.0 ./node_modules/lebab/lib/Parser.js.
// Dependencies are loaded at the original call sites; the cached export object is retained.
import {runtimeArrayLikeOrIterable, runtimeArrayLike, runtimeProperty, runtimeCallable, exportsReady, webpack, isRecord, record, readProperty, symbolValue, primitiveMethod, hasEsModuleFlag} from "../../../webpack.ts";
import {load as load0} from "../../lebab--espree/dist/espree.cjs.ts";

let cache: {exports: Partial<ReturnType<typeof initialize>>} | undefined;
export function load(): ReturnType<typeof initialize> {
 if (cache !== undefined) {
  const value = cache.exports;
  if (!isExport(value)) throw new TypeError("Unexpected cached export for lebab/lib/Parser.js");
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


Object.defineProperty(exports, "__esModule", ({
  value: true
}));
exports["default"] = void 0;
var espree = _interopRequireWildcard(load0());

function _interopRequireWildcard<T extends {__esModule: true}>(obj: T, nodeInterop?: false): T;
function _interopRequireWildcard(obj: unknown, nodeInterop?: boolean): unknown;
function _interopRequireWildcard(obj: unknown, nodeInterop?: boolean): unknown { if (!nodeInterop && obj && readProperty(obj, "__esModule")) { return obj; } if (obj === null || _typeof(obj) !== "object" && typeof obj !== "function") { return { "default": obj }; } var cache = _getRequireWildcardCache(nodeInterop); if (cache && cache.has(record(obj))) { return cache.get(record(obj)); } var newObj: Record<string, unknown> = {}; var hasPropertyDescriptor = readProperty(Object, "defineProperty") && Object.getOwnPropertyDescriptor; for (var key in record(obj)) { if (key !== "default" && Object.prototype.hasOwnProperty.call(obj, key)) { var desc = hasPropertyDescriptor ? Object.getOwnPropertyDescriptor(obj, key) : null; if (desc && (desc.get || desc.set)) { Object.defineProperty(newObj, key, desc); } else { newObj[key] = readProperty(obj, key); } } } newObj["default"] = obj; if (cache) { cache.set(record(obj), newObj); } return newObj; }
var _typeof = function(obj: unknown): string { "@babel/helpers - typeof"; return _typeof = "function" == typeof Symbol && "symbol" == typeof Symbol.iterator ? function (obj: unknown) { return typeof obj; } : function (obj: unknown) { return obj && "function" == typeof Symbol && readProperty(obj, "constructor") === Symbol && obj !== Symbol.prototype ? "symbol" : typeof obj; }, _typeof(obj); };
function ownKeys(object: object, enumerableOnly?: boolean) { var keys: (string | symbol)[] = Object.keys(object); if (Object.getOwnPropertySymbols) { var symbols = Object.getOwnPropertySymbols(object); enumerableOnly && (symbols = symbols.filter(function (sym) { return Object.getOwnPropertyDescriptor(object, sym)!.enumerable; })), keys.push.apply(keys, symbols); } return keys; }
function _objectSpread(target: object, ...sources: unknown[]): Record<PropertyKey, unknown>;
function _objectSpread(target: object): Record<PropertyKey, unknown> { for (var i = 1; i < arguments.length; i++) { var source: unknown = null != arguments[i] ? arguments[i] : {}; i % 2 ? ownKeys(Object(source), !0).forEach(function (key) { _defineProperty(target, key, readProperty(source, key)); }) : readProperty(Object, "getOwnPropertyDescriptors") ? Object.defineProperties(target, Object.getOwnPropertyDescriptors(source)) : ownKeys(Object(source)).forEach(function (key) { Object.defineProperty(target, key, Object.getOwnPropertyDescriptor(source, key)!); }); } return record(target); }
function _defineProperty(obj: object, key: PropertyKey, value: unknown) { key = _toPropertyKey(key); if (key in obj) { Object.defineProperty(obj, key, { value: value, enumerable: true, configurable: true, writable: true }); } else { record(obj)[key] = value; } return obj; }
function _toPropertyKey(arg: unknown): PropertyKey { var key = _toPrimitive(arg, "string"); return _typeof(key) === "symbol" ? symbolValue(key) : String(key); }
function _toPrimitive(input: unknown, hint?: string): unknown { if (_typeof(input) !== "object" || input === null) return input; var prim = primitiveMethod(readProperty(input, Symbol.toPrimitive)); if (prim !== undefined) { var res = prim.call(input, hint || "default"); if (_typeof(res) !== "object") return res; throw new TypeError("@@toPrimitive must return a primitive value."); } return (hint === "string" ? String : Number)(input); }
var ESPREE_OPTS = {
  ecmaVersion: 2022,
  ecmaFeatures: {
    jsx: true
  },
  comment: true,
  tokens: true
};

/**
 * An Esprima-compatible parser with JSX and object rest/spread parsing enabled.
 */
var _default = {
  parse: function parse(js: string, opts?: unknown) {
    return espree.parse(js, _objectSpread(_objectSpread({}, opts), ESPREE_OPTS));
  },
  tokenize: function tokenize(js: string, opts?: unknown) {
    return espree.tokenize(js, _objectSpread(_objectSpread({}, opts), ESPREE_OPTS));
  }
};
exports["default"] = _default;

/***/ 
if (!hasEsModuleFlag(exports)) throw new TypeError("Expected the initialized ES module flag");
if (!exportsReady(exports, ["default"])) throw new TypeError("Incomplete bundled exports");
return exports;
}
