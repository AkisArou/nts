import {completeNamedTypes} from "../../../types/ast-types/runtime-named-types.ts";
import type {Fork, Plugin} from "../../../types/ast-types/types.js";
// Exact module body from JetStream 3.0 ./node_modules/ast-types/lib/fork.js.
// Dependencies are loaded at the original call sites; the cached export object is retained.
import {exportsReady, webpack, isRecord} from "../../../webpack.ts";
import {load as load0} from "../../tslib/tslib.es6.ts";
import {load as load1} from "./types.ts";
import {load as load2} from "./path-visitor.ts";
import {load as load3} from "./equiv.ts";
import {load as load4} from "./path.ts";
import {load as load5} from "./node-path.ts";
import {load as load6} from "./shared.ts";

let cache: {exports: Partial<ReturnType<typeof initialize>>} | undefined;
export function load(): ReturnType<typeof initialize> {
 if (cache !== undefined) {
  const value = cache.exports;
  if (!isExport(value)) throw new TypeError("Unexpected cached export for ast-types/lib/fork.js");
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
var path_visitor_1 = tslib_1.__importDefault(load2());
var equiv_1 = tslib_1.__importDefault(load3());
var path_1 = tslib_1.__importDefault(load4());
var node_path_1 = tslib_1.__importDefault(load5());
var shared_1 = load6();
function default_1(plugins: Plugin<unknown>[]) {
    var fork: Fork = createFork();
    var types = fork.use(types_1.default!);
    plugins.forEach(fork.use);
    types.finalize();
    var PathVisitor = fork.use(path_visitor_1.default);
    return {
        Type: types.Type,
        builtInTypes: types.builtInTypes,
        namedTypes: completeNamedTypes(types.namedTypes),
        builders: types.builders,
        defineMethod: types.defineMethod,
        getFieldNames: types.getFieldNames,
        getFieldValue: types.getFieldValue,
        eachField: types.eachField,
        someField: types.someField,
        getSupertypeNames: types.getSupertypeNames,
        getBuilderName: types.getBuilderName,
        astNodesAreEquivalent: fork.use(equiv_1.default),
        finalize: types.finalize,
        Path: fork.use(path_1.default),
        NodePath: fork.use(node_path_1.default),
        PathVisitor: PathVisitor,
        use: fork.use,
        visit: PathVisitor.visit,
    };
}
exports["default"] = default_1;
;
function createFork(): Fork {
    var used: Plugin<unknown>[] = [];
    var usedResult: unknown[] = [];
    function use<T>(plugin: Plugin<T>): T;
    function use(plugin: Plugin<unknown>): unknown {
        var idx = used.indexOf(plugin);
        if (idx === -1) {
            idx = used.length;
            used.push(plugin);
            usedResult[idx] = plugin(fork);
        }
        return usedResult[idx];
    }
    var fork: Fork = { use: use };
    return fork;
}
if (!exportsReady(shared_1, ["maybeSetModuleExports"])) throw new TypeError("Incomplete shared module");
(0, shared_1.maybeSetModuleExports)(function () { return module; });
//# sourceMappingURL=fork.js.map

/***/ 
if (!exportsReady(module.exports, ["__esModule","default"])) throw new TypeError("Incomplete original module exports");
return module.exports;
}
