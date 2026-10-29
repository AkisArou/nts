import type {Fork} from "../../../../types/ast-types/types.js";
// Exact module body from JetStream 3.0 ./node_modules/ast-types/lib/def/es2017.js.
// Dependencies are loaded at the original call sites; the cached export object is retained.
import {exportsReady, webpack, isRecord} from "../../../../webpack.ts";
import {load as load0} from "../../../tslib/tslib.es6.ts";
import {load as load1} from "./es2016.ts";
import {load as load2} from "../types.ts";
import {load as load3} from "../shared.ts";

let cache: {exports: Partial<ReturnType<typeof initialize>>} | undefined;
export function load(): ReturnType<typeof initialize> {
 if (cache !== undefined) {
  const value = cache.exports;
  if (!isExport(value)) throw new TypeError("Unexpected cached export for ast-types/lib/def/es2017.js");
  return value;
 }
 return initialize();
}
function isExport(value: Partial<ReturnType<typeof initialize>>): value is ReturnType<typeof initialize> {
 return exportsReady(value, ["__esModule","default"]);
}
function initialize() {
const exports: { __esModule?: true; "default"?: typeof default_1; } = {};
let module = {exports};
cache = module;


"use strict";
/* module decorator */ module = webpack.nmd(module);

Object.defineProperty(exports, "__esModule", ({ value: true }));
var tslib_1 = load0();
var es2016_1 = tslib_1.__importDefault(load1());
var types_1 = tslib_1.__importDefault(load2());
var shared_1 = tslib_1.__importStar(load3());
function default_1(fork: Fork) {
    fork.use(es2016_1.default);
    var types = fork.use(types_1.default!);
    var def = types.Type.def;
    var defaults = fork.use(shared_1.default!).defaults;
    def("Function")
        .field("async", Boolean, defaults["false"]);
    def("AwaitExpression")
        .bases("Expression")
        .build("argument")
        .field("argument", def("Expression"));
}
exports["default"] = default_1;
;
if (!exportsReady(shared_1, ["maybeSetModuleExports"])) throw new TypeError("Incomplete shared module");
(0, shared_1.maybeSetModuleExports)(function () { return module; });
//# sourceMappingURL=es2017.js.map

/***/ 
if (!exportsReady(module.exports, ["__esModule","default"])) throw new TypeError("Incomplete original module exports");
return module.exports;
}
