import type {Fork} from "../../../../types/ast-types/types.js";
// Exact module body from JetStream 3.0 ./node_modules/ast-types/lib/def/es-proposals.js.
// Dependencies are loaded at the original call sites; the cached export object is retained.
import {exportsReady, webpack, isRecord} from "../../../../webpack.ts";
import {load as load0} from "../../../tslib/tslib.es6.ts";
import {load as load1} from "../types.ts";
import {load as load2} from "../shared.ts";
import {load as load3} from "./es2022.ts";

let cache: {exports: Partial<ReturnType<typeof initialize>>} | undefined;
export function load(): ReturnType<typeof initialize> {
 if (cache !== undefined) {
  const value = cache.exports;
  if (!isExport(value)) throw new TypeError("Unexpected cached export for ast-types/lib/def/es-proposals.js");
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
var shared_1 = tslib_1.__importStar(load2());
var es2022_1 = tslib_1.__importDefault(load3());
function default_1(fork: Fork) {
    fork.use(es2022_1.default);
    var types = fork.use(types_1.default!);
    var Type = types.Type;
    var def = types.Type.def;
    var or = Type.or;
    var shared = fork.use(shared_1.default!);
    var defaults = shared.defaults;
    def("AwaitExpression")
        .build("argument", "all")
        .field("argument", or(def("Expression"), null))
        .field("all", Boolean, defaults["false"]);
    // Decorators
    def("Decorator")
        .bases("Node")
        .build("expression")
        .field("expression", def("Expression"));
    def("Property")
        .field("decorators", or([def("Decorator")], null), defaults["null"]);
    def("MethodDefinition")
        .field("decorators", or([def("Decorator")], null), defaults["null"]);
    // Private names
    def("PrivateName")
        .bases("Expression", "Pattern")
        .build("id")
        .field("id", def("Identifier"));
    def("ClassPrivateProperty")
        .bases("ClassProperty")
        .build("key", "value")
        .field("key", def("PrivateName"))
        .field("value", or(def("Expression"), null), defaults["null"]);
    // https://github.com/tc39/proposal-import-assertions
    def("ImportAttribute")
        .bases("Node")
        .build("key", "value")
        .field("key", or(def("Identifier"), def("Literal")))
        .field("value", def("Expression"));
    ["ImportDeclaration",
        "ExportAllDeclaration",
        "ExportNamedDeclaration",
    ].forEach(function (decl) {
        def(decl).field("assertions", [def("ImportAttribute")], defaults.emptyArray);
    });
    // https://github.com/tc39/proposal-record-tuple
    // https://github.com/babel/babel/pull/10865
    def("RecordExpression")
        .bases("Expression")
        .build("properties")
        .field("properties", [or(def("ObjectProperty"), def("ObjectMethod"), def("SpreadElement"))]);
    def("TupleExpression")
        .bases("Expression")
        .build("elements")
        .field("elements", [or(def("Expression"), def("SpreadElement"), null)]);
    // https://github.com/tc39/proposal-js-module-blocks
    // https://github.com/babel/babel/pull/12469
    def("ModuleExpression")
        .bases("Node")
        .build("body")
        .field("body", def("Program"));
}
exports["default"] = default_1;
;
if (!exportsReady(shared_1, ["maybeSetModuleExports"])) throw new TypeError("Incomplete shared module");
(0, shared_1.maybeSetModuleExports)(function () { return module; });
//# sourceMappingURL=es-proposals.js.map

/***/ 
if (!exportsReady(module.exports, ["__esModule","default"])) throw new TypeError("Incomplete original module exports");
return module.exports;
}
