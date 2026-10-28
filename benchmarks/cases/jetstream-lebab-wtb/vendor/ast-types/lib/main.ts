import {completeNamedTypes} from "../../../types/ast-types/runtime-named-types.ts";
// Exact module body from JetStream 3.0 ./node_modules/ast-types/lib/main.js.
// Dependencies are loaded at the original call sites; the cached export object is retained.
import {exportsReady, webpack, isRecord} from "../../../webpack.ts";
import {load as load0} from "../../tslib/tslib.es6.ts";
import {load as load1} from "./fork.ts";
import {load as load2} from "./def/es-proposals.ts";
import {load as load3} from "./def/jsx.ts";
import {load as load4} from "./def/flow.ts";
import {load as load5} from "./def/esprima.ts";
import {load as load6} from "./def/babel.ts";
import {load as load7} from "./def/typescript.ts";
import {load as load8} from "./gen/namedTypes.ts";

let cache: {exports: Partial<ReturnType<typeof initialize>>} | undefined;
export function load(): ReturnType<typeof initialize> {
 if (cache !== undefined) {
  const value = cache.exports;
  if (!isExport(value)) throw new TypeError("Unexpected cached export for ast-types/lib/main.js");
  return value;
 }
 return initialize();
}
function isExport(value: Partial<ReturnType<typeof initialize>>): value is ReturnType<typeof initialize> {
 return exportsReady(value, ["__esModule","namedTypes","astNodesAreEquivalent","builders","builtInTypes","defineMethod","eachField","finalize","getBuilderName","getFieldNames","getFieldValue","getSupertypeNames","NodePath","Path","PathVisitor","someField","Type","use","visit"]);
}
function initialize() {
const exports: { __esModule?: true; "namedTypes"?: ReturnType<typeof completeNamedTypes>; "astNodesAreEquivalent"?: typeof astNodesAreEquivalent; "builders"?: typeof builders; "builtInTypes"?: typeof builtInTypes; "defineMethod"?: typeof defineMethod; "eachField"?: typeof eachField; "finalize"?: typeof finalize; "getBuilderName"?: typeof getBuilderName; "getFieldNames"?: typeof getFieldNames; "getFieldValue"?: typeof getFieldValue; "getSupertypeNames"?: typeof getSupertypeNames; "NodePath"?: typeof NodePath; "Path"?: typeof Path; "PathVisitor"?: typeof PathVisitor; "someField"?: typeof someField; "Type"?: typeof Type; "use"?: typeof use; "visit"?: typeof visit; } = {};
let module = {exports};
cache = module;


"use strict";

Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.visit = exports.use = exports.Type = exports.someField = exports.PathVisitor = exports.Path = exports.NodePath = exports.namedTypes = exports.getSupertypeNames = exports.getFieldValue = exports.getFieldNames = exports.getBuilderName = exports.finalize = exports.eachField = exports.defineMethod = exports.builtInTypes = exports.builders = exports.astNodesAreEquivalent = void 0;
var tslib_1 = load0();
var fork_1 = tslib_1.__importDefault(load1());
var es_proposals_1 = tslib_1.__importDefault(load2());
var jsx_1 = tslib_1.__importDefault(load3());
var flow_1 = tslib_1.__importDefault(load4());
var esprima_1 = tslib_1.__importDefault(load5());
var babel_1 = tslib_1.__importDefault(load6());
var typescript_1 = tslib_1.__importDefault(load7());
var namedTypes_1 = load8();
Object.defineProperty(exports, "namedTypes", ({ enumerable: true, get: function () { return completeNamedTypes(namedTypes_1.namedTypes); } }));
var _a = (0, fork_1.default)([
    // Feel free to add to or remove from this list of extension modules to
    // configure the precise type hierarchy that you need.
    es_proposals_1.default,
    jsx_1.default,
    flow_1.default,
    esprima_1.default,
    babel_1.default,
    typescript_1.default,
]), astNodesAreEquivalent = _a.astNodesAreEquivalent, builders = _a.builders, builtInTypes = _a.builtInTypes, defineMethod = _a.defineMethod, eachField = _a.eachField, finalize = _a.finalize, getBuilderName = _a.getBuilderName, getFieldNames = _a.getFieldNames, getFieldValue = _a.getFieldValue, getSupertypeNames = _a.getSupertypeNames, n = _a.namedTypes, NodePath = _a.NodePath, Path = _a.Path, PathVisitor = _a.PathVisitor, someField = _a.someField, Type = _a.Type, use = _a.use, visit = _a.visit;
exports.astNodesAreEquivalent = astNodesAreEquivalent;
exports.builders = builders;
exports.builtInTypes = builtInTypes;
exports.defineMethod = defineMethod;
exports.eachField = eachField;
exports.finalize = finalize;
exports.getBuilderName = getBuilderName;
exports.getFieldNames = getFieldNames;
exports.getFieldValue = getFieldValue;
exports.getSupertypeNames = getSupertypeNames;
exports.NodePath = NodePath;
exports.Path = Path;
exports.PathVisitor = PathVisitor;
exports.someField = someField;
exports.Type = Type;
exports.use = use;
exports.visit = visit;
// Populate the exported fields of the namedTypes namespace, while still
// retaining its member types.
Object.assign(namedTypes_1.namedTypes, n);
//# sourceMappingURL=main.js.map

/***/ 
if (!exportsReady(exports, ["__esModule","namedTypes","astNodesAreEquivalent","builders","builtInTypes","defineMethod","eachField","finalize","getBuilderName","getFieldNames","getFieldValue","getSupertypeNames","NodePath","Path","PathVisitor","someField","Type","use","visit"])) throw new TypeError("Incomplete original module exports");
return exports;
}
