import type {MatchResult} from "../../../../f-matches/index.ts";
import {classText} from "./runtime.ts";
import type {Constructor, Descriptor} from "../../../../../webpack.ts";
// Exact module body from JetStream 3.0 ./node_modules/lebab/lib/transform/includes/matchesIndexOf.js.
// Dependencies are loaded at the original call sites; the cached export object is retained.
import {exportsReady, webpack, isRecord, record, readProperty, symbolValue, primitiveMethod, hasEsModuleFlag} from "../../../../../webpack.ts";
import {load as load0} from "../../../../f-matches/index.ts";

let cache: {exports: Partial<ReturnType<typeof initialize>>} | undefined;
export function load(): ReturnType<typeof initialize> {
 if (cache !== undefined) {
  const value = cache.exports;
  if (!isExport(value)) throw new TypeError("Unexpected cached export for lebab/lib/transform/includes/matchesIndexOf.js");
  return value;
 }
 return initialize();
}
function isExport(value: Partial<ReturnType<typeof initialize>>): value is ReturnType<typeof initialize> {
 return isRecord(value) && value.__esModule === true && value["default"] !== undefined && value["isMinusOne"] !== undefined && value["isZero"] !== undefined;
}
function initialize() {
const exports: { __esModule?: true; "default"?: typeof _default; "isMinusOne"?: typeof isMinusOne; "isZero"?: typeof isZero; } = {};
let module = {exports};
cache = module;


"use strict";


Object.defineProperty(exports, "__esModule", ({
  value: true
}));
exports["default"] = _default;
exports.isZero = exports.isMinusOne = void 0;
var _fMatches = load0();
var _typeof = function(obj: unknown): string { "@babel/helpers - typeof"; return _typeof = "function" == typeof Symbol && "symbol" == typeof Symbol.iterator ? function (obj: unknown) { return typeof obj; } : function (obj: unknown) { return obj && "function" == typeof Symbol && readProperty(obj, "constructor") === Symbol && obj !== Symbol.prototype ? "symbol" : typeof obj; }, _typeof(obj); };
function ownKeys(object: {}, enumerableOnly?: boolean) { var keys: (string | symbol)[] = Object.keys(object); if (Object.getOwnPropertySymbols) { var symbols = Object.getOwnPropertySymbols(object); enumerableOnly && (symbols = symbols.filter(function (sym) { return Object.getOwnPropertyDescriptor(object, sym)!.enumerable; })), keys.push.apply(keys, symbols); } return keys; }
function _objectSpread(target: Record<PropertyKey, unknown>, ...sources: unknown[]): Record<PropertyKey, unknown>;
function _objectSpread(target: Record<PropertyKey, unknown>) { for (var i = 1; i < arguments.length; i++) { var source: unknown = null != arguments[i] ? arguments[i] : {}; i % 2 ? ownKeys(Object(source), !0).forEach(function (key) { _defineProperty(target, key, readProperty(source, key)); }) : Object.getOwnPropertyDescriptors ? Object.defineProperties(target, Object.getOwnPropertyDescriptors(source)) : ownKeys(Object(source)).forEach(function (key) { Object.defineProperty(target, key, Object.getOwnPropertyDescriptor(source, key)!); }); } return target; }
function _defineProperty(obj: Record<PropertyKey, unknown>, key: PropertyKey, value: unknown) { key = _toPropertyKey(key); if (key in obj) { Object.defineProperty(obj, key, { value: value, enumerable: true, configurable: true, writable: true }); } else { obj[key] = value; } return obj; }
function _toPropertyKey(arg: unknown): PropertyKey { var key = _toPrimitive(arg, "string"); return _typeof(key) === "symbol" ? symbolValue(key) : String(key); }
function _toPrimitive(input: unknown, hint?: string): unknown { if (_typeof(input) !== "object" || input === null) return input; var prim = primitiveMethod(readProperty(input, Symbol.toPrimitive)); if (prim !== undefined) { var res = prim.call(input, hint || "default"); if (_typeof(res) !== "object") return res; throw new TypeError("@@toPrimitive must return a primitive value."); } return (hint === "string" ? String : Number)(input); }
/**
 * Matches: -1
 */
var isMinusOne = (0, _fMatches.matches)({
  type: 'UnaryExpression',
  operator: '-',
  argument: {
    type: 'Literal',
    value: 1
  },
  prefix: true
});

/**
 * Matches: 0
 */
exports.isMinusOne = isMinusOne;
var isZero = (0, _fMatches.matches)({
  type: 'Literal',
  value: 0
});

// Matches: object.indexOf(searchElement)
exports.isZero = isZero;
var matchesCallIndexOf = (0, _fMatches.matches)({
  type: 'CallExpression',
  callee: {
    type: 'MemberExpression',
    computed: false,
    object: (0, _fMatches.extractAny)('object'),
    property: {
      type: 'Identifier',
      name: 'indexOf'
    }
  },
  arguments: (0, _fMatches.matchesLength)([(0, _fMatches.extractAny)('searchElement')])
});

// Matches: -1 or 0
var matchesIndex = (0, _fMatches.extract)('index', function (v: unknown) {
  return isMinusOne(v) || isZero(v);
});

// Matches: object.indexOf(searchElement) <operator> index
var matchesIndexOfNormal = (0, _fMatches.matches)({
  type: 'BinaryExpression',
  operator: (0, _fMatches.extractAny)('operator'),
  left: matchesCallIndexOf,
  right: matchesIndex
});

// Matches: index <operator> object.indexOf(searchElement)
var matchesIndexOfReversed = (0, _fMatches.matches)({
  type: 'BinaryExpression',
  operator: (0, _fMatches.extractAny)('operator'),
  left: matchesIndex,
  right: matchesCallIndexOf
});

// Reverses the direction of comparison operator
function reverseOperator(operator: string) {
  return operator.replace(/[><]/, function (op: string) {
    return op === '>' ? '<' : '>';
  });
}
function reverseOperatorField(match: MatchResult) {
  if (!match) {
    return false;
  }
  return _objectSpread(_objectSpread({}, match), {}, {
    operator: reverseOperator(classText(match.operator))
  });
}

/**
 * Matches:
 *
 *    object.indexOf(searchElement) <operator> index
 *
 * or
 *
 *    index <operator> object.indexOf(searchElement)
 *
 * On success returns object with keys:
 *
 * - object
 * - searchElement
 * - operator
 * - index
 *
 * @param  {Object} node
 * @return {Object}
 */
function _default(node: unknown) {
  return matchesIndexOfNormal(node) || reverseOperatorField(matchesIndexOfReversed(node));
}

/***/ 
if (!hasEsModuleFlag(exports)) throw new TypeError("Expected the initialized ES module flag");
if (!exportsReady(exports, ["default","isMinusOne","isZero"])) throw new TypeError("Incomplete bundled exports");
return exports;
}
