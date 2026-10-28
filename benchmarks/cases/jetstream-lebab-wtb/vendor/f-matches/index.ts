export type MatchResult = false | Record<string, unknown>;
import type {Curried2, Curried3} from "../../lodash-types.ts";
// Exact module body from JetStream 3.0 ./node_modules/f-matches/index.js.
// Dependencies are loaded at the original call sites; the cached export object is retained.
import {webpack, isRecord, readProperty, hasEsModuleFlag, exportsReady} from "../../webpack.ts";
import {load as load0} from "../lodash/fp.ts";

let cache: {exports: Partial<ReturnType<typeof initialize>>} | undefined;
export function load(): ReturnType<typeof initialize> {
 if (cache !== undefined) {
  const value = cache.exports;
  if (!isExport(value)) throw new TypeError("Unexpected cached export for f-matches/index.js");
  return value;
 }
 return initialize();
}
function isExport(value: Partial<ReturnType<typeof initialize>>): value is ReturnType<typeof initialize> {
 return hasEsModuleFlag(value) && exportsReady(value, ["matches", "extract", "extractAny", "matchesLength"]);
}
function initialize() {
const exports: { __esModule?: true; "matches"?: typeof matches; "extract"?: typeof extract; "extractAny"?: typeof extractAny; "matchesLength"?: typeof matchesLength; } = {};
let module = {exports};
cache = module;


"use strict";


Object.defineProperty(exports, "__esModule", ({
  value: true
}));
exports.matchesLength = exports.extractAny = exports.extract = exports.matches = undefined;

var _typeof = typeof Symbol === "function" && typeof Symbol.iterator === "symbol" ? function (obj: unknown) { return typeof obj; } : function (obj: unknown) { return obj && typeof Symbol === "function" && readProperty(obj, "constructor") === Symbol && obj !== Symbol.prototype ? "symbol" : typeof obj; };

var _fp = load0();

function _defineProperty(obj: Record<string, unknown>, key: string, value: unknown) { if (key in obj) { Object.defineProperty(obj, key, { value: value, enumerable: true, configurable: true, writable: true }); } else { obj[key] = value; } return obj; }

/**
 * Matches object against the given pattern.
 *
 * Similar to LoDash.matches(), but with the addition that a Function
 * can be provided to assert various conditions e.g. checking that
 * number is within a certain range.
 *
 * Additionally there are utility functions:
 *
 * - extract() can be used to give names to the parts of object -
 *   these are then returned as a map of key-value pairs.
 *
 * - matchesLength() ensures the exact array length is respected.
 *
 * @param {Object} pattern Pattern to test against
 * @param {Object} obj The object to test
 * @return {Object|Boolean} an object with extracted fields
 * or false when no match found.
 */
var matches: Curried2<unknown, unknown, MatchResult> = exports.matches = (0, _fp.curry)<unknown, unknown, MatchResult>(function (pattern: unknown, obj: unknown): MatchResult {
  var extractedFields: Record<string, unknown> = {};

  var success = (0, _fp.isMatchWith)(function (value, matcher) {
    if (typeof matcher === 'function') {
      var result: unknown = matcher(value);
      if ((typeof result === 'undefined' ? 'undefined' : _typeof(result)) === 'object') {
        Object.assign(extractedFields, result);
      }
      return result;
    }
  }, pattern, obj);

  return success ? extractedFields : false;
});

/**
 * Utility for extracting values during matching with matches()
 *
 * @param {String} fieldName The name to give for the value
 * @param {Function|Object} matcher Optional matching function or pattern for matches()
 * @param {Object} obj The object to be tested and captured.
 * @return {Boolean|Object} False when no match found.
 */
var extract: Curried3<string, unknown, unknown, MatchResult> = exports.extract = (0, _fp.curry)<string, unknown, unknown, MatchResult>(function (fieldName: string, matcher: unknown, obj: unknown): MatchResult {
  var extractedFields = _defineProperty({}, fieldName, obj);

  if ((typeof matcher === 'undefined' ? 'undefined' : _typeof(matcher)) === 'object') {
    matcher = matches(matcher);
  }

  if (typeof matcher === 'function') {
    var result: unknown = matcher(obj);
    if ((typeof result === 'undefined' ? 'undefined' : _typeof(result)) === 'object') {
      return Object.assign(extractedFields, result);
    }
    if (!result) {
      return false;
    }
  }

  return extractedFields;
});

/**
 * Like extract, but does not take the matcher argument,
 * matching anything instead.
 *
 * @param {String} fieldName The name to give for the value.
 * @param {Object} obj The object to be tested and captured.
 * @return {Boolean|Object} False when no match found.
 */
var extractAny: Curried2<string, unknown, MatchResult> = exports.extractAny = (0, _fp.curry)<string, unknown, MatchResult>(function (fieldName: string, obj: unknown): MatchResult {
  return extract(fieldName, undefined, obj);
});

/**
 * Utility for asserting that two arrays match,
 * and their length also equals.
 * (in addition to the normal behavior of matches()
 * to simply compare the first items in the array).
 *
 * @param {Array} pattern
 * @param {Array} array the array to match against
 * @return {Boolean|Object} False on failure to match
 */
var matchesLength: Curried2<ArrayLike<unknown>, unknown, MatchResult> = exports.matchesLength = (0, _fp.curry)<ArrayLike<unknown>, unknown, MatchResult>(function (pattern: ArrayLike<unknown>, array: unknown): MatchResult {
  if (readProperty(array, "length") !== pattern.length) {
    return false;
  }
  return matches(pattern, array);
});


/***/ 
if (!hasEsModuleFlag(exports) || !exportsReady(exports, ["matches", "extract", "extractAny", "matchesLength"])) throw new TypeError("Incomplete original matcher exports");
return exports;
}
