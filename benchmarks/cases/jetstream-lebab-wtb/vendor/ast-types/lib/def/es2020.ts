import type {Fork} from "../../../../types/ast-types/types.js";
// Exact module body from JetStream 3.0 ./node_modules/ast-types/lib/def/es2020.js.
// Dependencies are loaded at the original call sites; the cached export object is retained.
import {exportsReady, webpack, isRecord} from "../../../../webpack.ts";
import {load as load0} from "../../../tslib/tslib.es6.ts";
import {load as load1} from "./operators/es2020.ts";
import {load as load2} from "./es2019.ts";
import {load as load3} from "../types.ts";
import {load as load4} from "../shared.ts";

let cache: {exports: Partial<ReturnType<typeof initialize>>} | undefined;
export function load(): ReturnType<typeof initialize> {
 if (cache !== undefined) {
  const value = cache.exports;
  if (!isExport(value)) throw new TypeError("Unexpected cached export for ast-types/lib/def/es2020.js");
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
var es2020_1 = tslib_1.__importDefault(load1());
var es2019_1 = tslib_1.__importDefault(load2());
var types_1 = tslib_1.__importDefault(load3());
var shared_1 = tslib_1.__importStar(load4());
function default_1(fork: Fork) {
    // The es2020OpsDef plugin comes before es2019Def so LogicalOperators will be
    // appropriately augmented before first used.
    fork.use(es2020_1.default);
    fork.use(es2019_1.default);
    var types = fork.use(types_1.default!);
    var def = types.Type.def;
    var or = types.Type.or;
    var shared = fork.use(shared_1.default!);
    var defaults = shared.defaults;
    def("ImportExpression")
        .bases("Expression")
        .build("source")
        .field("source", def("Expression"));
    def("ExportAllDeclaration")
        .bases("Declaration")
        .build("source", "exported")
        .field("source", def("Literal"))
        .field("exported", or(def("Identifier"), null, void 0), defaults["null"]);
    // Optional chaining
    def("ChainElement")
        .bases("Node")
        .field("optional", Boolean, defaults["false"]);
    def("CallExpression")
        .bases("Expression", "ChainElement");
    def("MemberExpression")
        .bases("Expression", "ChainElement");
    def("ChainExpression")
        .bases("Expression")
        .build("expression")
        .field("expression", def("ChainElement"));
    def("OptionalCallExpression")
        .bases("CallExpression")
        .build("callee", "arguments", "optional")
        .field("optional", Boolean, defaults["true"]);
    // Deprecated optional chaining type, doesn't work with babelParser@7.11.0 or newer
    def("OptionalMemberExpression")
        .bases("MemberExpression")
        .build("object", "property", "computed", "optional")
        .field("optional", Boolean, defaults["true"]);
}
exports["default"] = default_1;
;
if (!exportsReady(shared_1, ["maybeSetModuleExports"])) throw new TypeError("Incomplete shared module");
(0, shared_1.maybeSetModuleExports)(function () { return module; });
//# sourceMappingURL=es2020.js.map

/***/ 
if (!exportsReady(module.exports, ["__esModule","default"])) throw new TypeError("Incomplete original module exports");
return module.exports;
}
