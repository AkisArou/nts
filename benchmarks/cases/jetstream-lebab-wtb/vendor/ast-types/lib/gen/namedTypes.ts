import type {RuntimeNamedTypes} from "../../../../types/ast-types/runtime-named-types.ts";
import type {Type, Omit} from "../../../../types/ast-types/types.js";
import type * as K from "../../../../types/ast-types/gen/kinds.js";
// Exact module body from JetStream 3.0 ./node_modules/ast-types/lib/gen/namedTypes.js.
// Dependencies are loaded at the original call sites; the cached export object is retained.
import {exportsReady, webpack, isRecord} from "../../../../webpack.ts";

let cache: {exports: Partial<ReturnType<typeof initialize>>} | undefined;
export function load(): ReturnType<typeof initialize> {
 if (cache !== undefined) {
  const value = cache.exports;
  if (!isExport(value)) throw new TypeError("Unexpected cached export for ast-types/lib/gen/namedTypes.js");
  return value;
 }
 return initialize();
}
function isExport(value: Partial<ReturnType<typeof initialize>>): value is ReturnType<typeof initialize> {
 return exportsReady(value, ["__esModule","namedTypes"]);
}
function initialize() {
const exports: { __esModule?: true; "namedTypes"?: Partial<RuntimeNamedTypes>; } = {};
let module = {exports};
cache = module;


"use strict";

Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.namedTypes = void 0;
var namedTypes: Partial<RuntimeNamedTypes>;
(function (namedTypes: Partial<RuntimeNamedTypes>) {
})(namedTypes = exports.namedTypes || (exports.namedTypes = {}));
//# sourceMappingURL=namedTypes.js.map

/***/ 
if (!exportsReady(exports, ["__esModule","namedTypes"])) throw new TypeError("Incomplete original module exports");
return exports;
}
