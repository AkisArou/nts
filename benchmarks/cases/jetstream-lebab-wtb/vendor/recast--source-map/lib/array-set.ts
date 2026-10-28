// Exact module body from JetStream 3.0 ./node_modules/recast/node_modules/source-map/lib/array-set.js.
// Dependencies are loaded at the original call sites; the cached export object is retained.
import {webpack, isRecord, record, readProperty, exportsReady} from "../../../webpack.ts";
import {load as load0} from "./util.ts";

export type ArraySet = InstanceType<ReturnType<typeof load>["ArraySet"]>;
function nativeSet(value: Map<string, number> | Record<string, unknown>): Map<string, number> { if (!(value instanceof Map)) throw new TypeError("Expected the original native Map storage"); return value; }
function storedIndex(value: unknown): number { if (typeof value !== "number") throw new TypeError("Expected the stored array index"); return value; }
function arrayString(value: unknown): string | undefined { if (value !== undefined && typeof value !== "string") throw new TypeError("Expected a source-map string"); return value; }

let cache: {exports: unknown} | undefined;
export function load(): ReturnType<typeof initialize> {
 if (cache !== undefined) {
  const value = cache.exports;
  if (!isExport(value)) throw new TypeError("Unexpected cached export for recast--source-map/lib/array-set.js");
  return value;
 }
 return initialize();
}
function isExport(value: unknown): value is ReturnType<typeof initialize> {
 return isRecord(value) && typeof value.ArraySet === "function";
}
function initialize() {
const exports: { __esModule?: boolean; "ArraySet"?: typeof ArraySet; } = {};
let module = {exports};
cache = module;


/* -*- Mode: js; js-indent-level: 2; -*- */
/*
 * Copyright 2011 Mozilla Foundation and contributors
 * Licensed under the New BSD license. See LICENSE or:
 * http://opensource.org/licenses/BSD-3-Clause
 */

var util = load0();
var has = Object.prototype.hasOwnProperty;
var hasNativeMap = typeof Map !== "undefined";

/**
 * A data structure which is a combination of an array and a set. Adding a new
 * member is O(1), testing for membership is O(1), and finding the index of an
 * element is O(1). Removing elements from the set is not supported. Only
 * strings are supported for membership.
 */
class ArraySet {
  declare _array: string[];
  declare _set: Map<string, number> | Record<string, unknown>;
  declare static fromArray: (aArray: readonly string[], aAllowDuplicates?: boolean) => ArraySet;
  declare size: () => number;
  declare add: (aStr: string, aAllowDuplicates?: boolean) => void;
  declare has: (aStr: string) => boolean;
  declare indexOf: (aStr: string) => number;
  declare at: (aIdx: number | string) => string | undefined;
  declare toArray: () => string[];
  constructor() {
  this._array = [];
  this._set = hasNativeMap ? new Map<string, number>() : record(Object.create(null));
  }
}

/**
 * Static method for creating ArraySet instances from an existing array.
 */
ArraySet.fromArray = function ArraySet_fromArray(aArray: readonly string[], aAllowDuplicates?: boolean) {
  var set = new ArraySet();
  for (var i = 0, len = aArray.length; i < len; i++) {
    set.add(aArray[i], aAllowDuplicates);
  }
  return set;
};

/**
 * Return how many unique items are in this ArraySet. If duplicates have been
 * added, than those do not count towards the size.
 *
 * @returns Number
 */
ArraySet.prototype.size = function ArraySet_size(this: ArraySet) {
  return hasNativeMap ? nativeSet(this._set).size : Object.getOwnPropertyNames(this._set).length;
};

/**
 * Add the given string to this set.
 *
 * @param String aStr
 */
ArraySet.prototype.add = function ArraySet_add(this: ArraySet, aStr: string, aAllowDuplicates?: boolean) {
  var sStr = hasNativeMap ? aStr : util.toSetString(aStr);
  var isDuplicate = hasNativeMap ? this.has(aStr) : has.call(this._set, sStr);
  var idx = this._array.length;
  if (!isDuplicate || aAllowDuplicates) {
    this._array.push(aStr);
  }
  if (!isDuplicate) {
    if (hasNativeMap) {
      nativeSet(this._set).set(aStr, idx);
    } else {
      record(this._set)[sStr] = idx;
    }
  }
};

/**
 * Is the given string a member of this set?
 *
 * @param String aStr
 */
ArraySet.prototype.has = function ArraySet_has(this: ArraySet, aStr: string) {
  if (hasNativeMap) {
    return nativeSet(this._set).has(aStr);
  } else {
    var sStr = util.toSetString(aStr);
    return has.call(this._set, sStr);
  }
};

/**
 * What is the index of the given string in the array?
 *
 * @param String aStr
 */
ArraySet.prototype.indexOf = function ArraySet_indexOf(this: ArraySet, aStr: string) {
  if (hasNativeMap) {
    var idx = nativeSet(this._set).get(aStr);
    if (idx! >= 0) {
        return idx!;
    }
  } else {
    var sStr = util.toSetString(aStr);
    if (has.call(this._set, sStr)) {
      return storedIndex(readProperty(this._set, sStr));
    }
  }

  throw new Error('"' + aStr + '" is not in the set.');
};

/**
 * What is the element at the given index?
 *
 * @param Number aIdx
 */
ArraySet.prototype.at = function ArraySet_at(this: ArraySet, aIdx: string | number) {
  if (Number(aIdx) >= 0 && Number(aIdx) < this._array.length) {
    return arrayString(readProperty(this._array, aIdx));
  }
  throw new Error('No element indexed by ' + aIdx);
};

/**
 * Returns the array representation of this set (which has the proper indices
 * indicated by indexOf). Note that this is a copy of the internal array used
 * for storing the members so that no one can mess with internal state.
 */
ArraySet.prototype.toArray = function ArraySet_toArray(this: ArraySet) {
  return this._array.slice();
};

exports.ArraySet = ArraySet;


/***/ 
if (!exportsReady(exports, ["ArraySet"])) throw new TypeError("Incomplete original source-map exports");
return exports;
}
