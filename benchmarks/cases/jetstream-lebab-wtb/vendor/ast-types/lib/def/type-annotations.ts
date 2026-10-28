import type {Fork} from "../../../../types/ast-types/types.js";
// Exact module body from JetStream 3.0 ./node_modules/ast-types/lib/def/type-annotations.js.
// Dependencies are loaded at the original call sites; the cached export object is retained.
import {exportsReady, webpack, isRecord} from "../../../../webpack.ts";
import {load as load0} from "../../../tslib/tslib.es6.ts";
import {load as load1} from "../types.ts";
import {load as load2} from "../shared.ts";

let cache: {exports: Partial<ReturnType<typeof initialize>>} | undefined;
export function load(): ReturnType<typeof initialize> {
 if (cache !== undefined) {
  const value = cache.exports;
  if (!isExport(value)) throw new TypeError("Unexpected cached export for ast-types/lib/def/type-annotations.js");
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

/**
 * Type annotation defs shared between Flow and TypeScript.
 * These defs could not be defined in ./flow.ts or ./typescript.ts directly
 * because they use the same name.
 */
Object.defineProperty(exports, "__esModule", ({ value: true }));
var tslib_1 = load0();
var types_1 = tslib_1.__importDefault(load1());
var shared_1 = tslib_1.__importStar(load2());
function default_1(fork: Fork) {
    var types = fork.use(types_1.default!);
    var def = types.Type.def;
    var or = types.Type.or;
    var defaults = fork.use(shared_1.default!).defaults;
    var TypeAnnotation = or(def("TypeAnnotation"), def("TSTypeAnnotation"), null);
    var TypeParamDecl = or(def("TypeParameterDeclaration"), def("TSTypeParameterDeclaration"), null);
    def("Identifier")
        .field("typeAnnotation", TypeAnnotation, defaults["null"]);
    def("ObjectPattern")
        .field("typeAnnotation", TypeAnnotation, defaults["null"]);
    def("Function")
        .field("returnType", TypeAnnotation, defaults["null"])
        .field("typeParameters", TypeParamDecl, defaults["null"]);
    def("ClassProperty")
        .build("key", "value", "typeAnnotation", "static")
        .field("value", or(def("Expression"), null))
        .field("static", Boolean, defaults["false"])
        .field("typeAnnotation", TypeAnnotation, defaults["null"]);
    ["ClassDeclaration",
        "ClassExpression",
    ].forEach(function (typeName) {
        def(typeName)
            .field("typeParameters", TypeParamDecl, defaults["null"])
            .field("superTypeParameters", or(def("TypeParameterInstantiation"), def("TSTypeParameterInstantiation"), null), defaults["null"])
            .field("implements", or([def("ClassImplements")], [def("TSExpressionWithTypeArguments")]), defaults.emptyArray);
    });
}
exports["default"] = default_1;
;
if (!exportsReady(shared_1, ["maybeSetModuleExports"])) throw new TypeError("Incomplete shared module");
(0, shared_1.maybeSetModuleExports)(function () { return module; });
//# sourceMappingURL=type-annotations.js.map

/***/ 
if (!exportsReady(module.exports, ["__esModule","default"])) throw new TypeError("Incomplete original module exports");
return module.exports;
}
