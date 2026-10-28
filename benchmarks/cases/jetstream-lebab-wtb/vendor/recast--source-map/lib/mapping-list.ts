// Exact module body from JetStream 3.0 ./node_modules/recast/node_modules/source-map/lib/mapping-list.js.
// Dependencies are loaded at the original call sites; the cached export object is retained.
import {webpack, isRecord, exportsReady} from "../../../webpack.ts";
import {load as load0} from "./util.ts";

import type {InflatedMapping, MappingFields} from "./util.ts";
export type {InflatedMapping, DeflatedMapping, MappingFields} from "./util.ts";
export type MappingList = InstanceType<ReturnType<typeof load>["MappingList"]>;

let cache: {exports: unknown} | undefined;
export function load(): ReturnType<typeof initialize> {
 if (cache !== undefined) {
  const value = cache.exports;
  if (!isExport(value)) throw new TypeError("Unexpected cached export for recast--source-map/lib/mapping-list.js");
  return value;
 }
 return initialize();
}
function isExport(value: unknown): value is ReturnType<typeof initialize> {
 return isRecord(value) && typeof value.MappingList === "function";
}
function initialize() {
const exports: { __esModule?: boolean; "MappingList"?: typeof MappingList; } = {};
let module = {exports};
cache = module;


/* -*- Mode: js; js-indent-level: 2; -*- */
/*
 * Copyright 2014 Mozilla Foundation and contributors
 * Licensed under the New BSD license. See LICENSE or:
 * http://opensource.org/licenses/BSD-3-Clause
 */

var util = load0();

/**
 * Determine whether mappingB is after mappingA with respect to generated
 * position.
 */
function generatedPositionAfter(mappingA: MappingFields<string>, mappingB: MappingFields<string>) {
  // Optimized for most common case
  var lineA = mappingA.generatedLine;
  var lineB = mappingB.generatedLine;
  var columnA = mappingA.generatedColumn;
  var columnB = mappingB.generatedColumn;
  return lineB! > lineA! || lineB == lineA && columnB! >= columnA! ||
         util.compareByGeneratedPositionsInflated(mappingA, mappingB) <= 0;
}

/**
 * A data structure to provide a sorted view of accumulated mappings in a
 * performance conscious manner. It trades a neglibable overhead in general
 * case for a large speedup in case of mappings being added in order.
 */
class MappingList {
  declare _array: InflatedMapping[];
  declare _sorted: boolean;
  declare _last: MappingFields<string>;
  declare unsortedForEach: <T>(aCallback: (this: T, mapping: InflatedMapping, index: number, mappings: InflatedMapping[]) => unknown, aThisArg?: T) => void;
  declare add: (aMapping: InflatedMapping) => void;
  declare toArray: () => InflatedMapping[];
constructor() {
  this._array = [];
  this._sorted = true;
  // Serves as infimum
  this._last = {generatedLine: -1, generatedColumn: 0};
}
}

/**
 * Iterate through internal items. This method takes the same arguments that
 * `Array.prototype.forEach` takes.
 *
 * NOTE: The order of the mappings is NOT guaranteed.
 */
MappingList.prototype.unsortedForEach =
  function MappingList_forEach<T>(this: MappingList, aCallback: (this: T, mapping: InflatedMapping, index: number, mappings: InflatedMapping[]) => unknown, aThisArg?: T) {
    this._array.forEach(aCallback, aThisArg);
  };

/**
 * Add the given source mapping.
 *
 * @param Object aMapping
 */
MappingList.prototype.add = function MappingList_add(this: MappingList, aMapping: InflatedMapping) {
  if (generatedPositionAfter(this._last, aMapping)) {
    this._last = aMapping;
    this._array.push(aMapping);
  } else {
    this._sorted = false;
    this._array.push(aMapping);
  }
};

/**
 * Returns the flat, sorted array of mappings. The mappings are sorted by
 * generated position.
 *
 * WARNING: This method returns internal data without copying, for
 * performance. The return value must NOT be mutated, and should be treated as
 * an immutable borrow. If you want to take ownership, you must make your own
 * copy.
 */
MappingList.prototype.toArray = function MappingList_toArray(this: MappingList) {
  if (!this._sorted) {
    this._array.sort(util.compareByGeneratedPositionsInflated);
    this._sorted = true;
  }
  return this._array;
};

exports.MappingList = MappingList;


/***/ 
if (!exportsReady(exports, ["MappingList"])) throw new TypeError("Incomplete original source-map exports");
return exports;
}
