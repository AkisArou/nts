import type {Fork} from "../../../../types/ast-types/types.js";
// Exact module body from JetStream 3.0 ./node_modules/ast-types/lib/def/babel.js.
// Dependencies are loaded at the original call sites; the cached export object is retained.
import {exportsReady, webpack, isRecord} from "../../../../webpack.ts";
import {load as load0} from "../../../tslib/tslib.es6.ts";
import {load as load1} from "../types.ts";
import {load as load2} from "./babel-core.ts";
import {load as load3} from "./flow.ts";
import {load as load4} from "../shared.ts";

let cache: {exports: Partial<ReturnType<typeof initialize>>} | undefined;
export function load(): ReturnType<typeof initialize> {
 if (cache !== undefined) {
  const value = cache.exports;
  if (!isExport(value)) throw new TypeError("Unexpected cached export for ast-types/lib/def/babel.js");
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
var types_1 = tslib_1.__importDefault(load1());
var babel_core_1 = tslib_1.__importDefault(load2());
var flow_1 = tslib_1.__importDefault(load3());
var shared_1 = load4();
function default_1(fork: Fork) {
    var types = fork.use(types_1.default!);
    var def = types.Type.def;
    fork.use(babel_core_1.default);
    fork.use(flow_1.default);
    // https://github.com/babel/babel/pull/10148
    def("V8IntrinsicIdentifier")
        .bases("Expression")
        .build("name")
        .field("name", String);
    // https://github.com/babel/babel/pull/13191
    // https://github.com/babel/website/pull/2541
    def("TopicReference")
        .bases("Expression")
        .build();
}
exports["default"] = default_1;
if (!exportsReady(shared_1, ["maybeSetModuleExports"])) throw new TypeError("Incomplete shared module");
(0, shared_1.maybeSetModuleExports)(function () { return module; });
//# sourceMappingURL=babel.js.map

/***/ 
if (!exportsReady(module.exports, ["__esModule","default"])) throw new TypeError("Incomplete original module exports");
return module.exports;
}
